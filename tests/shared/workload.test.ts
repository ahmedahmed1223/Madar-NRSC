import { describe, expect, it } from 'vitest';
import { DEFAULT_STEP_TYPES, type CardStep, type ProductionCard } from '../../src/shared/productionCards';
import { collectWork, comparePeriods, dailyTrend, employeeFile, groupLoad, heavyThreshold, HIGH_LOAD_FACTOR, LOAD_LEVEL_RULE, loadByPerson, loadByStation, minutesLabel, previousPeriod, producedAt, productionSummary, type Period } from '../../src/shared/workload';
import { buildHandover, handoverText } from '../../src/shared/handover';
import type { Station } from '../../src/shared/stations';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const week: Period = { from: Date.parse('2026-11-13T00:00:00Z'), to: Date.parse('2026-11-20T00:00:00Z') };
const stations: Station[] = [{ id: 'gaza', name: 'غزة' }, { id: 'beirut', name: 'بيروت' }, { id: 'istanbul', name: 'إسطنبول' }];
const users = [
  { id: 'g1', fullName: 'مراسل غزة', stationId: 'gaza', isActive: true },
  { id: 'b1', fullName: 'محرر بيروت', stationId: 'beirut', isActive: true },
  { id: 'b2', fullName: 'محرر بيروت الثاني', stationId: 'beirut', isActive: true },
  { id: 'i1', fullName: 'مونتير إسطنبول', stationId: 'istanbul', isActive: true },
  { id: 'gone', fullName: 'موقوف', stationId: 'gaza', isActive: false },
];
const step = (id: string, type: string, extra: Partial<CardStep> = {}): CardStep => ({ id, type, status: 'TODO', complexity: 1, ...extra });

/** A report gathered in Gaza, verified in Beirut and still waiting for montage in Istanbul. */
const shared: ProductionCard = {
  id: 'shared', title: 'شهادة مصوّرة', kind: 'REPORT', priority: 'URGENT', status: 'OPEN', ownerId: 'b1', ownerName: 'محرر بيروت', airAt: '2026-11-19T16:00:00Z',
  steps: [
    step('s1', 'gather', { assigneeId: 'g1', stationId: 'gaza', complexity: 3, status: 'DONE', doneAt: '2026-11-19T08:00:00Z', doneById: 'g1', doneByName: 'مراسل غزة', startedAt: '2026-11-19T06:00:00Z', spentMinutes: 120, note: 'رُفعت الشهادة' }),
    step('s2', 'verify', { assigneeId: 'b1', stationId: 'beirut', status: 'DONE', doneAt: '2026-11-19T10:00:00Z', doneById: 'b1', doneByName: 'محرر بيروت', spentMinutes: 30 }),
    step('s3', 'montage', { assigneeId: 'i1', stationId: 'istanbul', complexity: 2, status: 'IN_PROGRESS', dueAt: '2026-11-19T11:00:00Z', estimateMinutes: 90, startedAt: '2026-11-19T10:05:00Z' }),
    step('s4', 'publish', { stationId: 'istanbul', dueAt: '2026-11-19T15:30:00Z' }),
  ],
  log: [{ id: 'l1', kind: 'NOTE', text: 'ينقص تأكيد اسم الشاهد', byName: 'محرر بيروت', stationId: 'beirut', at: '2026-11-19T10:01:00Z' }],
};
/** A brief finished entirely in Beirut. */
const local: ProductionCard = {
  id: 'local', title: 'موجز الظهيرة', kind: 'BRIEF', priority: 'NORMAL', status: 'CLOSED', closedAt: '2026-11-18T12:00:00Z',
  steps: [step('a', 'edit', { assigneeId: 'b2', stationId: 'beirut', status: 'DONE', doneAt: '2026-11-18T11:00:00Z', doneById: 'b2' }), step('b', 'graphics', { status: 'SKIPPED' })],
};
/** Finished by all three stations last week. */
const finished: ProductionCard = {
  id: 'finished', title: 'تقرير المعبر', kind: 'REPORT', priority: 'NORMAL', status: 'OPEN',
  steps: [
    step('a', 'gather', { assigneeId: 'g1', stationId: 'gaza', status: 'DONE', doneAt: '2026-11-17T08:00:00Z', doneById: 'g1' }),
    step('b', 'edit', { assigneeId: 'b1', stationId: 'beirut', status: 'DONE', doneAt: '2026-11-17T09:00:00Z', doneById: 'b1' }),
    step('c', 'montage', { assigneeId: 'i1', stationId: 'istanbul', status: 'DONE', doneAt: '2026-11-17T12:00:00Z', doneById: 'i1' }),
  ],
};
const blocked: ProductionCard = {
  id: 'blocked', title: 'مقابلة الوزير', kind: 'INTERVIEW', priority: 'NORMAL', status: 'OPEN', ownerName: 'محرر بيروت',
  steps: [step('a', 'gather', { assigneeId: 'g1', stationId: 'gaza', status: 'BLOCKED', blockedReason: 'لا تصريح بالتصوير' })],
};
const cancelled: ProductionCard = { id: 'x', title: 'ملغاة', kind: 'NEWS', priority: 'NORMAL', status: 'CANCELLED', steps: [step('a', 'edit', { assigneeId: 'b1', stationId: 'beirut' })] };
const cards = [shared, local, finished, blocked, cancelled];

