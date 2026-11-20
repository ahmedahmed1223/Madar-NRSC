/**
 * Reports on assignments («التكليفات»): how much is open, late, blocked and done in a period,
 * grouped by workflow template, department, station or person; how long work takes; how often it
 * is delivered on time; and where steps wait longest before someone starts them.
 *
 * Pure functions over the cards, so the assignments screen, the dashboard and exports all agree.
 */
import { isStepLate, isStepOpen, stepTypeName, type CardStep, type ProductionCard, type StepType } from './productionCards';
import { stationName, type Station } from './stations';
import { departmentName } from './departments';

export type ReportDimension = 'template' | 'department' | 'station' | 'person';

export const REPORT_DIMENSIONS: { id: ReportDimension; name: string }[] = [
  { id: 'template', name: 'حسب القالب' },
  { id: 'department', name: 'حسب القسم' },
  { id: 'station', name: 'حسب المحطة' },
  { id: 'person', name: 'حسب الزميل' },
];

export interface ReportPeriod {
  from: number;
  to: number;
}

export interface ReportPerson {
  id: string;
  name: string;
  departmentId?: string;
  stationId?: string;
}

export interface ReportInput {
  cards: ProductionCard[];
  stepTypes: StepType[];
  stations: Station[];
  people: ReportPerson[];
  period: ReportPeriod;
  now: number;
}

export interface ReportRow {
  key: string;
  label: string;
  /** Still open now. */
  open: number;
  /** Open and past their deadline now. */
  late: number;
  /** Blocked now. */
  blocked: number;
  /** Finished within the period. */
  done: number;
  /** Average minutes from start (assignment: creation) to finish, for what finished in the period. */
  avgCycleMinutes: number | null;
  /** Share of finished work with a deadline that was finished by it (0–1), or null when none had one. */
  onTimeRate: number | null;
}

export interface WaitRow {
  type: string;
  label: string;
  /** Average minutes a step of this kind waited between becoming available and being started. */
  avgWaitMinutes: number | null;
  /** Steps of this kind available now and not started yet. */
  waitingNow: number;
  /** Longest current wait in minutes. */
  longestWaitMinutes: number;
}

const ms = (iso?: string) => (iso ? new Date(iso).getTime() : NaN);
const within = (iso: string | undefined, p: ReportPeriod) => {
  const t = ms(iso);
  return Number.isFinite(t) && t >= p.from && t <= p.to;
};
const live = (cards: ProductionCard[]) => cards.filter((c) => c && !c.deletedAt && c.status !== 'CANCELLED');

/** When the assignment was finished: closed, or its last required step done once all are done. */
export function cardFinishedAt(card: ProductionCard): string | undefined {
  if (card.status === 'CLOSED' && card.closedAt) return card.closedAt;
  const required = (card.steps || []).filter((s) => s.status !== 'SKIPPED');
  if (!required.length || required.some((s) => s.status !== 'DONE')) return card.status === 'CLOSED' ? card.closedAt || card.updatedAt : undefined;
  return required.map((s) => s.doneAt).filter(Boolean).sort().pop() as string | undefined;
}

/** When a step could start: when the step before it was done (or the assignment was created). */
export function stepAvailableAt(card: ProductionCard, step: CardStep): string | undefined {
  const index = (card.steps || []).findIndex((s) => s.id === step.id);
  const before = (card.steps || []).slice(0, Math.max(0, index)).filter((s) => s.status !== 'SKIPPED');
  if (!before.length) return card.createdAt;
  if (before.some((s) => s.status !== 'DONE')) return undefined;
  return before.map((s) => s.doneAt).filter(Boolean).sort().pop() as string | undefined || card.createdAt;
}

interface Acc {
  key: string;
  label: string;
  open: number;
  late: number;
  blocked: number;
  done: number;
  cycle: number[];
  withDeadline: number;
  onTime: number;
}

