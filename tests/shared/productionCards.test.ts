import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STEP_TYPES,
  canClaimStep,
  cardChangeError,
  cardContributions,
  cardHoldReason,
  cardProgress,
  cardState,
  currentStep,
  mergeCardChanges,
  isCardLate,
  stepPoints,
  stepTypesError,
  canGovernCard,
  canSendBack,
  cardStates,
  isStepOwnLate,
  openStepsBefore,
  sendBackCard,
  sendBackTargets,
  stepAssigneeLabel,
  stepFitsActor,
  timeLogMinutes,
  stepTypesOf,
  type CardActor,
  type CardContext,
  type CardStep,
  type ProductionCard,
} from '../../src/shared/productionCards';
import type { Station } from '../../src/shared/stations';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const stations: Station[] = [{ id: 'gaza', name: 'غزة' }, { id: 'beirut', name: 'بيروت' }, { id: 'istanbul', name: 'إسطنبول' }];
const ctx: CardContext = {
  stations,
  stepTypes: DEFAULT_STEP_TYPES,
  users: new Map([
    ['chief', { stationId: undefined }],
    ['reporter', { stationId: 'gaza' }],
    ['editor', { stationId: 'beirut' }],
    ['montage', { stationId: 'istanbul' }],
  ]),
};
const chief: CardActor = { id: 'chief', canManage: true, canWork: true };
const reporter: CardActor = { id: 'reporter', stationId: 'gaza', canManage: false, canWork: true };
const editor: CardActor = { id: 'editor', stationId: 'beirut', canManage: false, canWork: true };

const step = (id: string, type: string, extra: Partial<CardStep> = {}): CardStep => ({ id, type, status: 'TODO', complexity: 1, ...extra });
const card = (extra: Partial<ProductionCard> = {}): ProductionCard => ({
  id: 'crd-1',
  title: 'شهادة مصوّرة من غزة',
  kind: 'REPORT',
  priority: 'NORMAL',
  status: 'OPEN',
  ownerId: 'chief',
  steps: [
    step('s1', 'gather', { assigneeId: 'reporter', stationId: 'gaza', complexity: 3 }),
    step('s2', 'verify', { assigneeId: 'editor', stationId: 'beirut' }),
    step('s3', 'montage', { stationId: 'istanbul', complexity: 2 }),
  ],
  log: [],
  ...extra,
});
const withStep = (base: ProductionCard, id: string, changes: Partial<CardStep>): ProductionCard => ({ ...base, steps: base.steps.map((s) => (s.id === id ? { ...s, ...changes } : s)) });

