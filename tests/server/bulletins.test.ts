import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';
import { createScheduledBulletins } from '../../src/server/scheduler';
import { localDateString } from '../../src/shared/dates';
import { scheduledBulletinId } from '../../src/shared/bulletins';

let server: Awaited<ReturnType<typeof createTestServer>>;
const H = { 'X-NRCS-Client': 'web' };
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(() => server.close());

const sync = (agent: request.Agent, ops: any[]) => agent.post('/api/v1/data/sync').set(H).send({ ops });
const put = (c: string, d: any, baseV?: number) => ({ c, op: 'upsert', id: d.id, d, ...(baseV ? { baseV } : {}) });
const row = (c: any, id: string) => server.db.getRow(c, id)!;
const now = new Date().toISOString();
const bulletin = (id: string, extra: any = {}) => ({
  id, title: 'نشرة الاختبار', kind: 'MAIN', date: '2026-10-01', startTime: '20:00', plannedSeconds: 1800,
  anchors: ['فيصل العتيبي'], status: 'PLANNING', editorId: 'usr-2', createdAt: now, updatedAt: now, ...extra,
});
const story = (id: string, extra: any = {}) => ({
  id, bulletinId: 'bul-t1', rank: 1000, slug: 'القمة', type: 'READER', script: 'نص الخبر للمذيع', status: 'DRAFT', createdAt: now, updatedAt: now, ...extra,
});

