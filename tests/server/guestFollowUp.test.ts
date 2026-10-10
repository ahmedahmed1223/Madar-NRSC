import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
let server: Awaited<ReturnType<typeof createTestServer>>;
beforeAll(async () => { server = await createTestServer(); });
afterAll(() => server.close());
it('validates follow-up on server and retains permission/conflict enforcement', async () => {
  const producer = await loginAgent(server.app, 'producer@akhbar.tv');
  const row = server.db.listCollection('episodes').find(r => r.d.guests?.length)!;
  const send = (agent: any, d: any, baseV = row.v) => agent.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [{ c: 'episodes', id: row.id, op: 'upsert', baseV, d }] });
  const invalid = await send(producer, { ...row.d, guests: row.d.guests.map((g: any) => ({ ...g, technicalCheckStatus: 'bad' })) });
  expect(invalid.body.results[0].ok).toBe(false);
  const valid = await send(producer, { ...row.d, guests: row.d.guests.map((g: any) => ({ ...g, technicalCheckStatus: 'PENDING', technicalCheckNote: 'اختبار' })) });
  expect(valid.body.results[0].ok).toBe(true);
  expect((await send(producer, row.d)).body.results[0].code).toBe('CONFLICT');
  const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
  const current = server.db.getRow('episodes', row.id)!;
  expect((await send(journalist, { ...current.d, guests: [] }, current.v)).body.results[0].ok).toBe(false);
});
