import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
let server: Awaited<ReturnType<typeof createTestServer>>;
let author: Awaited<ReturnType<typeof loginAgent>>;
let recipient: typeof author;
let manager: typeof author;
let authorId: string;
let recipientId: string;
const draft = (id: string, extra = {}) => ({ id, schemaVersion: 1, departmentId: 'newsroom', sourceDate: '2026-10-11', sourceShift: 'MORNING', recipientDate: '2026-10-11', recipientShift: 'EVENING', title: 'Shift', note: 'Department note', references: [], ...extra });
const post = (agent: typeof author, url: string, body: any) => agent.post(`/api/v1/shift-handovers${url}`).set('X-NRCS-Client', 'web').send(body);
const patch = (agent: typeof author, id: string, body: any) => agent.patch(`/api/v1/shift-handovers/${id}`).set('X-NRCS-Client', 'web').send(body);
beforeAll(async () => {
  server = await createTestServer();
  author = await loginAgent(server.app, 'journalist@akhbar.tv');
  recipient = await loginAgent(server.app, 'editor@akhbar.tv');
  manager = await loginAgent(server.app, 'admin@akhbar.tv');
  authorId = (await author.get('/api/v1/auth/me')).body.user.id;
  recipientId = (await recipient.get('/api/v1/auth/me')).body.user.id;
});
afterAll(() => server.close());
it('creates a private versioned draft with server actor and denies guessed IDs even to managers', async () => {
  const bad = await post(author, '', { ...draft('forged'), authorId: 'forged', createdAt: 'yesterday' });
  expect(bad.status).toBe(400);
  const created = await post(author, '', draft('private'));
  expect(created.status).toBe(200);
  expect(created.body.row.d.authorId).toBe(authorId);
  expect(created.body.row.d.state).toBe('DRAFT');
  expect((await manager.get('/api/v1/shift-handovers/private')).status).toBe(404);
  expect((await manager.get('/api/v1/shift-handovers')).body.rows.some((r: any) => r.id === 'private')).toBe(false);
  expect((await patch(author, 'private', { draft: draft('private', { title: 'Changed' }), baseV: 999 })).status).toBe(409);
  const saved = await patch(author, 'private', { draft: draft('private', { title: 'Changed' }), baseV: created.body.row.v });
  expect(saved.status).toBe(200);
  const deleted = await author.delete('/api/v1/shift-handovers/private').set('X-NRCS-Client', 'web').send({ baseV: saved.body.row.v });
  expect(deleted.status).toBe(200);
  expect((await post(author, '', draft('private'))).status).toBe(409);
});
it('requires explicit source authorization and view permission, including missing department', async () => {
  expect((await post(author, '', draft('other-dept', { departmentId: 'graphics' }))).status).toBe(403);
  const user = server.db.getRow('users', authorId)!;
  server.db.writeRow('users', authorId, { ...user.d, customPermissions: ['!handover.view'] }, user.p, null);
  expect((await post(author, '', draft('no-view'))).status).toBe(403);
  server.db.writeRow('users', authorId, { ...user.d, departmentId: undefined }, user.p, null);
  expect((await post(author, '', draft('no-department'))).status).toBe(403);
  server.db.writeRow('roster', 'source-roster', { id: 'source-roster', date: '2026-10-11', shift: 'MORNING', departmentId: 'newsroom', userId: authorId }, 0, null);
  expect((await post(author, '', draft('roster-authorized'))).status).toBe(200);
  server.db.deleteRow('roster', 'source-roster', null);
  expect((await post(author, '/roster-authorized/publish', { baseV: 1 })).status).toBe(403);
  server.db.writeRow('users', authorId, user.d, user.p, null);
});
it('publishes immutably and creates an explicitly linked correction with its own author', async () => {
  const created = await post(author, '', draft('published'));
  expect(created.status).toBe(200);
  expect((await post(author, '/published/publish', { baseV: 999 })).status).toBe(409);
  const published = await post(author, '/published/publish', { baseV: created.body.row.v });
  expect(published.status).toBe(200);
  expect(published.body.row.d.publishedAt).toBeTruthy();
  expect((await patch(author, 'published', { draft: draft('published'), baseV: published.body.row.v })).status).toBe(409);
  expect((await author.delete('/api/v1/shift-handovers/published').set('X-NRCS-Client', 'web').send({ baseV: published.body.row.v })).status).toBe(409);
  const correction = await post(manager, '', draft('correction', { supersedesId: 'published' }));
  expect(correction.status).toBe(200);
  expect(correction.body.row.d.authorId).not.toBe(authorId);
  expect(correction.body.row.receipts).toEqual([]);
  expect((await post(manager, '', draft('bad-correction', { departmentId: 'graphics', supersedesId: 'published' }))).status).toBe(403);
});
it('projects hidden references in list detail and version conflicts without target metadata', async () => {
  server.db.writeRow('news', 'secret-reference', { id: 'secret-reference', title: 'Secret title' }, 0, null);
  const made = await post(author, '', draft('projection', { references: [{ collection: 'news', id: 'secret-reference', note: 'Secret note' }] }));
  expect(made.status).toBe(200);
  const user = server.db.getRow('users', authorId)!;
  server.db.writeRow('users', authorId, { ...user.d, customPermissions: ['!news.view'] }, user.p, null);
  for (const response of [await author.get('/api/v1/shift-handovers/projection'), await patch(author, 'projection', { draft: draft('projection'), baseV: 999 })]) {
    expect(JSON.stringify(response.body)).not.toContain('secret-reference');
    expect(JSON.stringify(response.body)).not.toContain('Secret');
    expect((response.body.row || response.body.current).d.references).toEqual([{ available: false }]);
  }
  server.db.writeRow('users', authorId, user.d, user.p, null);
});
it('never exposes server-only collections through generic bootstrap changes or mutation conflicts', async () => {
  const rev = server.db.currentRev();
  server.db.writeRow('handoverReceipts', 'hidden-receipt', { id: 'hidden-receipt', note: 'secret receipt' }, 0, null);
  server.db.deleteRow('handoverReceipts', 'hidden-receipt', null);
  const bootstrap = await manager.get('/api/v1/data');
  expect(bootstrap.body.collections.shiftHandovers).toEqual([]);
  expect(bootstrap.body.collections.handoverReceipts).toEqual([]);
  const changes = await manager.get(`/api/v1/data/changes?since=${rev}`);
  expect(changes.body.changes.filter((r: any) => ['shiftHandovers', 'handoverReceipts'].includes(r.c))).toEqual([]);
  for (const c of ['shiftHandovers', 'handoverReceipts']) for (const op of ['upsert', 'delete']) {
    const res = await manager.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [{ c, op, id: c === 'shiftHandovers' ? 'published' : 'hidden-receipt', baseV: 999, d: {} }] });
    expect(res.body.results[0].code).toBe('FORBIDDEN');
    expect(res.body.results[0]).not.toHaveProperty('current');
  }
});
it('reading never acknowledges and explicit receipts require recipient membership and forbid self receipt', async () => {
  expect((await recipient.get('/api/v1/shift-handovers/published')).body.row.receipts).toEqual([]);
  expect((await post(recipient, '/published/acknowledge', { note: '' })).status).toBe(403);
  for (const id of [authorId, recipientId]) server.db.writeRow('roster', `incoming-${id}`, { id: `incoming-${id}`, date: '2026-10-11', shift: 'EVENING', departmentId: 'newsroom', userId: id }, 0, null);
  expect((await post(author, '/published/acknowledge', { note: '' })).status).toBe(403);
  expect((await post(recipient, '/published/acknowledge', { note: '', userId: authorId })).status).toBe(400);
  expect((await post(recipient, '/published/acknowledge', { note: 'a'.repeat(501) })).status).toBe(400);
  const first = await post(recipient, '/published/acknowledge', { note: 'Received' });
  expect(first.status).toBe(200);
  const again = await post(recipient, '/published/acknowledge', { note: 'Do not overwrite' });
  expect(again.body.receipt).toEqual(first.body.receipt);
  expect((await recipient.get('/api/v1/shift-handovers/published')).body.row.receipts).toHaveLength(1);
  server.db.deleteRow('roster', `incoming-${recipientId}`, null);
  expect((await post(recipient, '/published/acknowledge', { note: '' })).status).toBe(403);
  expect(server.db.listCollection('handoverReceipts').filter(r => r.d.publicationId === 'published')).toHaveLength(1);
  expect((await manager.get('/api/v1/shift-handovers/correction')).body.row.receipts).toEqual([]);
});