function row(map: Map<string, Acc>, key: string, label: string): Acc {
  let acc = map.get(key);
  if (!acc) {
    acc = { key, label, open: 0, late: 0, blocked: 0, done: 0, cycle: [], withDeadline: 0, onTime: 0 };
    map.set(key, acc);
  }
  return acc;
}

const finish = (rows: Map<string, Acc>): ReportRow[] =>
  [...rows.values()]
    .map((a) => ({
      key: a.key,
      label: a.label,
      open: a.open,
      late: a.late,
      blocked: a.blocked,
      done: a.done,
      avgCycleMinutes: a.cycle.length ? Math.round(a.cycle.reduce((x, y) => x + y, 0) / a.cycle.length) : null,
      onTimeRate: a.withDeadline ? a.onTime / a.withDeadline : null,
    }))
    .sort((a, b) => b.open + b.done - (a.open + a.done) || a.label.localeCompare(b.label, 'ar'));

/** Assignments grouped by the template they were created from («بدون قالب» for the rest). */
function byTemplate(input: ReportInput): ReportRow[] {
  const rows = new Map<string, Acc>();
  for (const card of live(input.cards)) {
    const acc = row(rows, card.templateId || '', card.templateName || 'بدون قالب');
    if (card.status === 'OPEN') {
      const finished = cardFinishedAt(card);
      if (!finished) {
        acc.open += 1;
        if ((card.steps || []).some((s) => s.status === 'BLOCKED')) acc.blocked += 1;
        const deadline = ms(card.dueAt);
        if ((card.steps || []).some((s) => isStepLate(s, input.now)) || (Number.isFinite(deadline) && deadline < input.now)) acc.late += 1;
      }
    }
    const finished = cardFinishedAt(card);
    if (finished && within(finished, input.period)) {
      acc.done += 1;
      const start = ms(card.createdAt);
      if (Number.isFinite(start)) acc.cycle.push((ms(finished) - start) / 60_000);
      const deadline = ms(card.dueAt || card.airAt);
      if (Number.isFinite(deadline)) {
        acc.withDeadline += 1;
        if (ms(finished) <= deadline) acc.onTime += 1;
      }
    }
  }
  // Templates with no assignment yet stay out: the table is about work.
  return finish(rows);
}

/** Steps grouped by department, station or person. */
function bySteps(input: ReportInput, dimension: Exclude<ReportDimension, 'template'>): ReportRow[] {
  const people = new Map(input.people.map((p) => [p.id, p]));
  const rows = new Map<string, Acc>();
  const keyOf = (step: CardStep): [string, string] => {
    const person = step.assigneeId ? people.get(step.assigneeId) : undefined;
    if (dimension === 'person') return step.assigneeId ? [step.assigneeId, person?.name || step.assigneeName || 'زميل'] : ['', 'غير مسندة'];
    if (dimension === 'station') {
      const id = step.stationId || person?.stationId || '';
      return [id, stationName(input.stations, id)];
    }
    const id = person?.departmentId || step.departmentId || '';
    return [id, id ? departmentName(id) : 'بدون قسم'];
  };
  for (const card of live(input.cards)) {
    for (const step of card.steps || []) {
      if (step.status === 'SKIPPED') continue;
      const [key, label] = keyOf(step);
      const acc = row(rows, key, label);
      if (card.status === 'OPEN' && isStepOpen(step)) {
        acc.open += 1;
        if (step.status === 'BLOCKED') acc.blocked += 1;
        if (isStepLate(step, input.now)) acc.late += 1;
      }
      if (step.status === 'DONE' && within(step.doneAt, input.period)) {
        acc.done += 1;
        const start = ms(step.startedAt);
        if (Number.isFinite(start)) acc.cycle.push((ms(step.doneAt) - start) / 60_000);
        if (step.dueAt) {
          acc.withDeadline += 1;
          if (ms(step.doneAt) <= ms(step.dueAt)) acc.onTime += 1;
        }
      }
    }
  }
  return finish(rows);
}

