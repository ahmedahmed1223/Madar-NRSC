import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';

type Agent = Awaited<ReturnType<typeof loginAgent>>;
const change = async (agent: Agent, op: object) => (await agent.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [op] })).body.results[0];
let server: Awaited<ReturnType<typeof createTestServer>>;
beforeEach(async () => { server = await createTestServer(); });
afterEach(() => server.close());

it('syncs preferences and notes across devices of the same account and keeps them private', async () => {
  const owner = await loginAgent(server.app, 'reporter@akhbar.tv');
  const other = await loginAgent(server.app, 'admin@akhbar.tv');
  const user = (await owner.get('/api/v1/auth/me')).body.user;
  const note = { c: 'personalNotes', id: 'note-private', op: 'upsert', d: { ownerId: 'untrusted', title: 'متابعة المناوبة', body: 'مسودة خاصة', pinned: true } };
  const saved = await change(owner, note);
  expect(saved.row.d).toMatchObject({ title: 'متابعة المناوبة', ownerId: user.id, pinned: true });
  const preferences = { c: 'workspacePrefs', id: user.id, op: 'upsert', d: { workSections: { order: ['my-tasks'], hidden: [] } } };
  expect((await change(owner, preferences)).ok).toBe(true);

  const secondDevice = await loginAgent(server.app, 'reporter@akhbar.tv');
  const ownerView = (await secondDevice.get('/api/v1/data')).body;
  expect(ownerView.collections.personalNotes.map(({ id }: { id: string }) => id)).toEqual([note.id]);
  expect(ownerView.collections.workspacePrefs[0].d.workSections.order[0]).toBe('my-tasks');
  const otherView = (await other.get('/api/v1/data')).body;
  expect(otherView.collections.personalNotes).toEqual([]);
  expect(otherView.collections.workspacePrefs).toEqual([]);
  expect(await change(other, { ...note, baseV: saved.row.v })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(await change(other, preferences)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect((await change(owner, { c: note.c, id: note.id, op: 'delete', baseV: saved.row.v })).ok).toBe(true);
  expect((await secondDevice.get('/api/v1/data/changes').query({ since: ownerView.rev, access: ownerView.access })).body.changes)
    .toEqual([{ c: 'personalNotes', id: note.id, v: saved.row.v + 1, p: saved.row.p, deleted: true }]);
  expect((await other.get('/api/v1/data/changes').query({ since: otherView.rev })).body.changes).toEqual([]);
});
