import { createHash } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';

const URL = '/api/v1/media/resumable';
const H = { 'X-NRCS-Client': 'web' };
const chunkBytes = 2 * 1024 * 1024;
let server: Awaited<ReturnType<typeof createTestServer>>;
beforeAll(async () => { server = await createTestServer(); });
afterAll(() => server.close());

it('continues from the acknowledged offset, checks contents and hides unfinished uploads from other owners', async () => {
  const owner = await loginAgent(server.app, 'media@akhbar.tv');
  const another = await loginAgent(server.app, 'producer@akhbar.tv');
  const first = Buffer.alloc(chunkBytes, 17);
  const last = Buffer.from([1, 3, 5]);
  const opened = await owner.post(URL).set(H).send({ name: 'fixture.mp4', mimeType: 'video/mp4', size: first.length + last.length });
  expect(opened.status).toBe(201);
  const { id, offset } = opened.body.data;
  expect(offset).toBe(0);
  const target = `${URL}/${id}`;
  const send = (agent: typeof owner, position: number, data: Buffer, checksum = createHash('sha256').update(data).digest('hex')) => agent.put(target).set(H).set('Content-Type', 'application/octet-stream').set('X-Upload-Offset', String(position)).set('X-Upload-Sha256', checksum).send(data);

  expect((await another.get(target)).status).toBe(404);
  expect((await another.post(`${target}/complete`).set(H)).status).toBe(404);
  expect((await send(owner, 0, first, '0'.repeat(64))).status).toBe(400);
  expect((await owner.get(target)).body.data.offset).toBe(0);
  expect((await send(owner, 0, first)).body.data.offset).toBe(first.length);
  expect((await owner.post(`${target}/complete`).set(H)).status).toBe(409);
  expect((await send(owner, 0, first)).status).toBe(409);
  const reconnected = await loginAgent(server.app, 'media@akhbar.tv');
  expect((await reconnected.get(target)).body.data.offset).toBe(first.length);
  expect((await send(reconnected, first.length, last)).body.data.offset).toBe(first.length + last.length);
  const complete = await reconnected.post(`${target}/complete`).set(H);
  expect(complete.status).toBe(200);
  expect(complete.body.data).toMatchObject({ id, sizeBytes: first.length + last.length, originalName: 'fixture.mp4' });
  expect((await reconnected.post(`${target}/complete`).set(H)).body.data).toEqual(complete.body.data);
  expect(server.db.getUpload(id)?.scope).toBe('media');
});

it('rejects early-failed resumable PUT chunks cleanly without socket reset', async () => {
  const owner = await loginAgent(server.app, 'media@akhbar.tv');
  const opened = await owner.post(URL).set(H).send({ name: 'big.mp4', mimeType: 'video/mp4', size: chunkBytes + 1024 });
  expect(opened.status).toBe(201);
  const { id } = opened.body.data;

  // Unknown session with a large streaming body -> 404 without ECONNRESET
  const missing = await owner.put(`${URL}/upl-missing-session`)
    .set(H)
    .set('Content-Type', 'application/octet-stream')
    .set('X-Upload-Offset', '0')
    .send(Buffer.alloc(1024 * 1024, 1));
  expect(missing.status).toBe(404);

  // Oversized chunk exceeding 2MB limit -> 413 without ECONNRESET
  const tooLarge = await owner.put(`${URL}/${id}`)
    .set(H)
    .set('Content-Type', 'application/octet-stream')
    .set('X-Upload-Offset', '0')
    .send(Buffer.alloc(chunkBytes + 1024, 2));
  expect(tooLarge.status).toBe(413);
});