describe('reading a production card', () => {
  it('reports progress, the step it waits on and its state', () => {
    const c = card();
    expect(cardProgress(c)).toEqual({ done: 0, total: 3 });
    expect(currentStep(c)?.id).toBe('s1');
    expect(cardState(c, NOW)).toBe('NEW');
    const started = withStep(c, 's1', { status: 'DONE' });
    expect(cardState(started, NOW)).toBe('IN_PROGRESS');
    expect(currentStep(started)?.id).toBe('s2');
    const done = { ...c, steps: c.steps.map((s) => ({ ...s, status: 'DONE' as const })) };
    expect(cardState(done, NOW)).toBe('READY');
    expect(cardState({ ...done, status: 'CLOSED' }, NOW)).toBe('CLOSED');
    expect(cardState({ ...c, status: 'CANCELLED' }, NOW)).toBe('CANCELLED');
  });

  it('ignores steps marked not needed', () => {
    const c = { ...card(), steps: [step('a', 'edit', { status: 'DONE' }), step('b', 'graphics', { status: 'SKIPPED' })] };
    expect(cardProgress(c)).toEqual({ done: 1, total: 1 });
    expect(cardState(c, NOW)).toBe('READY');
    expect(cardState({ ...card(), steps: [] }, NOW)).toBe('NEW');
  });

  it('flags late and blocked cards and says why', () => {
    const late = withStep(card(), 's1', { dueAt: '2026-11-19T10:00:00Z' });
    expect(isCardLate(late, NOW)).toBe(true);
    expect(cardState(late, NOW)).toBe('LATE');
    expect(cardHoldReason(late, DEFAULT_STEP_TYPES, NOW)).toContain('جمع المادة');
    const blocked = withStep(late, 's1', { status: 'BLOCKED', blockedReason: 'انقطاع الاتصال' });
    expect(cardState(blocked, NOW)).toBe('BLOCKED');
    expect(cardHoldReason(blocked, DEFAULT_STEP_TYPES, NOW)).toContain('انقطاع الاتصال');
    const pastDelivery = card({ dueAt: '2026-11-19T11:00:00Z' });
    expect(cardState(pastDelivery, NOW)).toBe('LATE');
    expect(cardHoldReason(pastDelivery, DEFAULT_STEP_TYPES, NOW)).toContain('بانتظار');
    const finishedLate = { ...pastDelivery, steps: pastDelivery.steps.map((s) => ({ ...s, status: 'DONE' as const })) };
    expect(isCardLate(finishedLate, NOW)).toBe(false);
  });

  it('weights a step by its type and complexity, and credits each station for its part', () => {
    expect(stepPoints(step('x', 'gather', { complexity: 3 }), DEFAULT_STEP_TYPES)).toBe(9);
    expect(stepPoints(step('x', 'deleted-type', { complexity: 2 }), DEFAULT_STEP_TYPES)).toBe(2);
    const c = withStep(withStep(card(), 's1', { status: 'DONE' }), 's2', { status: 'DONE' });
    expect(cardContributions(c, DEFAULT_STEP_TYPES)).toEqual([
      { stationId: 'gaza', steps: 1, done: 1, points: 9 },
      { stationId: 'beirut', steps: 1, done: 1, points: 2 },
      { stationId: 'istanbul', steps: 1, done: 0, points: 0 },
    ]);
  });

  it('validates configurable step types', () => {
    expect(stepTypesOf(null)).toBe(DEFAULT_STEP_TYPES);
    expect(stepTypesOf({ cardStepTypes: [] })).toBe(DEFAULT_STEP_TYPES);
    expect(stepTypesError(DEFAULT_STEP_TYPES)).toBeNull();
    expect(stepTypesError([])).not.toBeNull();
    expect(stepTypesError([{ id: 'a', name: 'أ', weight: 0 }])).toContain('وزن');
    expect(stepTypesError([{ id: 'a', name: 'أ', weight: 1 }, { id: 'b', name: 'أ', weight: 1 }])).toContain('مكرر');
  });
});

