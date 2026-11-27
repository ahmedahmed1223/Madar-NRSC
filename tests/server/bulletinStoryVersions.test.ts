import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';

const header = { 'X-NRCS-Client': 'web' };
const bulletinId = 'versioned-bulletin';
const storyId = 'versioned-story';
const historyPath = `/api/v1/bulletins/${bulletinId}/stories/${storyId}/history`;
let server: Awaited<ReturnType<typeof createTestServer>>;

beforeEach(async () => {
  server = await createTestServer();
  const bulletin = server.db.listCollection('bulletins')[0].d;
  server.db.writeRow('bulletins', bulletinId, { ...bulletin, id: bulletinId, editorId: 'usr-2', approvalSteps: [] }, 0, null);
  server.db.writeRow('bulletinStories', storyId, { id: storyId, bulletinId, rank: 1000, slug: 'خبر النشرة', type: 'READER', script: 'النص السابق', status: 'READY', writerId: 'usr-3' }, 7, 'usr-3');
});
afterEach(() => server.close());

const row = () => server.db.getRow('bulletinStories', storyId)!;
const signIn = (role: 'journalist' | 'editor' | 'admin') => loginAgent(server.app, `${role}@akhbar.tv`);
type Agent = Awaited<ReturnType<typeof signIn>>;
const sync = async (actor: Agent, op: object) => (await actor.post('/api/v1/data/sync').set(header).send({ ops: [op] })).body.results[0];
const save = (actor: Agent, base: ReturnType<typeof row>, patch: object) => sync(actor, { c: 'bulletinStories', id: storyId, op: 'upsert', baseV: base.v, d: { ...base.d, ...patch } });

it('lets a rank move coexist with another editor’s text lock and preserves both edits', async () => {
  const writer = await signIn('journalist');
  const editor = await signIn('editor');
  const base = row();
  const id = `bulletinStories:${storyId}`;
  expect(await sync(writer, { c: 'editLocks', id, op: 'upsert', d: { id, collection: 'bulletinStories', entityId: storyId } })).toMatchObject({ ok: true });
  expect(await save(editor, base, { rank: 1300, script: 'محاولة تغيير النص' })).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(await save(editor, base, { rank: 1500 })).toMatchObject({ ok: true });
  expect(await save(editor, base, { rank: 1700 })).toMatchObject({ ok: false, code: 'CONFLICT', current: { d: { rank: 1500 } } });
  expect(await save(writer, base, { script: 'تحديث النص مع ثبات الترتيب' })).toMatchObject({ ok: true });
  expect(row().d).toMatchObject({ rank: 1500, script: 'تحديث النص مع ثبات الترتيب' });
  expect(row().p).toBe(7);
});

it('keeps the first saved script and prevents stale editorial approval of a changed script', async () => {
  const writer = await signIn('journalist');
  const editor = await signIn('editor');
  const base = row();
  expect(await save(writer, base, { script: 'النص الأول المحفوظ' })).toMatchObject({ ok: true });
  expect(await save(editor, base, { script: 'النص الثاني' })).toMatchObject({ ok: false, code: 'CONFLICT', current: { d: { script: 'النص الأول المحفوظ' } } });
  expect(await save(editor, base, { status: 'APPROVED' })).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(await save(editor, base, { rank: 1800 })).toMatchObject({ ok: true });
  expect(await save(editor, row(), { status: 'APPROVED' })).toMatchObject({ ok: true });
  expect(row().d).toMatchObject({ rank: 1800, script: 'النص الأول المحفوظ', status: 'APPROVED' });
});

it('shows authorized history and restores a saved script as a new draft at the current rank', async () => {
  const writer = await signIn('journalist');
  const editor = await signIn('editor');
  const base = row();
  expect(await save(writer, base, { script: 'النص المعتمد حديثا', rank: 2500, floated: true })).toMatchObject({ ok: true });
  expect(await save(editor, row(), { status: 'APPROVED' })).toMatchObject({ ok: true });
  const history = await editor.get(historyPath);
  expect(history.status).toBe(200);
  expect(history.body.data).toMatchObject({ current: { v: row().v, d: { script: 'النص المعتمد حديثا' } }, canRestore: true,
    versions: expect.arrayContaining([expect.objectContaining({ version: base.v, data: expect.objectContaining({ script: 'النص السابق' }) })]) });
  const restore = (actor: Agent, baseV: number) => actor.post(`${historyPath}/restore`).set(header).send({ version: base.v, baseV });
  expect((await restore(writer, row().v)).status).toBe(403);
  expect((await restore(editor, base.v)).status).toBe(409);
  expect((await restore(editor, row().v)).status).toBe(200);
  expect(row().d).toMatchObject({ rank: 2500, floated: true, script: 'النص السابق', status: 'DRAFT', approvals: [] });
  expect(row().d.approvedAt).toBeUndefined();
  expect(server.db.listHistory('bulletinStories', storyId).some(entry => entry.data.script === 'النص المعتمد حديثا')).toBe(true);
});
