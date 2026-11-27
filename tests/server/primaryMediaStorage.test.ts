import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { uploadsDir } from '../../src/server/uploads';

let server: Awaited<ReturnType<typeof createTestServer>>;
let share: string;
const H = { 'X-NRCS-Client': 'web' };
const bytes = Buffer.from('media payload for primary storage');
const payload = { name: 'interview.mp4', mimeType: 'video/mp4', size: bytes.length };

beforeAll(async () => {
  server = await createTestServer({ STORAGE_SYNC_SECONDS: '0' });
  share = fs.mkdtempSync(path.join(os.tmpdir(), 'madar-primary-share-'));
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => {
  server.close();
  fs.rmSync(share, { recursive: true, force: true });
});

function chooseNas() {
  const settings = server.db.getRow('settings', 'singleton')!;
  server.db.writeRow('settings', settings.id, {
    ...settings.d, storage: { primaryMedia: 'nas' },
  }, settings.p, null);
}

function requireRemoteCopy(id: string) {
  const row = server.db.getUpload(id)!;
  expect(row).toMatchObject({ localEvicted: true, remotePrimary: true });
  expect(fs.existsSync(path.join(uploadsDir(server.dir), row.storedName))).toBe(false);
  const copies = server.db.copiesOf(id);
  expect(copies).toEqual([expect.objectContaining({ target: 'share', state: 'DONE' })]);
  expect(fs.readFileSync(path.join(share, copies[0].remotePath!))).toEqual(bytes);
}

it('acknowledges an ordinary NAS upload after remote commit without a local copy, and serves ranges', async () => {
  chooseNas();
  vi.stubEnv('SHARE_DIRECTORY', share);
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const upload = await admin.post('/api/v1/media/upload').set(H).type(payload.mimeType)
    .set('X-File-Name', payload.name).send(bytes);
  expect(upload.status).toBe(201);
  requireRemoteCopy(upload.body.data.id);
  const part = await admin.get(upload.body.data.url).set('Range', 'bytes=1-5');
  expect(part.status).toBe(206);
  expect(part.headers['content-range']).toBe(`bytes 1-5/${bytes.length}`);
});

it('does not materialize a remote-primary file through the legacy bridge cache', async () => {
  chooseNas();
  vi.stubEnv('SHARE_DIRECTORY', share);
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const { body } = await admin.post('/api/v1/media/upload').set(H).type(payload.mimeType)
    .set('X-File-Name', payload.name).send(bytes).expect(201);
  const { id, url } = body.data;
  const authorization = await admin.post('/api/v1/storage/bridge/token').set(H).send({}).expect(200);
  const bridgeToken = authorization.body.data.token;
  vi.stubEnv('SHARE_DIRECTORY', '');
  const unavailable = await admin.get(url).expect(503);
  expect(unavailable.body.code).toBe('PRIMARY_MEDIA_UNAVAILABLE');
  expect(server.db.shareFetchState(id)).toBeNull();
  await request(server.app).put(`/api/v1/bridge/fetches/${id}`).set(H)
    .set('Authorization', `Bearer ${bridgeToken}`).type('application/octet-stream').send(bytes).expect(409);
  requireRemoteCopy(id);
});

it('does not accept an ordinary upload locally when the configured mount is unavailable', async () => {
  chooseNas();
  vi.stubEnv('SHARE_DIRECTORY', path.join(share, 'missing-mount'));
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const upload = await admin.post('/api/v1/media/upload').set(H).type(payload.mimeType)
    .set('X-File-Name', payload.name).send(bytes);
  expect(upload.status).toBe(503);
  expect(upload.body.data).toBeUndefined();
  expect(fs.existsSync(path.join(share, 'missing-mount'))).toBe(false);
});

it('rejects a configured NAS location inside the server data directory', async () => {
  chooseNas();
  const localDirectory = path.join(server.dir, 'not-a-remote-volume');
  fs.mkdirSync(localDirectory);
  vi.stubEnv('SHARE_DIRECTORY', localDirectory);
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const before = server.db.uploadsSummary();
  await admin.post('/api/v1/media/upload').set(H).type(payload.mimeType)
    .set('X-File-Name', payload.name).send(bytes).expect(503);
  expect(server.db.uploadsSummary()).toEqual(before);
  expect(fs.readdirSync(localDirectory)).toEqual([]);
});

it('keeps a resumable upload retryable until the primary destination confirms it', async () => {
  chooseNas();
  vi.stubEnv('SHARE_DIRECTORY', path.join(share, 'missing-mount'));
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const prefix = '/api/v1/media/resumable';
  const created = await admin.post(prefix).set(H).send(payload);
  expect(created.status).toBe(201);
  const id = created.body.data.id;
  const chunk = await admin.put(`${prefix}/${id}`).set(H).type('application/octet-stream').set('X-Upload-Offset', '0')
    .set('X-Upload-Sha256', createHash('sha256').update(bytes).digest('hex')).send(bytes);
  expect(chunk.status).toBe(200);
  expect((await admin.post(`${prefix}/${id}/complete`).set(H)).status).toBe(503);
  expect(server.db.getUpload(id)).toBeNull();
  expect((await admin.get(`${prefix}/${id}`)).body.data).toMatchObject({ offset: bytes.length });
  vi.stubEnv('SHARE_DIRECTORY', share);
  expect((await admin.post(`${prefix}/${id}/complete`).set(H)).status).toBe(200);
  requireRemoteCopy(id);
  expect((await admin.post(`${prefix}/${id}/complete`).set(H)).body.data.id).toBe(id);
});

it('keeps a one-time contributor link usable until the primary destination confirms its file', async () => {
  chooseNas();
  vi.stubEnv('SHARE_DIRECTORY', path.join(share, 'missing-mount'));
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const prefix = '/api/v1/external-intake';
  const issued = await admin.post(`${prefix}/links`).set(H).send({ kind: 'upload' }).expect(200);
  const token = issued.body.data.path.split('#')[1];
  const name = 'contributor.mp4';
  const submit = () => request(server.app).post(`${prefix}/upload`).set(H).type(payload.mimeType)
    .set('X-Madar-Intake', token).set('X-File-Name', name).send(bytes);
  const before = server.db.uploadsSummary();
  await submit().expect(503);
  expect(server.db.uploadsSummary()).toEqual(before);
  vi.stubEnv('SHARE_DIRECTORY', share);
  await submit().expect(201);
  const saved = server.db.listCollection('media').find((row) => row.d.fileName === name);
  requireRemoteCopy(saved!.d.url.split('/').at(-1));
  await submit().expect(410);
});
