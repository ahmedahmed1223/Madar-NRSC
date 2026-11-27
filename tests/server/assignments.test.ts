import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';

/**
 * Assignments (production cards) after the role trials: rework, blockers, notes and decisions,
 * station-wide steps, reassigning, the handoff order, time sessions, station governance,
 * attached library files, and workflow templates.
 */
let server: Awaited<ReturnType<typeof createTestServer>>;
const H = { 'X-NRCS-Client': 'web' };
const sync = (agent: request.Agent, ops: any[]) => agent.post('/api/v1/data/sync').set(H).send({ ops });
const row = (id: string) => server.db.getRow('productionCards', id)!;
const upsert = (id: string, d: any, baseV?: number) => ({ c: 'productionCards', op: 'upsert', id, d: { ...d, id }, ...(baseV === undefined ? {} : { baseV }) });
const notes = (userId: string, cardId: string) => server.db.listCollection('notifications').map((r) => r.d).filter((n) => n.userId === userId && n.linkUrl === `/cards/${cardId}`);
const step = (card: any, id: string, changes: any) => ({ ...card, steps: card.steps.map((s: any) => (s.id === id ? { ...s, ...changes } : s)) });

let admin: request.Agent;
let editor: request.Agent;
let journalist: request.Agent;
let reporter: request.Agent;
let media: request.Agent;
let quality: request.Agent;
let viewer: request.Agent;

const patchUser = (userId: string, changes: any) => {
  const r = server.db.getRow('users', userId)!;
  server.db.writeRow('users', userId, { ...r.d, ...changes }, r.p, null);
};

beforeAll(async () => {
  server = await createTestServer();
  // usr-2 editor (manages, Beirut), usr-3 journalist (Beirut), usr-6 reporter (Gaza), usr-7 media (montage, Istanbul),
  // usr-10 becomes a quality reviewer in Istanbul.
  patchUser('usr-2', { stationId: 'beirut' });
  patchUser('usr-3', { stationId: 'beirut' });
  patchUser('usr-6', { stationId: 'gaza' });
  patchUser('usr-7', { stationId: 'istanbul' });
  patchUser('usr-10', { stationId: 'istanbul', role: 'QUALITY', departmentId: 'quality', department: 'الجودة' });
  admin = await loginAgent(server.app, 'admin@akhbar.tv');
  editor = await loginAgent(server.app, 'editor@akhbar.tv');
  journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
  reporter = await loginAgent(server.app, 'reporter@akhbar.tv');
  media = await loginAgent(server.app, 'media@akhbar.tv');
  quality = await loginAgent(server.app, 'crew@akhbar.tv');
  viewer = await loginAgent(server.app, 'trainee@akhbar.tv');
});
afterAll(() => server.close());

const chain = (extra: any = {}) => ({
  title: 'الكهرباء في الشمال',
  kind: 'REPORT',
  priority: 'NORMAL',
  status: 'OPEN',
  steps: [
    { id: 'g', type: 'gather', status: 'TODO', complexity: 1, assigneeId: 'usr-6' },
    { id: 'e', type: 'edit', status: 'TODO', complexity: 1, assigneeId: 'usr-3' },
    { id: 'm', type: 'montage', status: 'TODO', complexity: 1, assigneeId: 'usr-7' },
    { id: 'q', type: 'quality', status: 'TODO', complexity: 1, assigneeId: 'usr-10' },
  ],
  log: [],
  ...extra,
});

