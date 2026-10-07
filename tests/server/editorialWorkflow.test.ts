import { beforeEach, afterEach, it, expect } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { plainText } from '../../src/shared/bulletins';
let server: Awaited<ReturnType<typeof createTestServer>>;
beforeEach(async () => { server = await createTestServer(); });
afterEach(() => server.close());
it('review threads stamp actors and replies must match the entity', async () => {
  const editor = await loginAgent(server.app, 'editor@akhbar.tv');
  const row = server.db.listCollection('news')[0];
  const input = { id: 'review-test', collection: 'news', entityId: row.id, field: 'content', baseVersion: row.d.updatedAt, quote: plainText(row.d.content).slice(0, 15), contextBefore: '', contextAfter: '', resolved: false, createdById: 'forged', createdAt: '1900' };
  const response = await editor.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [{ c: 'reviewThreads', op: 'upsert', id: input.id, d: input }] });
  expect(response.body.results[0].ok).toBe(true);
  const saved = server.db.getRow('reviewThreads', input.id)!;
  expect(saved.d.createdById).not.toBe('forged');
  expect(saved.d.createdAt).not.toBe('1900');
  const reply = await editor.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [{ c: 'comments', op: 'upsert', id: 'wrong-reply', d: { id: 'wrong-reply', threadId: input.id, target: { kind: 'news', id: 'other', title: 'other' }, text: 'رد', mentions: [] } }] });
  expect(reply.body.results[0].ok).toBe(false);
  const viewer = await loginAgent(server.app, 'trainee@akhbar.tv');
  const resolve = await viewer.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [{ c: 'reviewThreads', op: 'upsert', id: input.id, baseV: saved.v, d: { ...saved.d, resolved: true } }] });
  expect(resolve.body.results[0].ok).toBe(false);
});
it('a linked task rejects invalid assignees and targets', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const response = await admin.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [{ c: 'tasks', op: 'upsert', id: 'invalid-task', d: { id: 'invalid-task', title: 'test', status: 'TODO', assigneeId: 'missing', relatedEntityType: 'BULLETIN', relatedEntityId: 'missing' } }] });
  expect(response.body.results[0].ok).toBe(false);
});
it('authors cannot close their own review and anchors must refer to the saved revision', async () => {
  const writer = await loginAgent(server.app, 'journalist@akhbar.tv');
  const who = (await writer.get('/api/v1/auth/me')).body.user;
  const row = server.db.listCollection('news').find(r => r.d.authorId === who.id)!;
  server.db.writeRow('news', row.id, { ...row.d, status: 'DRAFT' }, row.p, null);
  const input = { id: 'own-review', collection: 'news', entityId: row.id, field: 'content', baseVersion: row.d.updatedAt, quote: plainText(row.d.content).slice(0, 15), contextBefore: '', contextAfter: '', resolved: false };
  const send = (id: string, d: any, baseV?: number) => writer.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [{ c: 'reviewThreads', op: 'upsert', id, d, baseV }] });
  expect((await send('stale-review', { ...input, id: 'stale-review', baseVersion: 'old' })).body.results[0].ok).toBe(false);
  expect((await send(input.id, input)).body.results[0]).toMatchObject({ ok: true });
  const saved = server.db.getRow('reviewThreads', input.id)!;
  expect((await send(input.id, { ...saved.d, resolved: true }, saved.v)).body.results[0].ok).toBe(false);
});
