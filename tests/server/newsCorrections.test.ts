import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { buildAuthContext } from '../../src/server/auth';
import { createNewsCorrection } from '../../src/server/newsCorrections';
import request from 'supertest';
import { SyncService } from '../../src/server/sync';
let server: Awaited<ReturnType<typeof createTestServer>>;
beforeAll(async () => { server = await createTestServer(); });
afterAll(() => server.close());
it('requires authentication, CSRF and editorial correction authority', async () => {
  const news = server.db.listCollection('news')[0];
  const url = `/api/v1/news/${news.id}/corrections`;
  expect((await request(server.app).post(url).set('X-NRCS-Client', 'web').send({})).status).toBe(401);
  const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
  expect((await journalist.post(url).send({})).status).toBe(403);
  expect((await journalist.post(url).set('X-NRCS-Client', 'web').send({ expectedVersion: news.v, reason: 'سبب', summary: 'ملخص', requestId: 'unauthorized-123' })).status).toBe(403);
});
it('records immutable server-owned corrections with version checks and idempotent retries', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const news = server.db.listCollection('news')[0];
  const input = { expectedVersion: news.v, reason: 'خطأ في الاسم', summary: 'توضيح الاسم الصحيح', requestId: 'correction-request-123' };
  const send = (body: any) => admin.post(`/api/v1/news/${news.id}/corrections`).set('X-NRCS-Client', 'web').send(body);
  const first = await send(input);
  expect(first.status).toBe(200);
  expect((await send({ ...input, requestId: 'forged-actor-123', actorId: 'forged' })).status).toBe(400);
  expect(first.body.data.actorId).not.toBe('forged');
  expect((await send(input)).body.data.id).toBe(first.body.data.id);
  expect((await send({ ...input, summary: 'مختلف' })).status).toBe(409);
  expect((await send({ ...input, requestId: 'new-request-123', expectedVersion: news.v + 1 })).status).toBe(409);
  expect(server.db.getRow('news', news.id)?.d).toEqual(news.d);
  for (const op of ['upsert', 'delete']) {
    const res = await admin.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [{ c: 'newsCorrections', op, id: first.body.data.id, baseV: 1, d: { ...first.body.data, summary: 'forged' } }] });
    expect(res.body.results[0].ok).toBe(false);
  }
});
it('notifies only active responsible colleagues with access, once per correction', () => {
  const db = server.db; const row = db.listCollection('news')[3];
  const users = db.listCollection('users').map(r => r.d);
  const admin = users.find(u => u.role === 'SUPER_ADMIN');
  const auth = buildAuthContext(db, admin, 'test');
  db.writeRow('episodes', 'correction-linked-episode', { id: 'correction-linked-episode', rundown: [{ newsId: row.id }], producerId: admin.id, presenterId: admin.id }, 0, null);
  db.writeRow('episodes', 'correction-no-owner', { id: 'correction-no-owner', rundown: [{ newsId: row.id }] }, 0, null);
  const before = db.listCollection('notifications').length;
  const input = { newsId: row.id, expectedVersion: row.v, reason: 'سبب', summary: 'ملخص', requestId: 'recipient-request-123' };
  const record = createNewsCorrection(db, auth, input);
  const alerts = db.listCollection('notifications').filter(r => r.id.startsWith(record.id));
  expect(alerts).toHaveLength(1); expect(alerts[0].d.userId).toBe(admin.id);
  createNewsCorrection(db, auth, input);
  expect(db.listCollection('notifications')).toHaveLength(before + 1);
});
it('never returns hidden correction data through rejected generic writes', () => {
  const record = server.db.listCollection('newsCorrections')[0];
  const user = server.db.listCollection('users')[0].d;
  const auth = { ...buildAuthContext(server.db, user, 'test'), can: () => false };
  const sync = new SyncService(server.db, server.config.dataDir);
  for (const op of [{ c: 'newsCorrections', op: 'upsert', id: record.id, baseV: 0, d: {} }, { c: 'newsCorrections', op: 'upsert', id: record.id, baseV: record.v, d: {} }, { c: 'newsCorrections', op: 'delete', id: record.id }]) {
    const result = sync.apply(auth, [op as any])[0];
    expect(result.ok).toBe(false); expect(result).not.toHaveProperty('current');
  }
});
it('hides corrections whose referenced news was deleted from synchronization', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const row = server.db.listCollection('news')[1];
  const result = await admin.post(`/api/v1/news/${row.id}/corrections`).set('X-NRCS-Client', 'web').send({ expectedVersion: row.v, reason: 'سبب', summary: 'ملخص', requestId: 'deleted-source-test' });
  expect(result.status).toBe(200);
  server.db.writeRow('news', row.id, { ...row.d, deletedAt: new Date().toISOString() }, row.p, null);
  const data = await admin.get('/api/v1/data');
  expect(data.body.collections.newsCorrections.some((r: any) => r.id === result.body.data.id)).toBe(false);
});
it('validates exact limits and reloads revoked authority before accepting a record', () => {
  const user = server.db.listCollection('users').map(r => r.d).find(u => u.role === 'SUPER_ADMIN');
  const auth = buildAuthContext(server.db, user, 'test'); const row = server.db.listCollection('news')[2];
  const input = { newsId: row.id, expectedVersion: row.v, reason: 'x'.repeat(2000), summary: 'y'.repeat(1000), requestId: 'limits-request-123' };
  expect(createNewsCorrection(server.db, auth, input).reason.length).toBe(2000);
  expect(() => createNewsCorrection(server.db, auth, { ...input, reason: input.reason + 'x', requestId: 'over-limit-123' })).toThrow();
  expect(() => createNewsCorrection(server.db, auth, { ...input, summary: input.summary + 'x', requestId: 'over-summary-123' })).toThrow();
  server.db.writeRow('users', user.id, { ...user, isActive: false }, 0, null);
  expect(() => createNewsCorrection(server.db, auth, { ...input, requestId: 'revoked-request-123' })).toThrow();
  server.db.writeRow('users', user.id, { ...user, role: 'REPORTER', isActive: true }, 0, null);
  expect(() => createNewsCorrection(server.db, auth, { ...input, requestId: 'revoked-permission-123' })).toThrow();
  server.db.writeRow('users', user.id, user, 0, null);
});