const tasks = [
  { id: 't1', title: 'متابعة مؤتمر', assigneeId: 'b2', status: 'TODO', dueDate: '2026-11-18T10:00:00Z', createdAt: '2026-11-17T10:00:00Z' },
  { id: 't2', title: 'أرشفة', assigneeId: 'b2', status: 'COMPLETED', completedAt: '2026-11-18T15:00:00Z', createdAt: '2026-11-18T10:00:00Z',
    execution: { startedAt: '2026-11-18T12:00:00Z', activeSeconds: 4500, endedAt: '2026-11-18T15:00:00Z' } },
  { id: 't3', title: 'ملغاة', assigneeId: 'b2', status: 'CANCELLED' },
];
const requests = [
  { id: 'r1', title: 'مونتاج عاجل', assigneeId: 'i1', status: 'DONE', priority: 'URGENT', createdAt: '2026-11-18T08:00:00Z', history: [{ status: 'ACCEPTED', at: '2026-11-18T08:10:00Z' }, { status: 'DONE', at: '2026-11-18T09:00:00Z' }] },
  { id: 'r2', title: 'مرفوض', assigneeId: 'i1', status: 'REJECTED' },
];
const news = [
  { id: 'n1', title: 'خبر منشور', authorId: 'b1', status: 'PUBLISHED', createdAt: '2026-11-18T07:00:00Z', approvedAt: '2026-11-18T08:00:00Z' },
  { id: 'n2', title: 'مسودة', authorId: 'g1', status: 'DRAFT', createdAt: '2026-11-19T07:00:00Z' },
  { id: 'n3', title: 'خبر له بطاقة', authorId: 'b1', status: 'PUBLISHED', approvedAt: '2026-11-18T08:00:00Z' },
];
const withTarget = [...cards, { ...cancelled, id: 'linked', status: 'OPEN' as const, steps: [], target: { kind: 'news' as const, id: 'n3', title: 'خبر له بطاقة' } }];
const items = collectWork({ cards: withTarget, tasks, requests, news, users, stepTypes: DEFAULT_STEP_TYPES, now: NOW });

describe('collecting work', () => {
  it('uses tracked task execution in the employee file', () => {
    const file = employeeFile(items, users.find(user => user.id === 'b2')!, week);
    expect(file.done.find(item => item.key === 'task:t2')).toMatchObject({ startedAt: '2026-11-18T12:00:00Z', spentMinutes: 75 });
    expect(file.totals.spentMinutes).toBe(75);
  });
  it('turns every recorded piece of work into one item', () => {
    const keys = items.map((i) => i.key);
    expect(keys).toContain('card:shared:s3');
    expect(keys).toContain('task:t1');
    expect(keys).toContain('request:r1');
    expect(keys).toContain('news:n1');
    // Cancelled, rejected and skipped work is nobody's load and nobody's output.
    expect(keys.some((k) => k.startsWith('card:x:'))).toBe(false);
    expect(keys).not.toContain('task:t3');
    expect(keys).not.toContain('request:r2');
    expect(keys).not.toContain('card:local:b');
    // A story produced through a card is counted by the card.
    expect(keys).not.toContain('news:n3');
  });

  it('marks what is open, overdue and blocked', () => {
    const by = (key: string) => items.find((i) => i.key === key)!;
    expect(by('card:shared:s3')).toMatchObject({ open: true, overdue: true, blocked: false, points: 6, userId: 'i1', stationId: 'istanbul' });
    expect(by('card:shared:s4')).toMatchObject({ open: true, overdue: false, userId: undefined, stationId: 'istanbul' });
    expect(by('card:blocked:a')).toMatchObject({ open: true, blocked: true });
    expect(by('card:shared:s1')).toMatchObject({ open: false, points: 9, doneAt: '2026-11-19T08:00:00Z' });
    expect(by('task:t1')).toMatchObject({ open: true, overdue: true, stationId: 'beirut' });
    expect(by('request:r1')).toMatchObject({ open: false, points: 4, doneAt: '2026-11-18T09:00:00Z' });
    expect(by('news:n2')).toMatchObject({ open: true, stationId: 'gaza' });
  });
});