export function assignmentReport(input: ReportInput, dimension: ReportDimension): ReportRow[] {
  return dimension === 'template' ? byTemplate(input) : bySteps(input, dimension);
}

/** Totals over every assignment in the period (the head of the report). */
export function assignmentTotals(input: ReportInput): ReportRow {
  const rows = byTemplate(input);
  const all = rows.reduce(
    (t, r) => ({
      open: t.open + r.open,
      late: t.late + r.late,
      blocked: t.blocked + r.blocked,
      done: t.done + r.done,
    }),
    { open: 0, late: 0, blocked: 0, done: 0 }
  );
  const done = live(input.cards).map((c) => ({ card: c, at: cardFinishedAt(c) })).filter((x) => x.at && within(x.at, input.period));
  const cycles = done.map((x) => (ms(x.at) - ms(x.card.createdAt)) / 60_000).filter(Number.isFinite);
  const dated = done.filter((x) => Number.isFinite(ms(x.card.dueAt || x.card.airAt)));
  return {
    key: 'all',
    label: 'كل التكليفات',
    ...all,
    avgCycleMinutes: cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null,
    onTimeRate: dated.length ? dated.filter((x) => ms(x.at) <= ms(x.card.dueAt || x.card.airAt)).length / dated.length : null,
  };
}

/** Where steps wait longest before someone starts them, by kind of step (longest first). */
export function waitingByStepType(input: ReportInput): WaitRow[] {
  const rows = new Map<string, { waits: number[]; waitingNow: number; longest: number }>();
  for (const card of live(input.cards)) {
    for (const step of card.steps || []) {
      if (step.status === 'SKIPPED') continue;
      const acc = rows.get(step.type) || { waits: [], waitingNow: 0, longest: 0 };
      const available = ms(stepAvailableAt(card, step));
      if (step.startedAt && within(step.startedAt, input.period) && Number.isFinite(available)) {
        acc.waits.push(Math.max(0, (ms(step.startedAt) - available) / 60_000));
      } else if (card.status === 'OPEN' && step.status === 'TODO' && Number.isFinite(available)) {
        const wait = Math.max(0, (input.now - available) / 60_000);
        acc.waitingNow += 1;
        acc.longest = Math.max(acc.longest, Math.round(wait));
      }
      rows.set(step.type, acc);
    }
  }
  return [...rows.entries()]
    .map(([type, a]) => ({
      type,
      label: stepTypeName(input.stepTypes, type),
      avgWaitMinutes: a.waits.length ? Math.round(a.waits.reduce((x, y) => x + y, 0) / a.waits.length) : null,
      waitingNow: a.waitingNow,
      longestWaitMinutes: a.longest,
    }))
    .filter((r) => r.avgWaitMinutes !== null || r.waitingNow > 0)
    .sort((a, b) => Math.max(b.avgWaitMinutes ?? 0, b.longestWaitMinutes) - Math.max(a.avgWaitMinutes ?? 0, a.longestWaitMinutes));
}

const pct = (rate: number | null) => (rate === null ? '' : `${Math.round(rate * 100)}%`);

/** Rows for a spreadsheet: one header row then one row per group (numbers stay numbers). */
export function reportCsvRows(rows: ReportRow[], dimension: ReportDimension): (string | number)[][] {
  const head = REPORT_DIMENSIONS.find((d) => d.id === dimension)?.name.replace('حسب ', '') || 'المجموعة';
  return [
    [head, 'مفتوحة', 'متأخرة', 'متعطلة', 'أُنجزت في الفترة', 'متوسط مدة الإنجاز (دقيقة)', 'نسبة الالتزام بالموعد'],
    ...rows.map((r) => [r.label, r.open, r.late, r.blocked, r.done, r.avgCycleMinutes ?? '', pct(r.onTimeRate)]),
  ];
}
