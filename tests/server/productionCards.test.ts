import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
const H = { 'X-NRCS-Client': 'web' };
const sync = (agent: request.Agent, ops: any[]) => agent.post('/api/v1/data/sync').set(H).send({ ops });
const cardRow = (id: string) => server.db.getRow('productionCards', id)!;
const upsert = (id: string, d: any, baseV?: number) => ({ c: 'productionCards', op: 'upsert', id, d: { ...d, id }, ...(baseV === undefined ? {} : { baseV }) });
const notesFor = (userId: string) => server.db.listCollection('notifications').map((r) => r.d).filter((n) => n.userId === userId && String(n.linkUrl).startsWith('/cards/'));

let admin: request.Agent;
let editor: request.Agent;
let journalist: request.Agent;
let reporter: request.Agent;
let media: request.Agent;
let viewer: request.Agent;

const setStation = (userId: string, stationId: string | undefined) => {
  const row = server.db.getRow('users', userId)!;
  server.db.writeRow('users', userId, { ...row.d, stationId }, row.p, null);
};

beforeAll(async () => {
  server = await createTestServer();
  // usr-2 editor (Beirut), usr-3 journalist (Beirut), usr-6 reporter (Gaza), usr-7 media (Istanbul).
  setStation('usr-2', 'beirut');
  setStation('usr-3', 'beirut');
  setStation('usr-6', 'gaza');
  setStation('usr-7', 'istanbul');
  admin = await loginAgent(server.app, 'admin@akhbar.tv');
  editor = await loginAgent(server.app, 'editor@akhbar.tv');
  journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
  reporter = await loginAgent(server.app, 'reporter@akhbar.tv');
  media = await loginAgent(server.app, 'media@akhbar.tv');
  viewer = await loginAgent(server.app, 'trainee@akhbar.tv');
});
afterAll(() => server.close());

const newCard = () => ({
  title: '  شهادة مصوّرة من غزة ',
  kind: 'REPORT',
  priority: 'URGENT',
  status: 'OPEN',
  brief: 'شهادة شاهد عيان مع صور الموقع',
  airAt: '2026-11-20T18:00:00.000Z',
  createdByName: 'اسم مزور',
  steps: [
    { id: 's1', type: 'gather', status: 'TODO', complexity: 3, assigneeId: 'usr-6', assigneeName: 'اسم مزور', stationId: 'istanbul', doneAt: '2020-01-01T00:00:00.000Z' },
    { id: 's2', type: 'verify', status: 'TODO', complexity: 1, assigneeId: 'usr-3' },
    { id: 's3', type: 'montage', status: 'TODO', complexity: 2, stationId: 'istanbul' },
  ],
  log: [],
});