describe('load and output', () => {
  it('sums each active person', () => {
    const rows = loadByPerson(items, users, week);
    expect(rows.map((r) => r.id)).not.toContain('gone');
    expect(rows.find((r) => r.id === 'i1')).toMatchObject({ open: 1, openPoints: 6, openMinutes: 90, overdue: 1, done: 2, donePoints: 7 });
    expect(rows.find((r) => r.id === 'g1')).toMatchObject({ open: 2, blocked: 1, done: 2, donePoints: 12, spentMinutes: 120 });
    expect(rows.find((r) => r.id === 'b2')).toMatchObject({ open: 1, overdue: 1, done: 2 });
  });

  it('compares the open load per person between stations', () => {
    const rows = loadByStation(items, users, stations, week);
    const gaza = rows.find((r) => r.id === 'gaza')!;
    const beirut = rows.find((r) => r.id === 'beirut')!;
    const istanbul = rows.find((r) => r.id === 'istanbul')!;
    expect(gaza).toMatchObject({ people: 1, open: 2, openPoints: 5, perPerson: 5 });
    expect(beirut).toMatchObject({ people: 2, open: 1, openPoints: 2, perPerson: 1 });
    expect(istanbul).toMatchObject({ people: 1, open: 2, openPoints: 7, perPerson: 7, unassigned: 1 });
    expect(beirut.level).toBe('LOW');
    expect(istanbul.level).toBe('HIGH');
    expect(gaza.level).toBe('NORMAL');
    expect(rows.some((r) => r.id === '')).toBe(false);
  });

  it('lists people without a station under their own row', () => {
    const rows = loadByStation(items, [...users, { id: 'hq', fullName: 'مدير', isActive: true }], stations, week);
    expect(rows.find((r) => r.id === '')).toMatchObject({ people: 1, name: 'بدون محطة', level: null });
  });

  it('counts a shared item once and credits each station for its part', () => {
    expect(producedAt(finished)).toBe('2026-11-17T12:00:00Z');
    expect(producedAt(shared)).toBeUndefined();
    const summary = productionSummary(cards, DEFAULT_STEP_TYPES, week);
    expect(summary.total).toBe(2);
    expect(summary.shared).toBe(1);
    expect(summary.byKind).toEqual([{ kind: 'BRIEF', count: 1 }, { kind: 'REPORT', count: 1 }]);
    const beirut = summary.byStation.find((s) => s.stationId === 'beirut')!;
    expect(beirut).toMatchObject({ cards: 2, shared: 1, steps: 2, points: 4 });
    expect(summary.byStation.find((s) => s.stationId === 'gaza')).toMatchObject({ cards: 1, shared: 1, points: 3 });
    expect(summary.byStation.reduce((sum, s) => sum + s.share, 0)).toBeGreaterThanOrEqual(99);
    expect(productionSummary(cards, DEFAULT_STEP_TYPES, { from: 0, to: 1 }).total).toBe(0);
  });

  it('builds the record of one colleague: what, how much and when', () => {
    const file = employeeFile(items, users[0], week);
    expect(file.done.map((i) => i.key)).toEqual(['card:shared:s1', 'card:finished:a']);
    expect(file.open.map((i) => i.key).sort()).toEqual(['card:blocked:a', 'news:n2']);
    expect(file.totals).toMatchObject({ done: 2, donePoints: 12, spentMinutes: 120, open: 2 });
    expect(file.byType).toEqual([{ typeName: 'جمع المادة ميدانياً', count: 2, points: 12 }]);
    expect(file.days).toEqual([{ date: '2026-11-19', done: 1, started: 2 }, { date: '2026-11-17', done: 1, started: 0 }]);
    expect(employeeFile(items, users[0], { from: 0, to: 1 }).done).toEqual([]);
  });

  it('formats minutes for people', () => {
    expect(minutesLabel(0)).toBe('—');
    expect(minutesLabel(45)).toBe('45 د');
    expect(minutesLabel(120)).toBe('2 س');
    expect(minutesLabel(135)).toBe('2 س 15 د');
  });
});