describe('who may change a production card', () => {
  it('lets supervisors create cards and rejects malformed ones', () => {
    expect(cardChangeError(null, card(), chief, ctx)).toBeNull();
    expect(cardChangeError(null, card({ title: ' ' }), chief, ctx)).toContain('عنوان');
    expect(cardChangeError(null, card({ status: 'CLOSED' }), chief, ctx)).toContain('يبدأ جارياً');
    expect(cardChangeError(null, withStep(card(), 's1', { assigneeId: 'ghost' }), chief, ctx)).toContain('المكلف');
    expect(cardChangeError(null, withStep(card(), 's3', { stationId: 'mars' }), chief, ctx)).toContain('محطة');
    expect(cardChangeError(null, withStep(card(), 's1', { status: 'BLOCKED' }), chief, ctx)).toContain('سبب التعطل');
    expect(cardChangeError(null, card({ links: [{ label: 'x', url: 'javascript:alert(1)' }] }), chief, ctx)).toContain('http');
    expect(cardChangeError(null, card({ links: [{ label: 'مقابلة', url: 'https://example.org/a.mp4' }] }), chief, ctx)).toBeNull();
    expect(cardChangeError(null, card({ kind: 'X' as any }), chief, ctx)).toContain('نوع المادة');
  });

  it('keeps creation and card details with supervisors', () => {
    expect(cardChangeError(null, card(), reporter, ctx)).toContain('مسؤولي التكليف');
    const before = card();
    expect(cardChangeError(before, { ...before, title: 'عنوان آخر' }, reporter, ctx)).toContain('مسؤولي التكليف');
    expect(cardChangeError(before, { ...before, airAt: '2026-11-20T18:00:00Z' }, reporter, ctx)).toContain('مسؤولي التكليف');
    expect(cardChangeError(before, { ...before, steps: before.steps.slice(0, 2) }, reporter, ctx)).toContain('إضافة المهام');
    expect(cardChangeError(before, withStep(before, 's1', { dueAt: '2026-11-25T10:00:00Z' }), reporter, ctx)).toContain('تفاصيل المهمة');
    expect(cardChangeError(before, before, { ...reporter, canWork: false }, ctx)).toContain('صلاحياتك');
  });

  it('lets the assignee progress their own step only', () => {
    const before = card();
    expect(cardChangeError(before, withStep(before, 's1', { status: 'IN_PROGRESS' }), reporter, ctx)).toBeNull();
    expect(cardChangeError(before, withStep(before, 's1', { status: 'DONE', note: 'رُفعت الشهادة', spentMinutes: 90 }), reporter, ctx)).toBeNull();
    expect(cardChangeError(before, withStep(before, 's2', { status: 'DONE' }), reporter, ctx)).toContain('أُسندت إليه');
    expect(cardChangeError(before, withStep(before, 's2', { assigneeId: 'reporter' }), reporter, ctx)).toContain('المكلف');
  });

  it('compares steps whatever the order of their keys', () => {
    const before = card();
    const reordered = { ...before, steps: before.steps.map((s) => Object.fromEntries(Object.entries(s).reverse()) as unknown as CardStep) };
    expect(cardChangeError(before, withStep(reordered, 's1', { status: 'IN_PROGRESS', note: undefined }), reporter, ctx)).toBeNull();
  });

  it('lets a colleague of the addressed station pick up an open step, and hand it back', () => {
    const before = card();
    const montage: CardActor = { id: 'montage', stationId: 'istanbul', canManage: false, canWork: true };
    expect(canClaimStep(before.steps[2], montage)).toBe(true);
    expect(canClaimStep(before.steps[2], reporter)).toBe(false);
    expect(canClaimStep(before.steps[0], montage)).toBe(false);
    const claimed = withStep(before, 's3', { assigneeId: 'montage', status: 'IN_PROGRESS' });
    expect(cardChangeError(before, claimed, montage, ctx)).toBeNull();
    expect(cardChangeError(before, withStep(before, 's3', { assigneeId: 'reporter' }), reporter, ctx)).toContain('المكلف');
    expect(cardChangeError(claimed, withStep(claimed, 's3', { assigneeId: undefined }), montage, ctx)).toBeNull();
  });

  it('keeps the documented trail append-only for everyone', () => {
    const before = card({ log: [{ id: 'l1', kind: 'NOTE', text: 'وصلت المادة الخام' }] });
    const added = { ...before, log: [...before.log!, { id: 'l2', kind: 'NOTE' as const, text: 'ينقص اسم الشاهد' }] };
    expect(cardChangeError(before, added, editor, ctx)).toBeNull();
    expect(cardChangeError(before, { ...before, log: [] }, chief, ctx)).toContain('للإضافة فقط');
    expect(cardChangeError(before, { ...before, log: [{ id: 'l1', kind: 'NOTE', text: 'نص مبدّل' }] }, chief, ctx)).toContain('للإضافة فقط');
    expect(cardChangeError(before, { ...before, log: [...before.log!, { id: 'l3', kind: 'NOTE', text: '  ' }] }, editor, ctx)).toContain('ملاحظة التوثيق');
  });

  it('lets people on the card write the script but only supervisors approve it', () => {
    const before = card();
    expect(cardChangeError(before, { ...before, script: 'نص التقرير' }, editor, ctx)).toBeNull();
    expect(cardChangeError(before, { ...before, script: 'نص', scriptApproved: true }, editor, ctx)).toContain('اعتماد النص');
    const outsider: CardActor = { id: 'montage', stationId: 'istanbul', canManage: false, canWork: true };
    expect(cardChangeError(before, { ...before, script: 'نص' }, outsider, ctx)).toContain('من له مهمة');
    expect(cardChangeError(before, { ...before, script: 'نص', scriptApproved: true }, chief, ctx)).toBeNull();
  });

  it('freezes closed cards for everyone but supervisors', () => {
    const closed = card({ status: 'CLOSED' });
    expect(cardChangeError(closed, withStep(closed, 's1', { status: 'IN_PROGRESS' }), reporter, ctx)).toContain('مغلق');
    expect(cardChangeError(closed, { ...closed, status: 'OPEN' }, chief, ctx)).toBeNull();
  });

  it('keeps a branch supervisor inside the stations linked to theirs', () => {
    const restricted: CardContext = { ...ctx, stations: [{ id: 'gaza', name: 'غزة', linkedIds: ['beirut'] }, { id: 'beirut', name: 'بيروت', linkedIds: [] }, { id: 'istanbul', name: 'إسطنبول', linkedIds: [] }] };
    const gazaChief: CardActor = { id: 'reporter', stationId: 'gaza', canManage: true, canWork: true };
    const base = card({ steps: [step('s1', 'edit')] });
    expect(cardChangeError(null, withStep(base, 's1', { assigneeId: 'editor' }), gazaChief, restricted)).toBeNull();
    expect(cardChangeError(null, withStep(base, 's1', { assigneeId: 'montage' }), gazaChief, restricted)).toContain('غير مرتبطة');
    expect(cardChangeError(null, withStep(base, 's1', { assigneeId: 'montage' }), chief, restricted)).toBeNull();
    // An assignment made earlier by someone else is not re-checked when the card is edited.
    const existing = withStep(base, 's1', { assigneeId: 'montage' });
    expect(cardChangeError(existing, { ...existing, title: 'عنوان معدّل' }, gazaChief, restricted)).toBeNull();
  });
});