describe('rework and the order of the chain', () => {
  it('does not hand the item on while an earlier step is still open', async () => {
    expect((await sync(editor, [upsert('as-1', chain())])).body.results[0].ok).toBe(true);
    let r = row('as-1');
    // Montage finishes while «التحرير» is still open: quality hears nothing yet.
    expect((await sync(media, [upsert('as-1', step(r.d, 'm', { status: 'DONE', note: 'النسخة الأولى' }), r.v)])).body.results[0].ok).toBe(true);
    expect(notes('usr-10', 'as-1').filter((n) => n.title.includes('وصلتك المادة'))).toHaveLength(0);
    r = row('as-1');
    expect((await sync(reporter, [upsert('as-1', step(r.d, 'g', { status: 'DONE' }), r.v)])).body.results[0].ok).toBe(true);
    r = row('as-1');
    expect((await sync(journalist, [upsert('as-1', step(r.d, 'e', { status: 'DONE' }), r.v)])).body.results[0].ok).toBe(true);
    // Once everything before it is done, the material reaches quality.
    expect(notes('usr-10', 'as-1').some((n) => n.title.includes('وصلتك المادة'))).toBe(true);
  });

  it('lets quality send montage back with a reason; montage and the owner hear it', async () => {
    let r = row('as-1');
    expect((await sync(quality, [upsert('as-1', step(r.d, 'q', { status: 'IN_PROGRESS' }), r.v)])).body.results[0].ok).toBe(true);
    r = row('as-1');
    // Without a reason it is refused; a colleague who reviews nothing cannot send work back.
    expect((await sync(quality, [upsert('as-1', step(r.d, 'm', { status: 'IN_PROGRESS' }), r.v)])).body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect((await sync(reporter, [upsert('as-1', step(r.d, 'm', { status: 'IN_PROGRESS', returnedReason: 'سبب' }), r.v)])).body.results[0].ok).toBe(false);
    const res = await sync(quality, [upsert('as-1', step(r.d, 'm', { status: 'IN_PROGRESS', returnedReason: 'اسم الشاهد الثاني غير مثبت', returnedByName: 'اسم مزور' }), r.v)]);
    expect(res.body.results[0].ok).toBe(true);
    const m = row('as-1').d.steps.find((s: any) => s.id === 'm');
    expect(m).toMatchObject({ status: 'IN_PROGRESS', returnedReason: 'اسم الشاهد الثاني غير مثبت', returnedById: 'usr-10' });
    expect(m.returnedByName).not.toBe('اسم مزور');
    expect(m.startedAt).toBeTruthy();
    const toMontage = notes('usr-7', 'as-1').find((n) => n.title.includes('أُعيدت إليك'))!;
    expect(toMontage.message).toContain('اسم الشاهد الثاني');
    expect(toMontage.urgent).toBe(true);
    expect(notes('usr-2', 'as-1').some((n) => n.title.includes('خطوة سابقة'))).toBe(true);
    expect(row('as-1').d.log.at(-1).text).toContain('أُعيدت');
  });

  it('adds the minutes of every work session to the step instead of replacing them', async () => {
    let r = row('as-1');
    const first = step(r.d, 'm', { status: 'DONE', timeLog: [{ id: 'tm-1', minutes: 75 }], spentMinutes: 75 });
    expect((await sync(media, [upsert('as-1', first, r.v)])).body.results[0].ok).toBe(true);
    r = row('as-1');
    let m = r.d.steps.find((s: any) => s.id === 'm');
    expect(m).toMatchObject({ spentMinutes: 75 });
    expect(m.returnedReason).toBeUndefined();
    expect(m.timeLog[0]).toMatchObject({ id: 'tm-1', minutes: 75, byId: 'usr-7' });
    // Reopened for rework, then finished with a 15-minute session: 90 in total.
    expect((await sync(media, [upsert('as-1', step(r.d, 'm', { status: 'IN_PROGRESS' }), r.v)])).body.results[0].ok).toBe(true);
    r = row('as-1');
    m = r.d.steps.find((s: any) => s.id === 'm');
    const second = step(r.d, 'm', { status: 'DONE', timeLog: [...m.timeLog, { id: 'tm-2', minutes: 15 }], spentMinutes: 15 });
    expect((await sync(media, [upsert('as-1', second, r.v)])).body.results[0].ok).toBe(true);
    expect(row('as-1').d.steps.find((s: any) => s.id === 'm').spentMinutes).toBe(90);
    // Lowering the total by hand is refused.
    r = row('as-1');
    expect((await sync(media, [upsert('as-1', step(r.d, 'm', { spentMinutes: 15 }), r.v)])).body.results[0].ok).toBe(false);
  });
});

describe('blockers, notes and decisions', () => {
  it('alerts the owner, the person who can fix it and the supervisors who follow the station', async () => {
    expect((await sync(editor, [upsert('as-2', chain())])).body.results[0].ok).toBe(true);
    let r = row('as-2');
    for (const [agent, id] of [[reporter, 'g'], [journalist, 'e']] as const) {
      expect((await sync(agent, [upsert('as-2', step(r.d, id, { status: 'DONE' }), r.v)])).body.results[0].ok).toBe(true);
      r = row('as-2');
    }
    // Montage is blocked: the footage never came. Nobody named → the previous step's holder hears it.
    expect((await sync(media, [upsert('as-2', step(r.d, 'm', { status: 'BLOCKED', blockedReason: 'اللقطات الأصلية لم تصل' }), r.v)])).body.results[0].ok).toBe(true);
    expect(notes('usr-2', 'as-2').some((n) => n.title.includes('قرارك'))).toBe(true);
    expect(notes('usr-3', 'as-2').some((n) => n.title.includes('لحل تعطّل'))).toBe(true);
    // Central management (no station) follows every station.
    expect(notes('usr-1', 'as-2').some((n) => n.title.includes('تتابعها'))).toBe(true);
    // Resumed, then blocked again naming the reporter who owes the footage.
    r = row('as-2');
    expect((await sync(media, [upsert('as-2', step(r.d, 'm', { status: 'IN_PROGRESS', blockedReason: undefined }), r.v)])).body.results[0].ok).toBe(true);
    r = row('as-2');
    expect((await sync(media, [upsert('as-2', step(r.d, 'm', { status: 'BLOCKED', blockedReason: 'ينقص المقطع الثالث', waitingOnId: 'usr-6' }), r.v)])).body.results[0].ok).toBe(true);
    expect(row('as-2').d.steps.find((s: any) => s.id === 'm')).toMatchObject({ waitingOnId: 'usr-6' });
    expect(notes('usr-6', 'as-2').some((n) => n.title.includes('لحل تعطّل') && n.message.includes('المقطع الثالث'))).toBe(true);
  });

  it('sends a note to the owner and the current holder, and a decision to everyone on the assignment', async () => {
    let r = row('as-2');
    const note = { id: 'log-n1', kind: 'NOTE', text: 'تواصلت مع المراسل' };
    expect((await sync(journalist, [upsert('as-2', { ...r.d, log: [...r.d.log, note] }, r.v)])).body.results[0].ok).toBe(true);
    expect(notes('usr-2', 'as-2').some((n) => n.message.includes('تواصلت مع المراسل'))).toBe(true);
    expect(notes('usr-7', 'as-2').some((n) => n.message.includes('تواصلت مع المراسل'))).toBe(true);
    expect(notes('usr-6', 'as-2').some((n) => n.message.includes('تواصلت مع المراسل'))).toBe(false);
    r = row('as-2');
    const decision = { id: 'log-d1', kind: 'NOTE', text: 'نؤجل البث إلى نشرة المساء', decision: true };
    expect((await sync(journalist, [upsert('as-2', { ...r.d, log: [...r.d.log, decision] }, r.v)])).body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect((await sync(editor, [upsert('as-2', { ...r.d, log: [...r.d.log, decision] }, r.v)])).body.results[0].ok).toBe(true);
    expect(row('as-2').d.log.at(-1)).toMatchObject({ decision: true, byId: 'usr-2' });
    for (const id of ['usr-3', 'usr-6', 'usr-7', 'usr-10']) expect(notes(id, 'as-2').some((n) => n.title === 'قرار في تكليف')).toBe(true);
  });
});

describe('station-wide steps, reassigning and approved scripts', () => {
  it('tells the colleagues of the station whose work it is, and lets only them claim it', async () => {
    const card = chain({ steps: [{ id: 'm', type: 'montage', status: 'TODO', complexity: 1, stationId: 'istanbul' }] });
    expect((await sync(editor, [upsert('as-3', card)])).body.results[0].ok).toBe(true);
    expect(notes('usr-7', 'as-3').some((n) => n.title.includes('متاحة لمحطتك'))).toBe(true);
    expect(notes('usr-10', 'as-3')).toHaveLength(0);
    const r = row('as-3');
    expect((await sync(quality, [upsert('as-3', step(r.d, 'm', { assigneeId: 'usr-10', status: 'IN_PROGRESS' }), r.v)])).body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect((await sync(media, [upsert('as-3', step(r.d, 'm', { assigneeId: 'usr-7', status: 'IN_PROGRESS' }), r.v)])).body.results[0].ok).toBe(true);
  });

  it('tells the colleague a step was taken from, and records from whom', async () => {
    const r = row('as-3');
    expect((await sync(editor, [upsert('as-3', step(r.d, 'm', { assigneeId: 'usr-3' }), r.v)])).body.results[0].ok).toBe(true);
    expect(notes('usr-7', 'as-3').some((n) => n.title.includes('سُحبت منك'))).toBe(true);
    expect(notes('usr-3', 'as-3').some((n) => n.title.includes('مهمة لك'))).toBe(true);
    expect(row('as-3').d.log.at(-1).text).toContain('بدلاً من');
  });

  it('tells the owner when someone else edits an approved script', async () => {
    let r = row('as-3');
    expect((await sync(editor, [upsert('as-3', { ...r.d, script: 'النص', scriptApproved: true }, r.v)])).body.results[0].ok).toBe(true);
    r = row('as-3');
    expect((await sync(journalist, [upsert('as-3', { ...r.d, script: 'نص معدّل' }, r.v)])).body.results[0].ok).toBe(true);
    expect(row('as-3').d.scriptApproved).toBe(false);
    expect(notes('usr-2', 'as-3').some((n) => n.title.includes('سُحب اعتماده'))).toBe(true);
  });
});

describe('material, deletion and station governance', () => {
  it('lets anyone on the assignment attach library files and links; unknown files are refused', async () => {
    const r = row('as-3');
    const mediaId = server.db.listCollection('media')[0].id;
    expect((await sync(journalist, [upsert('as-3', { ...r.d, mediaIds: ['no-such-file'] }, r.v)])).body.results[0]).toMatchObject({ ok: false, code: 'INVALID' });
    expect((await sync(reporter, [upsert('as-3', { ...r.d, mediaIds: [mediaId] }, r.v)])).body.results[0].ok).toBe(false);
    const res = await sync(journalist, [upsert('as-3', { ...r.d, mediaIds: [mediaId], links: [{ label: 'الخام', url: 'https://example.org/raw' }] }, r.v)]);
    expect(res.body.results[0].ok).toBe(true);
    const log = row('as-3').d.log.map((e: any) => e.text);
    expect(log.some((t: string) => t.startsWith('أُرفق من المكتبة'))).toBe(true);
    expect(log.some((t: string) => t.includes('أُضيف رابط'))).toBe(true);
  });

  it('marks the notices of a deleted assignment as read', async () => {
    expect(notes('usr-7', 'as-3').some((n) => !n.isRead)).toBe(true);
    const r = row('as-3');
    expect((await sync(editor, [upsert('as-3', { ...r.d, deletedAt: new Date().toISOString() }, r.v)])).body.results[0].ok).toBe(true);
    expect(notes('usr-7', 'as-3').every((n) => n.isRead)).toBe(true);
  });

  it('keeps a branch from closing, cancelling or deleting the main station\'s assignments', async () => {
    const settings = server.db.getRow('settings', 'singleton')!;
    const stations = [{ id: 'gaza', name: 'غزة' }, { id: 'beirut', name: 'بيروت' }, { id: 'istanbul', name: 'إسطنبول', isMain: true }];
    expect((await sync(admin, [{ c: 'settings', op: 'upsert', id: 'singleton', d: { ...settings.d, stations }, baseV: settings.v }])).body.results[0].ok).toBe(true);
    patchUser('usr-4', { stationId: 'istanbul' });
    const producer = await loginAgent(server.app, 'producer@akhbar.tv');
    expect((await sync(producer, [upsert('as-main', chain({ steps: [] }))])).body.results[0].ok).toBe(true);
    expect(row('as-main').d.ownerStationId).toBe('istanbul');
    const r = row('as-main');
    // The Beirut supervisor may edit it, but not cancel or delete it.
    expect((await sync(editor, [upsert('as-main', { ...r.d, status: 'CANCELLED' }, r.v)])).body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect((await sync(editor, [upsert('as-main', { ...r.d, deletedAt: new Date().toISOString() }, r.v)])).body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect((await sync(editor, [upsert('as-main', { ...r.d, brief: 'ملاحظة من بيروت' }, r.v)])).body.results[0].ok).toBe(true);
    const latest = row('as-main');
    expect((await sync(producer, [upsert('as-main', { ...latest.d, status: 'CANCELLED', cancellationReason: 'تغيّر جدول البث' }, latest.v)])).body.results[0].ok).toBe(true);
  });
});

describe('workflow templates', () => {
  const tpl = (extra: any = {}) => ({
    id: 'wft-test',
    name: 'نشرة الظهيرة',
    kind: 'BULLETIN',
    priority: 'NORMAL',
    steps: [
      { id: 't1', type: 'edit', rule: { kind: 'DEPARTMENT', departmentId: 'newsroom' }, dueOffsetMinutes: 60, complexity: 1 },
      { id: 't2', type: 'montage', rule: { kind: 'ROLE', role: 'MONTAGE' }, complexity: 2, checklist: ['الصوت'] },
    ],
    ...extra,
  });
  const put = (agent: request.Agent, d: any, baseV?: number) => sync(agent, [{ c: 'workflowTemplates', op: 'upsert', id: d.id, d, ...(baseV === undefined ? {} : { baseV }) }]);

  it('ships the starter templates', () => {
    const names = server.db.listCollection('workflowTemplates').map((r) => r.d.name);
    expect(names).toEqual(expect.arrayContaining(['نشرة أخبار', 'تقرير ميداني', 'مقابلة', 'حلقة برنامج', 'رصد وتغطية عاجلة']));
  });

  it('are created and edited by supervisors only, and validated', async () => {
    expect((await put(journalist, tpl())).body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect((await put(editor, tpl({ steps: [] }))).body.results[0].ok).toBe(false);
    expect((await put(editor, tpl({ id: 'wft-bad', steps: [{ id: 'x', type: 'edit', rule: { kind: 'NOBODY' }, complexity: 1 }] }))).body.results[0].ok).toBe(false);
    expect((await put(editor, tpl({ id: 'wft-fake', builtIn: true }))).body.results[0].ok).toBe(false);
    expect((await put(editor, tpl())).body.results[0].ok).toBe(true);
    const saved = server.db.getRow('workflowTemplates', 'wft-test')!;
    expect(saved.d).toMatchObject({ createdById: 'usr-2', name: 'نشرة الظهيرة' });
    expect((await put(editor, { ...saved.d, archived: true }, saved.v)).body.results[0].ok).toBe(true);
    expect(server.db.getRow('workflowTemplates', 'wft-test')!.d.archived).toBe(true);
  });

  it('are hidden from people who cannot see assignments', async () => {
    const seen = await viewer.get('/api/v1/data');
    expect((seen.body.collections.workflowTemplates || []).length).toBeGreaterThan(0);
    const role = server.db.listCollection('roles').find((r) => r.d.roleCode === 'VIEWER')!;
    server.db.writeRow('roles', role.id, { ...role.d, permissions: role.d.permissions.filter((p: string) => p !== 'cards.view') }, role.p, null);
    const hidden = await viewer.get('/api/v1/data');
    expect(hidden.body.collections.workflowTemplates || []).toEqual([]);
  });

  it('produce assignments that remember their template', async () => {
    const card = { ...chain({ steps: [{ id: 'x1', type: 'edit', status: 'TODO', complexity: 1, departmentId: 'newsroom', stationId: 'beirut', checklist: [{ text: 'العناوين' }] }] }), templateId: 'wft-test', templateName: 'نشرة الظهيرة' };
    expect((await sync(editor, [upsert('as-tpl', card)])).body.results[0].ok).toBe(true);
    // Left to the newsroom in Beirut: the journalist there hears about it and may tick the checklist once claimed.
    expect(notes('usr-3', 'as-tpl').some((n) => n.title.includes('متاحة لقسمك'))).toBe(true);
    let r = row('as-tpl');
    expect((await sync(journalist, [upsert('as-tpl', step(r.d, 'x1', { assigneeId: 'usr-3', status: 'IN_PROGRESS' }), r.v)])).body.results[0].ok).toBe(true);
    r = row('as-tpl');
    expect((await sync(journalist, [upsert('as-tpl', step(r.d, 'x1', { checklist: [{ text: 'العناوين', done: true }] }), r.v)])).body.results[0].ok).toBe(true);
    r = row('as-tpl');
    expect((await sync(journalist, [upsert('as-tpl', step(r.d, 'x1', { checklist: [{ text: 'بند آخر' }] }), r.v)])).body.results[0].ok).toBe(false);
    expect((await sync(journalist, [upsert('as-tpl', { ...r.d, templateName: 'آخر' }, r.v)])).body.results[0].ok).toBe(false);
  });
});