describe('shift handover brief', () => {
  const options = { from: Date.parse('2026-11-19T04:00:00Z'), now: NOW, aheadHours: 8, stepTypes: DEFAULT_STEP_TYPES, time: (iso: string) => iso.slice(11, 16) };

  it('lists each card once, in its most pressing section, with the step it waits on', () => {
    const brief = buildHandover(cards, { ...options, stationId: null });
    // The shared card is late (montage), so it sits under "stuck" only, not also under "due" and "in progress".
    expect(brief.stuck.map((l) => l.cardId)).toEqual(['shared', 'blocked']);
    expect(brief.dueNext).toHaveLength(0);
    expect(brief.inProgress).toHaveLength(0);
    expect(brief.stuck[0].detail.startsWith('البث 16:00 — المونتاج متأخرة')).toBe(true);
    expect(brief.stuck[1].detail).toContain('لا تصريح بالتصوير');
    expect(brief.stuck[1].detail).toContain('القرار عند محرر بيروت');
    // What was finished on the card during the shift and the notes ride on the same row.
    expect(brief.stuck[0].doneInShift).toHaveLength(2);
    expect(brief.stuck[0].doneInShift[0]).toContain('رُفعت الشهادة');
    expect(brief.stuck[0].notes[0]).toContain('ينقص تأكيد اسم الشاهد');
    const all = [...brief.stuck, ...brief.dueNext, ...brief.inProgress, ...brief.finished].map((l) => l.cardId);
    expect(new Set(all).size).toBe(all.length);
  });

  it('limits the brief to one station', () => {
    const gaza = buildHandover(cards, { ...options, stationId: 'gaza' });
    expect(gaza.stuck.map((l) => l.cardId)).toEqual(['blocked']);
    // Gaza worked on the shared card, so its airing is on Gaza's brief, with the step it now waits on elsewhere.
    expect(gaza.dueNext.map((l) => l.cardId)).toEqual(['shared']);
    expect(gaza.dueNext[0].detail).toContain('بانتظار المونتاج');
    expect(gaza.dueNext[0].doneInShift).toHaveLength(1);
    expect(gaza.dueNext[0].notes).toHaveLength(0);
    expect(gaza.inProgress).toHaveLength(0);
  });

  it('names the station a step was addressed to instead of «غير مسندة»', () => {
    const toStation: ProductionCard = { id: 'st', title: 'نشر', kind: 'NEWS', priority: 'NORMAL', status: 'OPEN', steps: [step('a', 'publish', { stationId: 'istanbul', dueAt: '2026-11-19T10:00:00Z' })] };
    const brief = buildHandover([toStation], { ...options, stationId: null, stationName: (id) => stations.find((s) => s.id === id)?.name || id });
    expect(brief.stuck[0].detail).toContain('محطة إسطنبول — لم تُستلم');
  });

  it('puts work moving during the shift under "in progress" and closed cards under "finished"', () => {
    const moving: ProductionCard = { id: 'mv', title: 'متابعة', kind: 'NEWS', priority: 'NORMAL', status: 'OPEN', steps: [step('a', 'edit', { stationId: 'beirut', assigneeName: 'محرر بيروت', status: 'IN_PROGRESS' }), step('b', 'quality', { stationId: 'beirut' })] };
    const closed: ProductionCard = { id: 'cl', title: 'مغلقة', kind: 'NEWS', priority: 'NORMAL', status: 'CLOSED', steps: [step('a', 'edit', { stationId: 'beirut', status: 'DONE', doneAt: '2026-11-19T09:00:00Z', doneByName: 'محرر بيروت' })] };
    const brief = buildHandover([moving, closed], { ...options, stationId: 'beirut' });
    expect(brief.inProgress.map((l) => l.cardId)).toEqual(['mv']);
    expect(brief.finished.map((l) => l.cardId)).toEqual(['cl']);
  });

  it('writes the brief as plain text, the manager\'s notes first', () => {
    const text = handoverText(buildHandover(cards, { ...options, stationId: null }), 'موجز تسليم المناوبة', 'تابعوا موجز الظهيرة');
    expect(text.startsWith('موجز تسليم المناوبة')).toBe(true);
    expect(text.indexOf('ملاحظات مسؤول المناوبة')).toBeLessThan(text.indexOf('■ متعطل'));
    expect(text).toContain('تابعوا موجز الظهيرة');
    expect(text).toContain('■ متعطل أو متأخر — يحتاج قراراً (2)');
    expect(text).toContain('■ مستحق خلال 8 ساعات (0)');
    expect(text).toContain('[عاجل] شهادة مصوّرة');
    expect(text).toContain('أُنجز في المناوبة:');
    expect(handoverText(buildHandover([], { ...options, stationId: null }), 'x')).toContain('لا شيء متعطل.');
  });
});