describe('production cards on the server', () => {
  it('lets a supervisor create a card; names, stations and times come from the server', async () => {
    const denied = await sync(journalist, [upsert('crd-a', newCard())]);
    expect(denied.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    const created = await sync(editor, [upsert('crd-a', newCard())]);
    expect(created.body.results[0].ok).toBe(true);
    const card = cardRow('crd-a').d;
    expect(card.title).toBe('شهادة مصوّرة من غزة');
    expect(card).toMatchObject({ createdById: 'usr-2', ownerId: 'usr-2', ownerStationId: 'beirut' });
    expect(card.createdByName).not.toBe('اسم مزور');
    expect(card.steps[0]).toMatchObject({ assigneeId: 'usr-6', stationId: 'gaza' });
    expect(card.steps[0].assigneeName).not.toBe('اسم مزور');
    expect(card.steps[0].doneAt).toBeUndefined();
    expect(card.steps[1].stationId).toBe('beirut');
    expect(card.steps[2].stationId).toBe('istanbul');
    // Both assignees hear about their step; the supervisor who made the card does not.
    expect(notesFor('usr-6')).toHaveLength(1);
    expect(notesFor('usr-6')[0]).toMatchObject({ linkUrl: '/cards/crd-a', urgent: true });
    expect(notesFor('usr-3')).toHaveLength(1);
    expect(notesFor('usr-2')).toHaveLength(0);
  });

  it('lets the assignee work on their own step only, and hands the item to the next colleague', async () => {
    const start = cardRow('crd-a');
    const mine = { ...start.d, steps: start.d.steps.map((s: any) => (s.id === 's1' ? { ...s, status: 'DONE', note: 'رُفعت الشهادة، ينقص اسم الشاهد', spentMinutes: 95, doneByName: 'اسم مزور' } : s)) };
    const others = { ...start.d, steps: start.d.steps.map((s: any) => (s.id === 's2' ? { ...s, status: 'DONE' } : s)) };

    expect((await sync(reporter, [upsert('crd-a', others, start.v)])).body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect((await sync(reporter, [upsert('crd-a', { ...start.d, title: 'عنوان آخر' }, start.v)])).body.results[0].ok).toBe(false);
    expect((await sync(viewer, [upsert('crd-a', mine, start.v)])).body.results[0].ok).toBe(false);

    const done = await sync(reporter, [upsert('crd-a', mine, start.v)]);
    expect(done.body.results[0].ok).toBe(true);
    const step = cardRow('crd-a').d.steps[0];
    expect(step).toMatchObject({ status: 'DONE', doneById: 'usr-6', spentMinutes: 95 });
    expect(step.doneByName).not.toBe('اسم مزور');
    expect(Date.parse(step.doneAt)).toBeGreaterThan(Date.now() - 60_000);
    // The server documents the handoff and tells the next person what is complete and missing.
    const log = cardRow('crd-a').d.log;
    expect(log.at(-1)).toMatchObject({ kind: 'STEP', stepId: 's1', byId: 'usr-6', stationId: 'gaza' });
    expect(log.at(-1).text).toContain('ينقص اسم الشاهد');
    const handoff = notesFor('usr-3').at(0)!;
    expect(handoff.title).toContain('وصلتك المادة');
    expect(handoff.message).toContain('ينقص اسم الشاهد');
  });

  it('lets a colleague of the addressed station pick up an open step', async () => {
    const start = cardRow('crd-a');
    const claim = (userId: string) => ({ ...start.d, steps: start.d.steps.map((s: any) => (s.id === 's3' ? { ...s, assigneeId: userId, status: 'IN_PROGRESS' } : s)) });
    expect((await sync(reporter, [upsert('crd-a', claim('usr-6'), start.v)])).body.results[0].ok).toBe(false);
    expect((await sync(media, [upsert('crd-a', claim('usr-7'), start.v)])).body.results[0].ok).toBe(true);
    const step = cardRow('crd-a').d.steps[2];
    expect(step).toMatchObject({ assigneeId: 'usr-7', stationId: 'istanbul', status: 'IN_PROGRESS' });
    expect(step.startedAt).toBeTruthy();
  });

  it('requires a reason for a blocked step and alerts the decision owner', async () => {
    const start = cardRow('crd-a');
    const block = (reason?: string) => ({ ...start.d, steps: start.d.steps.map((s: any) => (s.id === 's2' ? { ...s, status: 'BLOCKED', blockedReason: reason } : s)) });
    expect((await sync(journalist, [upsert('crd-a', block(), start.v)])).body.results[0].ok).toBe(false);
    const before = notesFor('usr-2').length;
    expect((await sync(journalist, [upsert('crd-a', block('لم يرد المصدر على الهاتف'), start.v)])).body.results[0].ok).toBe(true);
    const alert = notesFor('usr-2').slice(0, notesFor('usr-2').length - before)[0];
    expect(alert.title).toContain('قرارك');
    expect(alert.message).toContain('لم يرد المصدر');
    expect(alert.urgent).toBe(true);
  });

  it('keeps the trail append-only and stamps the author of every note', async () => {
    const start = cardRow('crd-a');
    const note = { id: 'log-note-1', kind: 'NOTE', text: ' تواصلت مع المصدر مجدداً ', byId: 'usr-1', byName: 'اسم مزور', stationId: 'gaza', at: '2020-01-01T00:00:00.000Z' };
    expect((await sync(journalist, [upsert('crd-a', { ...start.d, log: [...start.d.log, note] }, start.v)])).body.results[0].ok).toBe(true);
    const saved = cardRow('crd-a');
    expect(saved.d.log.at(-1)).toMatchObject({ id: 'log-note-1', kind: 'NOTE', text: 'تواصلت مع المصدر مجدداً', byId: 'usr-3', stationId: 'beirut' });
    expect(saved.d.log.at(-1).at).not.toBe('2020-01-01T00:00:00.000Z');
    const rewritten = { ...saved.d, log: saved.d.log.slice(1) };
    expect((await sync(editor, [upsert('crd-a', rewritten, saved.v)])).body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('leaves script approval to supervisors and withdraws it when someone else changes the text', async () => {
    let row = cardRow('crd-a');
    expect((await sync(journalist, [upsert('crd-a', { ...row.d, script: 'نص التقرير', scriptApproved: true }, row.v)])).body.results[0].ok).toBe(false);
    expect((await sync(journalist, [upsert('crd-a', { ...row.d, script: 'نص التقرير' }, row.v)])).body.results[0].ok).toBe(true);
    row = cardRow('crd-a');
    expect(row.d.scriptApproved).toBe(false);
    expect((await sync(editor, [upsert('crd-a', { ...row.d, scriptApproved: true, scriptApprovedByName: 'اسم مزور' }, row.v)])).body.results[0].ok).toBe(true);
    row = cardRow('crd-a');
    expect(row.d).toMatchObject({ scriptApproved: true, scriptApprovedById: 'usr-2' });
    expect(row.d.scriptApprovedByName).not.toBe('اسم مزور');
    expect((await sync(journalist, [upsert('crd-a', { ...row.d, script: 'نص معدّل بعد الاعتماد' }, row.v)])).body.results[0].ok).toBe(true);
    row = cardRow('crd-a');
    expect(row.d.scriptApproved).toBe(false);
    expect(row.d.scriptApprovedById).toBeUndefined();
  });

  it('closes, freezes and deletes cards for supervisors only', async () => {
    let row = cardRow('crd-a');
    expect((await sync(journalist, [upsert('crd-a', { ...row.d, status: 'CLOSED' }, row.v)])).body.results[0].ok).toBe(false);
    expect((await sync(editor, [upsert('crd-a', { ...row.d, status: 'CLOSED' }, row.v)])).body.results[0].ok).toBe(true);
    row = cardRow('crd-a');
    expect(row.d.closedAt).toBeTruthy();
    const touch = { ...row.d, steps: row.d.steps.map((s: any) => (s.id === 's2' ? { ...s, status: 'IN_PROGRESS', blockedReason: undefined } : s)) };
    expect((await sync(journalist, [upsert('crd-a', touch, row.v)])).body.results[0].ok).toBe(false);
    expect((await sync(journalist, [{ c: 'productionCards', op: 'delete', id: 'crd-a' }])).body.results[0].ok).toBe(false);
    expect((await sync(journalist, [upsert('crd-a', { ...row.d, deletedAt: new Date().toISOString() }, row.v)])).body.results[0].ok).toBe(false);
    expect((await sync(editor, [upsert('crd-a', { ...row.d, deletedAt: new Date().toISOString() }, row.v)])).body.results[0].ok).toBe(true);
  });

  it('hides cards from people without cards.view', async () => {
    await sync(editor, [upsert('crd-b', { ...newCard(), steps: [] })]);
    const seen = await editor.get('/api/v1/data');
    expect(seen.body.collections.productionCards.some((r: any) => r.id === 'crd-b')).toBe(true);
    const role = server.db.listCollection('roles').find((r) => r.d.roleCode === 'VIEWER')!;
    server.db.writeRow('roles', role.id, { ...role.d, permissions: role.d.permissions.filter((p: string) => p !== 'cards.view') }, role.p, null);
    const hidden = await viewer.get('/api/v1/data');
    expect(hidden.body.collections.productionCards || []).toEqual([]);
  });
});

describe('brief drafts', () => {
  it('are offered to people who work on cards, and only to them', async () => {
    const body = { mode: 'BRIEF', title: 'موجز', content: 'معلومات' };
    // No key is configured in tests: reaching the "not configured" answer means the permission check passed.
    expect((await media.post('/api/v1/ai/copilot').set(H).send(body)).status).toBe(503);
    expect((await viewer.post('/api/v1/ai/copilot').set(H).send(body)).status).toBe(403);
    expect((await viewer.post('/api/v1/ai/copilot').set(H).send({ ...body, mode: 'HEADLINES' })).status).toBe(403);
  });
});

describe('stations on the server', () => {
  it('keeps a branch supervisor inside the stations linked to theirs', async () => {
    const settings = server.db.getRow('settings', 'singleton')!;
    const stations = [{ id: 'gaza', name: 'غزة', linkedIds: [] }, { id: 'beirut', name: 'بيروت', linkedIds: ['gaza'] }, { id: 'istanbul', name: 'إسطنبول', linkedIds: [] }];
    const saved = await sync(admin, [{ c: 'settings', op: 'upsert', id: 'singleton', d: { ...settings.d, stations }, baseV: settings.v }]);
    expect(saved.body.results[0].ok).toBe(true);

    const card = (assigneeId: string) => ({ ...newCard(), steps: [{ id: 's1', type: 'edit', status: 'TODO', complexity: 1, assigneeId }] });
    const outside = await sync(editor, [upsert('crd-scope-1', card('usr-7'))]);
    expect(outside.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(outside.body.results[0].message).toContain('غير مرتبطة');
    expect((await sync(editor, [upsert('crd-scope-2', card('usr-6'))])).body.results[0].ok).toBe(true);
    // Central management (no station) assigns anywhere.
    expect((await sync(admin, [upsert('crd-scope-3', card('usr-7'))])).body.results[0].ok).toBe(true);
  });

  it('rejects malformed station lists and unknown stations on users', async () => {
    const settings = server.db.getRow('settings', 'singleton')!;
    const twoMains = [{ id: 'a', name: 'أ', isMain: true }, { id: 'b', name: 'ب', isMain: true }];
    expect((await sync(admin, [{ c: 'settings', op: 'upsert', id: 'singleton', d: { ...settings.d, stations: twoMains }, baseV: settings.v }])).body.results[0].ok).toBe(false);
    expect((await sync(editor, [{ c: 'settings', op: 'upsert', id: 'singleton', d: { ...settings.d, stations: [] }, baseV: settings.v }])).body.results[0].ok).toBe(false);

    const user = server.db.getRow('users', 'usr-10')!;
    expect((await sync(admin, [{ c: 'users', op: 'upsert', id: 'usr-10', d: { ...user.d, stationId: 'mars' }, baseV: user.v }])).body.results[0]).toMatchObject({ ok: false, code: 'INVALID' });
    expect((await sync(admin, [{ c: 'users', op: 'upsert', id: 'usr-10', d: { ...user.d, stationId: 'gaza' }, baseV: user.v }])).body.results[0].ok).toBe(true);
  });

  it('does not let colleagues move themselves to another station', async () => {
    const me = server.db.getRow('users', 'usr-3')!;
    const moved = await sync(journalist, [{ c: 'users', op: 'upsert', id: 'usr-3', d: { ...me.d, stationId: 'gaza' }, baseV: me.v }]);
    expect(moved.body.results[0].ok).toBe(false);
    expect(server.db.getRow('users', 'usr-3')!.d.stationId).toBe('beirut');
  });

  it('stamps the completion time of editorial tasks', async () => {
    const task = { id: 'tsk-done-1', title: 'مهمة قياس', assigneeId: 'usr-3', status: 'TODO', priority: 'MEDIUM', completedAt: '2020-01-01T00:00:00.000Z' };
    expect((await sync(editor, [{ c: 'tasks', op: 'upsert', id: task.id, d: task }])).body.results[0].ok).toBe(true);
    let row = server.db.getRow('tasks', task.id)!;
    expect(row.d.completedAt).toBeUndefined();
    expect((await sync(journalist, [{ c: 'tasks', op: 'upsert', id: task.id, d: { ...row.d, status: 'DONE' }, baseV: row.v }])).body.results[0].ok).toBe(true);
    row = server.db.getRow('tasks', task.id)!;
    expect(Date.parse(row.d.completedAt)).toBeGreaterThan(Date.now() - 60_000);
  });
});
