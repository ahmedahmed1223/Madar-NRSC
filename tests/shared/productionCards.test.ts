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
  isCardLate,
  stepPoints,
  stepTypesError,
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
    expect(cardChangeError(null, card({ status: 'CLOSED' }), chief, ctx)).toContain('تبدأ جارية');
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
    expect(cardChangeError(closed, withStep(closed, 's1', { status: 'IN_PROGRESS' }), reporter, ctx)).toContain('مغلقة');
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