describe('cards that outlive changes around them', () => {
  it('stay editable after an assignee leaves or a station is removed', () => {
    const before = card();
    const later: CardContext = { ...ctx, stations: stations.filter((s) => s.id !== 'istanbul'), users: new Map([...ctx.users].filter(([id]) => id !== 'reporter')) };
    // The editor still finishes their own step, and a supervisor still edits the card.
    expect(cardChangeError(before, withStep(before, 's2', { status: 'DONE' }), editor, later)).toBeNull();
    expect(cardChangeError(before, { ...before, title: 'عنوان معدّل' }, chief, later)).toBeNull();
    // New assignments must still name people and stations that exist.
    expect(cardChangeError(before, withStep(before, 's2', { assigneeId: 'reporter' }), chief, later)).toContain('المكلف');
    expect(cardChangeError(before, withStep(before, 's2', { assigneeId: undefined, stationId: 'istanbul' }), chief, later)).toContain('محطة');
    expect(cardChangeError(before, { ...before, ownerId: 'reporter' }, chief, later)).toContain('صاحب القرار');
  });
});

describe('merging a write based on an older version', () => {
  const base = card({ script: 'نص أول', log: [{ id: 'l1', kind: 'NOTE', text: 'بداية' }] });

  it('keeps offline work on one step when a colleague changed another part of the card', () => {
    const mine = { ...withStep(base, 's1', { status: 'DONE', note: 'رُفعت الشهادة', spentMinutes: 90 }), log: [...base.log!, { id: 'l-mine', kind: 'NOTE' as const, text: 'المادة على القرص' }] };
    const current = { ...withStep(base, 's2', { status: 'IN_PROGRESS', startedAt: '2026-11-19T09:00:00Z' }), airAt: '2026-11-20T18:00:00Z', log: [...base.log!, { id: 'l-theirs', kind: 'STEP' as const, text: '«التحقق»: قيد التنفيذ' }] };
    const merged = mergeCardChanges(base, mine, current)!;
    expect(merged.steps[0]).toMatchObject({ status: 'DONE', note: 'رُفعت الشهادة', spentMinutes: 90 });
    expect(merged.steps[1]).toMatchObject({ status: 'IN_PROGRESS', startedAt: '2026-11-19T09:00:00Z' });
    expect(merged.airAt).toBe('2026-11-20T18:00:00Z');
    expect(merged.log!.map((e) => e.id)).toEqual(['l1', 'l-theirs', 'l-mine']);
    // The merged card is an ordinary change by the reporter to the stored card.
    expect(cardChangeError(current, merged, reporter, ctx)).toBeNull();
  });

  it('merges different fields of the same step, and keeps what the server stamped meanwhile', () => {
    const mine = withStep(base, 's1', { status: 'IN_PROGRESS' });
    const current = withStep(base, 's1', { dueAt: '2026-11-19T15:00:00Z', assigneeName: 'ليلى النجار' });
    expect(mergeCardChanges(base, mine, current)!.steps[0]).toMatchObject({ status: 'IN_PROGRESS', dueAt: '2026-11-19T15:00:00Z', assigneeName: 'ليلى النجار' });
  });

  it('refuses when both sides changed the same thing', () => {
    expect(mergeCardChanges(base, withStep(base, 's1', { status: 'DONE' }), withStep(base, 's1', { status: 'BLOCKED', blockedReason: 'عطل' }))).toBeNull();
    expect(mergeCardChanges(base, { ...base, script: 'نصي' }, { ...base, script: 'نص زميلي' })).toBeNull();
    // The same change made on both sides is not a conflict.
    expect(mergeCardChanges(base, { ...base, script: 'نص متفق عليه' }, { ...base, script: 'نص متفق عليه' })!.script).toBe('نص متفق عليه');
  });

  it('refuses when the card was closed, deleted or its steps rearranged', () => {
    const mine = withStep(base, 's1', { status: 'DONE' });
    expect(mergeCardChanges(base, mine, { ...base, status: 'CLOSED' })).toBeNull();
    expect(mergeCardChanges(base, mine, { ...base, deletedAt: '2026-11-19T10:00:00Z' })).toBeNull();
    expect(mergeCardChanges(base, { ...mine, steps: mine.steps.slice(0, 2) }, base)).toBeNull();
    expect(mergeCardChanges(base, mine, { ...base, steps: base.steps.slice(1) })).toBeNull();
    // A step added by a supervisor meanwhile stays, and so does a removed one the sender never touched.
    const added = { ...base, steps: [...base.steps, step('s9', 'publish')] };
    expect(mergeCardChanges(base, mine, added)!.steps.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's9']);
    expect(mergeCardChanges(base, mine, { ...base, steps: base.steps.slice(0, 2) })!.steps.map((s) => s.id)).toEqual(['s1', 's2']);
  });
});