describe('bulletins', () => {
  it('only bulletin managers create bulletins; the editor name comes from the directory', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    expect((await sync(journalist, [put('bulletins', bulletin('bul-x'))])).body.results[0].code).toBe('FORBIDDEN');
    const producer = await loginAgent(server.app, 'producer@akhbar.tv');
    const res = await sync(producer, [put('bulletins', bulletin('bul-t1', { editorName: 'مزيف' }))]);
    expect(res.body.results[0].ok).toBe(true);
    expect(row('bulletins', 'bul-t1').d.editorName).not.toBe('مزيف');
    // The assigned editor is told.
    expect(server.db.listCollection('notifications').some((n) => n.d.userId === 'usr-2' && n.d.title.includes('محرر النشرة'))).toBe(true);
  });

  it('writers mark stories ready; only the bulletin editor approves; edits send approved copy back', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv'); // usr-3
    const created = await sync(journalist, [put('bulletinStories', story('bst-1', { status: 'APPROVED', writerId: 'usr-9' }))]);
    expect(created.body.results[0].ok).toBe(true);
    expect(row('bulletinStories', 'bst-1').d).toMatchObject({ status: 'DRAFT', writerId: 'usr-3' });

    const ready = await sync(journalist, [put('bulletinStories', { ...row('bulletinStories', 'bst-1').d, status: 'READY' }, row('bulletinStories', 'bst-1').v)]);
    expect(ready.body.results[0].ok).toBe(true);
    expect(server.db.listCollection('notifications').some((n) => n.d.userId === 'usr-2' && n.d.title.includes('جاهزة للاعتماد'))).toBe(true);

    const selfApprove = await sync(journalist, [put('bulletinStories', { ...row('bulletinStories', 'bst-1').d, status: 'APPROVED' }, row('bulletinStories', 'bst-1').v)]);
    expect(selfApprove.body.results[0].code).toBe('FORBIDDEN');

    const editor = await loginAgent(server.app, 'editor@akhbar.tv'); // usr-2, the bulletin editor
    const approved = await sync(editor, [put('bulletinStories', { ...row('bulletinStories', 'bst-1').d, status: 'APPROVED' }, row('bulletinStories', 'bst-1').v)]);
    expect(approved.body.results[0].ok).toBe(true);
    expect(row('bulletinStories', 'bst-1').d.approvedById).toBe('usr-2');

    // The writer changes the approved copy: it goes back for approval.
    const edited = await sync(journalist, [put('bulletinStories', { ...row('bulletinStories', 'bst-1').d, script: 'نص معدل بعد الاعتماد' }, row('bulletinStories', 'bst-1').v)]);
    expect(edited.body.results[0].ok).toBe(true);
    expect(row('bulletinStories', 'bst-1').d.status).toBe('READY');
    expect(row('bulletinStories', 'bst-1').d.approvedById).toBeUndefined();

    // Floating or reordering is not a copy change and keeps approval.
    await sync(editor, [put('bulletinStories', { ...row('bulletinStories', 'bst-1').d, status: 'APPROVED' }, row('bulletinStories', 'bst-1').v)]);
    await sync(journalist, [put('bulletinStories', { ...row('bulletinStories', 'bst-1').d, rank: 500, floated: true }, row('bulletinStories', 'bst-1').v)]);
    expect(row('bulletinStories', 'bst-1').d.status).toBe('APPROVED');

    // Sent back to the writer with a note.
    await sync(editor, [put('bulletinStories', { ...row('bulletinStories', 'bst-1').d, status: 'DRAFT', returnNote: 'اختصر المقدمة' }, row('bulletinStories', 'bst-1').v)]);
    expect(server.db.listCollection('notifications').some((n) => n.d.userId === 'usr-3' && n.d.message.includes('اختصر المقدمة'))).toBe(true);
  });

  it('a story being edited is locked for colleagues, while other stories stay editable', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    await sync(journalist, [put('bulletinStories', story('bst-l1')), put('bulletinStories', story('bst-l2', { rank: 2000 }))]);
    const lock = await sync(journalist, [
      { c: 'editLocks', op: 'upsert', id: 'bulletinStories:bst-l1', d: { id: 'bulletinStories:bst-l1', collection: 'bulletinStories', entityId: 'bst-l1', expiresAt: new Date(Date.now() + 60_000).toISOString() } },
    ]);
    expect(lock.body.results[0].ok).toBe(true);
    const blocked = await sync(editor, [put('bulletinStories', { ...row('bulletinStories', 'bst-l1').d, slug: 'تعديل' }, row('bulletinStories', 'bst-l1').v)]);
    expect(blocked.body.results[0].code).toBe('CONFLICT');
    const other = await sync(editor, [put('bulletinStories', { ...row('bulletinStories', 'bst-l2').d, slug: 'تعديل' }, row('bulletinStories', 'bst-l2').v)]);
    expect(other.body.results[0].ok).toBe(true);
  });

  it('presenters read but cannot write stories, and bad stories are refused', async () => {
    const presenter = await loginAgent(server.app, 'presenter@akhbar.tv');
    expect((await sync(presenter, [put('bulletinStories', story('bst-p'))])).body.results[0].code).toBe('FORBIDDEN');
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    expect((await sync(journalist, [put('bulletinStories', story('bst-bad', { type: 'X' }))])).body.results[0].ok).toBe(false);
    expect((await sync(journalist, [put('bulletinStories', story('bst-orphan', { bulletinId: 'nope' }))])).body.results[0].ok).toBe(false);
  });

  it('runs on air like an episode, and exports a MOS running order', async () => {
    const director = await loginAgent(server.app, 'director@akhbar.tv');
    const first = server.db.listCollection('bulletinStories').map((r) => r.d).filter((s) => s.bulletinId === 'bul-demo-main' && !s.floated).sort((a, b) => a.rank - b.rank)[0];
    const live = await sync(director, [{ c: 'onAir', op: 'upsert', id: 'bul-demo-main', d: { id: 'bul-demo-main', episodeId: 'bul-demo-main', status: 'LIVE', currentSegmentId: first.id } }]);
    expect(live.body.results[0].ok).toBe(true);
    expect(row('bulletins', 'bul-demo-main').d.status).toBe('ON_AIR');
    expect(row('onAir', 'bul-demo-main').d.episodeTitle).toContain('نشرة');

    const mos = await director.get('/api/v1/bulletins/bul-demo-main/mos');
    expect(mos.status).toBe(200);
    expect(mos.text).toContain('<roCreate>');
    expect(mos.text).toContain('<storyType>PKG</storyType>');
    expect(mos.text).not.toContain('خبر احتياطي'); // floated stories are not in the running order
  });

  it('creates scheduled bulletins once, only for formats set to auto-create', async () => {
    const f = server.db.getRow('bulletinFormats', 'fmt-main')!;
    expect(createScheduledBulletins(server.db)).toEqual([]); // autoCreate is off
    server.db.writeRow('bulletinFormats', f.id, { ...f.d, autoCreate: true }, f.p, null);
    const created = createScheduledBulletins(server.db);
    const today = localDateString();
    expect(created).toContain(scheduledBulletinId('fmt-main', today));
    expect(server.db.listCollection('bulletinStories').filter((r) => r.d.bulletinId === scheduledBulletinId('fmt-main', today)).length).toBe(8);
    expect(createScheduledBulletins(server.db)).toEqual([]);
  });
});