describe('reviews, trend and comparison', () => {
  const reviewed = [
    {
      id: 'r', title: 'خبر روجع', authorId: 'g1', status: 'PUBLISHED', approvedAt: '2026-11-18T09:00:00Z',
      workflowLogs: [
        { id: 'w1', fromStatus: 'UNDER_REVIEW', toStatus: 'NEEDS_REVISION', changedBy: { id: 'b1' }, timestamp: '2026-11-17T09:00:00Z' },
        { id: 'w2', fromStatus: 'UNDER_REVIEW', toStatus: 'APPROVED', changedBy: { id: 'b1' }, timestamp: '2026-11-18T09:00:00Z' },
        { id: 'w3', fromStatus: 'DRAFT', toStatus: 'UNDER_REVIEW', changedBy: { id: 'g1' }, timestamp: '2026-11-17T08:00:00Z' },
        { id: 'w4', fromStatus: 'UNDER_REVIEW', toStatus: 'APPROVED', changedBy: { id: 'g1' }, timestamp: '2026-11-18T08:00:00Z' },
      ],
    },
  ];
  const work = collectWork({ cards: [], tasks: [], requests: [], news: reviewed, users, stepTypes: DEFAULT_STEP_TYPES, now: NOW });

  it('credits each review decision to the reviewer, never to the writer reviewing themselves', () => {
    const reviews = work.filter((i) => i.source === 'REVIEW');
    expect(reviews.map((i) => i.userId)).toEqual(['b1', 'b1']);
    expect(reviews.every((i) => !i.open && i.stationId === 'beirut')).toBe(true);
    const beirut = loadByStation(work, users, stations, week).find((r) => r.id === 'beirut')!;
    expect(beirut.done).toBe(2);
  });

  it('lists every day of the period, quiet days included', () => {
    const trend = dailyTrend(items, week);
    expect(trend).toHaveLength(7);
    expect(trend[0].date).toBe('2026-11-13');
    expect(trend.find((d) => d.date === '2026-11-17')!.done).toBe(3);
    expect(trend.find((d) => d.date === '2026-11-14')!.done).toBe(0);
  });

  it('compares the period with the one before it', () => {
    expect(previousPeriod(week)).toEqual({ from: Date.parse('2026-11-06T00:00:00Z'), to: week.from });
    const today: Period = { from: Date.parse('2026-11-19T00:00:00Z'), to: Date.parse('2026-11-20T00:00:00Z') };
    const cmp = comparePeriods(items, today);
    expect(cmp.done).toBe(2);
    expect(cmp.previousDone).toBeGreaterThan(0);
    expect(cmp.change).not.toBeNull();
    expect(comparePeriods([], today).change).toBeNull();
  });

  it('states the rating rule with the same factors it uses', () => {
    expect(LOAD_LEVEL_RULE).toContain('1.5');
    expect(HIGH_LOAD_FACTOR).toBe(1.5);
  });
});

describe('teams', () => {
  it('gathers people into teams with who is free now', () => {
    const people = loadByPerson(items, users, week);
    const teams = groupLoad(people, (r) => String((r as any).stationId || ''), (id) => stations.find((s) => s.id === id)?.name || 'بدون محطة');
    const beirut = teams.find((t) => t.id === 'beirut')!;
    expect(beirut.people).toBe(2);
    expect(beirut.members.map((m) => m.id)).toContain('b2');
    // Gaza's only person carries a blocked step, so Gaza leads the list.
    expect(teams[0].blocked + teams[0].overdue).toBeGreaterThan(0);
    expect(teams.reduce((n, t) => n + t.people, 0)).toBe(people.length);
    const free = people.filter((p) => p.open === 0).length;
    expect(teams.reduce((n, t) => n + t.free, 0)).toBe(free);
  });
  it('marks heavy load above 1.5 times the average', () => {
    const rows = [{ openPoints: 10 }, { openPoints: 2 }, { openPoints: 0 }].map((r, i) => ({ ...loadByPerson([], [users[0]], week)[0], id: String(i), ...r }));
    expect(heavyThreshold(rows)).toBe(6);
    expect(heavyThreshold([])).toBe(Infinity);
  });
});