describe('trial fixes: rework, blockers, claiming, time and station scope', () => {
  // usr chain: gather (reporter) → verify (editor) → montage (montage) → quality (quality).
  const qualityActor: CardActor = { id: 'quality', stationId: 'istanbul', role: 'QUALITY', departmentId: 'quality', canManage: false, canWork: true };
  const qctx: CardContext = { ...ctx, users: new Map([...ctx.users, ['quality', { stationId: 'istanbul' }]]) };
  const chain = () =>
    card({
      steps: [
        step('s1', 'gather', { assigneeId: 'reporter', stationId: 'gaza', status: 'DONE' }),
        step('s2', 'montage', { assigneeId: 'montage', stationId: 'istanbul', status: 'DONE' }),
        step('s3', 'graphics', { assigneeId: 'editor', stationId: 'beirut', status: 'DONE' }),
        step('s4', 'quality', { assigneeId: 'quality', stationId: 'istanbul', status: 'IN_PROGRESS' }),
      ],
    });

  it('lets the reviewer send an earlier step back with a reason, resetting the steps after it', () => {
    const before = chain();
    expect(canSendBack(before, qualityActor, 's4')).toBe(true);
    expect(sendBackTargets(before, 's4').map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    const back = sendBackCard(before, 's2', 'اسم الشاهد الثاني غير مثبت', 's4');
    expect(back.steps.map((s) => s.status)).toEqual(['DONE', 'IN_PROGRESS', 'TODO', 'IN_PROGRESS']);
    expect(back.steps[1].returnedReason).toBe('اسم الشاهد الثاني غير مثبت');
    expect(cardChangeError(before, back, qualityActor, qctx)).toBeNull();
    // A reason is required.
    expect(cardChangeError(before, sendBackCard(before, 's2', '  ', 's4'), qualityActor, qctx)).toContain('سبب الإعادة');
    // Someone without a review step after it may not.
    expect(cardChangeError(before, sendBackCard(before, 's1', 'سبب'), editor, qctx)).toContain('لصاحب التكليف');
    // Sending back must not touch anything else on someone else's step.
    const sneaky = { ...back, steps: back.steps.map((s) => (s.id === 's2' ? { ...s, note: 'مدسوسة' } : s)) };
    expect(cardChangeError(before, sneaky, qualityActor, qctx)).toContain('أُسندت إليه');
    // The owner may send back from anywhere.
    const owner: CardActor = { id: 'reporter', stationId: 'gaza', canManage: false, canWork: true };
    expect(cardChangeError({ ...before, ownerId: 'reporter' }, { ...sendBackCard(before, 's3', 'الخريطة خاطئة'), ownerId: 'reporter' }, owner, qctx)).toBeNull();
  });

  it('offers a station step only to colleagues whose kind of work it is', () => {
    const montageStep = step('m', 'montage', { stationId: 'gaza' });
    const translate = step('t', 'translate', { stationId: 'gaza' });
    const montage: CardActor = { id: 'm1', stationId: 'gaza', role: 'MONTAGE', departmentId: 'montage', canManage: false, canWork: true };
    const reports: CardActor = { id: 'r1', stationId: 'gaza', role: 'REPORTS_EDITOR', departmentId: 'reports', canManage: false, canWork: true };
    const manager: CardActor = { id: 'mgr', stationId: 'gaza', role: 'STATION_MANAGER', departmentId: 'newsroom', canManage: true, canWork: true };
    expect(canClaimStep(montageStep, montage)).toBe(true);
    expect(canClaimStep(translate, montage)).toBe(false);
    expect(canClaimStep(montageStep, reports)).toBe(false);
    expect(canClaimStep(step('e', 'edit', { stationId: 'gaza' }), reports)).toBe(true);
    expect(canClaimStep(translate, manager)).toBe(true);
    expect(stepFitsActor('my-custom-type', montage)).toBe(true);
    // A step left to a department is for that department.
    expect(canClaimStep(step('d', 'edit', { stationId: 'gaza', departmentId: 'reports' }), reports)).toBe(true);
    expect(canClaimStep(step('d', 'montage', { stationId: 'gaza', departmentId: 'graphics' }), montage)).toBe(false);
    expect(canClaimStep(step('d', 'edit', { departmentId: 'reports' }), { ...reports, departmentId: undefined })).toBe(false);
    expect(canClaimStep(step('d', 'edit', { departmentId: 'reports' }), manager)).toBe(false);
    // Enforced on writes too.
    const before = card({ steps: [step('x', 'translate', { stationId: 'gaza' })] });
    const claimed = withStep(before, 'x', { assigneeId: 'm1', status: 'IN_PROGRESS' });
    expect(cardChangeError(before, claimed, montage, { ...ctx, users: new Map([...ctx.users, ['m1', { stationId: 'gaza' }]]) })).toContain('المكلف');
  });

  it('adds work sessions to the time spent and never rewrites them', () => {
    const before = card({ steps: [step('s1', 'gather', { assigneeId: 'reporter', status: 'DONE', spentMinutes: 75, timeLog: [{ id: 'tm1', minutes: 75 }] })] });
    const reopened = withStep(before, 's1', { status: 'IN_PROGRESS' });
    expect(cardChangeError(before, reopened, reporter, ctx)).toBeNull();
    const again = withStep(reopened, 's1', { status: 'DONE', spentMinutes: 90, timeLog: [{ id: 'tm1', minutes: 75 }, { id: 'tm2', minutes: 15 }] });
    expect(cardChangeError(reopened, again, reporter, ctx)).toBeNull();
    expect(timeLogMinutes(again.steps[0].timeLog)).toBe(90);
    expect(cardChangeError(reopened, withStep(reopened, 's1', { spentMinutes: 15 }), reporter, ctx)).toContain('يُضاف');
    expect(cardChangeError(reopened, withStep(reopened, 's1', { timeLog: [{ id: 'tm1', minutes: 5 }] }), reporter, ctx)).toContain('سجل الوقت');
  });

  it('keeps decisions with the owner and supervisors', () => {
    const before = card();
    const decision = { ...before, log: [{ id: 'l1', kind: 'NOTE' as const, text: 'سحب من نشرة الظهيرة', decision: true }] };
    expect(cardChangeError(before, decision, editor, ctx)).toContain('القرار');
    expect(cardChangeError(before, decision, chief, ctx)).toBeNull();
    expect(cardChangeError({ ...before, ownerId: 'editor' }, { ...decision, ownerId: 'editor' }, editor, ctx)).toBeNull();
  });

  it('lets a branch close, cancel or delete only the assignments it governs', () => {
    const stationsMain: Station[] = [{ id: 'gaza', name: 'غزة' }, { id: 'beirut', name: 'بيروت' }, { id: 'istanbul', name: 'إسطنبول', isMain: true }];
    const mctx: CardContext = { ...ctx, stations: stationsMain };
    const gazaChief: CardActor = { id: 'g-chief', stationId: 'gaza', canManage: true, canWork: true };
    const mainCard = card({ ownerId: 'chief', ownerStationId: 'istanbul' });
    const gazaCard = card({ ownerId: 'chief', ownerStationId: 'gaza' });
    expect(canGovernCard(mainCard, gazaChief, stationsMain)).toBe(false);
    expect(canGovernCard(gazaCard, gazaChief, stationsMain)).toBe(true);
    expect(canGovernCard(card({ ownerStationId: 'beirut' }), gazaChief, stationsMain)).toBe(true);
    expect(canGovernCard(gazaCard, { ...gazaChief, stationId: 'istanbul' }, stationsMain)).toBe(true);
    expect(canGovernCard(mainCard, { ...gazaChief, id: 'chief' }, stationsMain)).toBe(true);
    expect(cardChangeError(mainCard, { ...mainCard, status: 'CANCELLED' }, gazaChief, mctx)).toContain('المحطة الرئيسية');
    expect(cardChangeError(gazaCard, { ...gazaCard, status: 'CLOSED' }, gazaChief, mctx)).toBeNull();
  });

  it('reports a blocked card past its deadline as late too, without blaming the step waiting behind it', () => {
    const c = card({
      dueAt: '2026-11-19T11:00:00Z',
      steps: [
        step('s1', 'montage', { status: 'BLOCKED', blockedReason: 'اللقطات لم تصل', dueAt: '2026-11-19T10:00:00Z' }),
        step('s2', 'quality', { dueAt: '2026-11-19T11:00:00Z' }),
      ],
    });
    expect(cardState(c, NOW)).toBe('BLOCKED');
    expect(cardStates(c, NOW)).toEqual(['BLOCKED', 'LATE']);
    expect(isStepOwnLate(c, c.steps[0], NOW)).toBe(true);
    expect(isStepOwnLate(c, c.steps[1], NOW)).toBe(false);
    expect(openStepsBefore(c, 's2').map((s) => s.id)).toEqual(['s1']);
  });

  it('names station- and department-wide steps instead of «غير مسندة»', () => {
    expect(stepAssigneeLabel(step('a', 'edit', { stationId: 'gaza' }), stations)).toBe('متاحة لمحطة غزة');
    expect(stepAssigneeLabel(step('a', 'edit', { departmentId: 'montage' }), stations)).toBe('متاحة لقسم المونتاج');
    expect(stepAssigneeLabel(step('a', 'edit'), stations)).toBe('غير مسندة');
    expect(stepAssigneeLabel(step('a', 'edit', { assigneeName: 'سامر' }), stations)).toBe('سامر');
  });
});
