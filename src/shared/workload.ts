/**
 * Workload and output measured from the work the platform already records, so "we need more
 * staff" can be answered with numbers: who carries what now, what each person and station
 * finished in a period, and how the load compares between stations.
 *
 * Every piece of work becomes one WorkItem, whatever screen it came from: a production-card step,
 * an editorial task, a request handled for another department, a news story written, or a story
 * reviewed (approved, sent back or rejected by someone other than its writer).
 * Weight = how heavy that kind of work is × how complex this one is.
 */
import { cardContributions, cardState, isStepOpen, stepPoints, stepTypeName, type ProductionCard, type StepType } from './productionCards';
import type { Station } from './stations';

export type WorkSource = 'CARD_STEP' | 'TASK' | 'REQUEST' | 'NEWS' | 'REVIEW';

export const WORK_SOURCE_NAMES: Record<WorkSource, string> = {
  CARD_STEP: 'مهمة في بطاقة إنتاج',
  TASK: 'مهمة تحريرية',
  REQUEST: 'طلب قسم',
  NEWS: 'خبر',
  REVIEW: 'مراجعة خبر',
};

/** Weights of work recorded outside production cards (card steps use the configured step types). */
export const SOURCE_WEIGHTS: Record<Exclude<WorkSource, 'CARD_STEP'>, number> = { TASK: 2, REQUEST: 2, NEWS: 2, REVIEW: 1 };

/** Review decisions that end a review round and are credited to the reviewer. */
const REVIEW_OUTCOMES = new Set(['APPROVED', 'NEEDS_REVISION', 'REJECTED', 'PUBLISHED', 'SCHEDULED']);

export interface WorkItem {
  key: string;
  source: WorkSource;
  userId?: string;
  stationId?: string;
  title: string;
  /** e.g. «المونتاج», «مهمة تحريرية». */
  typeName: string;
  points: number;
  estimateMinutes?: number;
  spentMinutes?: number;
  open: boolean;
  blocked: boolean;
  overdue: boolean;
  dueAt?: string;
  startedAt?: string;
  doneAt?: string;
  /** Screen and record to open. */
  ref: { nav: 'cards' | 'tasks' | 'requests' | 'news-editor'; id: string };
}

interface UserLike {
  id: string;
  fullName: string;
  stationId?: string;
  isActive?: boolean;
  deletedAt?: string | null;
  jobTitle?: string;
}

export interface WorkInputs {
  cards: ProductionCard[];
  tasks: any[];
  requests: any[];
  news: any[];
  users: UserLike[];
  stepTypes: StepType[];
  now?: number;
}

const past = (iso: string | undefined, now: number) => !!iso && new Date(iso.length === 10 ? `${iso}T23:59:59` : iso).getTime() < now;

/** Every recorded piece of work as one list. */
export function collectWork(input: WorkInputs): WorkItem[] {
  const now = input.now ?? Date.now();
  const stationOf = new Map(input.users.map((u) => [u.id, u.stationId]));
  const items: WorkItem[] = [];
  const cardNews = new Set<string>();

  for (const card of input.cards) {
    if (card.deletedAt || card.status === 'CANCELLED') continue;
    if (card.target?.kind === 'news') cardNews.add(card.target.id);
    for (const step of card.steps || []) {
      if (step.status === 'SKIPPED') continue;
      const open = isStepOpen(step) && card.status === 'OPEN';
      // A closed card with an unfinished step is no longer anyone's load, and was not produced either.
      if (!open && step.status !== 'DONE') continue;
      items.push({
        key: `card:${card.id}:${step.id}`,
        source: 'CARD_STEP',
        userId: step.status === 'DONE' ? step.doneById || step.assigneeId : step.assigneeId,
        stationId: step.stationId || (step.assigneeId ? stationOf.get(step.assigneeId) : undefined),
        title: step.title ? `${card.title} — ${step.title}` : card.title,
        typeName: stepTypeName(input.stepTypes, step.type),
        points: stepPoints(step, input.stepTypes),
        estimateMinutes: step.estimateMinutes,
        spentMinutes: step.spentMinutes,
        open,
        blocked: open && step.status === 'BLOCKED',
        overdue: open && past(step.dueAt, now),
        dueAt: step.dueAt,
        startedAt: step.startedAt,
        doneAt: step.doneAt,
        ref: { nav: 'cards', id: card.id },
      });
    }
  }

  for (const task of input.tasks) {
    if (task.deletedAt || task.status === 'CANCELLED') continue;
    const userId = task.assigneeId || task.assignedToId;
    if (!userId) continue;
    const done = task.status === 'DONE' || task.status === 'COMPLETED';
    items.push({
      key: `task:${task.id}`,
      source: 'TASK',
      userId,
      stationId: stationOf.get(userId),
      title: task.title,
      typeName: WORK_SOURCE_NAMES.TASK,
      points: SOURCE_WEIGHTS.TASK,
      open: !done,
      blocked: task.status === 'BLOCKED',
      overdue: !done && past(task.dueDate, now),
      dueAt: task.dueDate,
      startedAt: task.createdAt,
      doneAt: done ? task.completedAt : undefined,
      ref: { nav: 'tasks', id: task.id },
    });
  }

  for (const req of input.requests) {
    if (req.deletedAt || req.status === 'CANCELLED' || req.status === 'REJECTED') continue;
    const userId = req.assigneeId || req.addressedToId;
    if (!userId) continue;
    const done = req.status === 'DONE';
    const history: any[] = req.history || [];
    items.push({
      key: `request:${req.id}`,
      source: 'REQUEST',
      userId,
      stationId: stationOf.get(userId),
      title: req.title,
      typeName: WORK_SOURCE_NAMES.REQUEST,
      points: SOURCE_WEIGHTS.REQUEST * (req.priority === 'URGENT' ? 2 : 1),
      open: !done,
      blocked: false,
      overdue: !done && past(req.dueAt, now),
      dueAt: req.dueAt,
      startedAt: history.find((h) => h.status === 'ACCEPTED')?.at || req.createdAt,
      doneAt: done ? [...history].reverse().find((h) => h.status === 'DONE')?.at || req.updatedAt : undefined,
      ref: { nav: 'requests', id: req.id },
    });
  }

  for (const story of input.news) {
    if (story.deletedAt) continue;
    // Quality and editorial review: each decision on a story in review is the reviewer's work.
    for (const log of story.workflowLogs || []) {
      const by = log?.changedBy?.id;
      if (!by || by === story.authorId || log.fromStatus !== 'UNDER_REVIEW' || !REVIEW_OUTCOMES.has(log.toStatus)) continue;
      items.push({
        key: `review:${story.id}:${log.id || log.timestamp}`,
        source: 'REVIEW',
        userId: by,
        stationId: stationOf.get(by),
        title: story.title,
        typeName: WORK_SOURCE_NAMES.REVIEW,
        points: SOURCE_WEIGHTS.REVIEW,
        open: false,
        blocked: false,
        overdue: false,
        doneAt: log.timestamp,
        ref: { nav: 'news-editor', id: story.id },
      });
    }
    // A story produced through a card is already counted by the card's steps.
    if (!story.authorId || cardNews.has(story.id) || story.status === 'REJECTED') continue;
    const done = ['APPROVED', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED', 'UNPUBLISHED'].includes(story.status);
    items.push({
      key: `news:${story.id}`,
      source: 'NEWS',
      userId: story.authorId,
      stationId: stationOf.get(story.authorId),
      title: story.title,
      typeName: WORK_SOURCE_NAMES.NEWS,
      points: SOURCE_WEIGHTS.NEWS,
      // In review the story waits on the editor, not on its writer.
      open: ['DRAFT', 'IN_PROGRESS', 'NEEDS_REVISION'].includes(story.status),
      blocked: false,
      overdue: false,
      startedAt: story.createdAt,
      doneAt: done ? story.approvedAt || story.publishDate || story.updatedAt : undefined,
      ref: { nav: 'news-editor', id: story.id },
    });
  }
  return items;
}

export interface Period {
  /** Inclusive start and exclusive end, as timestamps. */
  from: number;
  to: number;
}

export const inPeriod = (iso: string | undefined, period: Period) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= period.from && t < period.to;
};

export interface LoadRow {
  id: string;
  name: string;
  /** People counted (1 for a person row). */
  people: number;
  open: number;
  openPoints: number;
  openMinutes: number;
  overdue: number;
  blocked: number;
  done: number;
  donePoints: number;
  spentMinutes: number;
}

const emptyRow = (id: string, name: string, people = 1): LoadRow => ({ id, name, people, open: 0, openPoints: 0, openMinutes: 0, overdue: 0, blocked: 0, done: 0, donePoints: 0, spentMinutes: 0 });

function addTo(row: LoadRow, item: WorkItem, period: Period) {
  if (item.open) {
    row.open += 1;
    row.openPoints += item.points;
    row.openMinutes += item.estimateMinutes || 0;
    if (item.overdue) row.overdue += 1;
    if (item.blocked) row.blocked += 1;
  } else if (inPeriod(item.doneAt, period)) {
    row.done += 1;
    row.donePoints += item.points;
    row.spentMinutes += item.spentMinutes || 0;
  }
}

/** Current load and period output for each active person (people with no work are listed too). */
export function loadByPerson(items: WorkItem[], users: UserLike[], period: Period): (LoadRow & { stationId?: string; jobTitle?: string })[] {
  const rows = new Map<string, LoadRow & { stationId?: string; jobTitle?: string }>();
  for (const user of users) {
    if (user.isActive === false || user.deletedAt) continue;
    rows.set(user.id, { ...emptyRow(user.id, user.fullName), stationId: user.stationId, jobTitle: user.jobTitle });
  }
  for (const item of items) {
    const row = item.userId ? rows.get(item.userId) : undefined;
    if (row) addTo(row, item, period);
  }
  return [...rows.values()];
}

export type LoadLevel = 'HIGH' | 'NORMAL' | 'LOW';

/** A station's open load per person above this many times the average is «حمل مرتفع». */
export const HIGH_LOAD_FACTOR = 1.5;
/** Below this fraction of the average is «طاقة متاحة». */
export const LOW_LOAD_FACTOR = 0.5;
/** The rule in words, shown beside the rating. */
export const LOAD_LEVEL_RULE = 'التقييم يقارن «الحمل للفرد» بمتوسط المحطات: «حمل مرتفع» إذا زاد على 1.5 ضعف المتوسط، و«طاقة متاحة» إذا قلّ عن نصفه، و«متوازن» بينهما.';

export interface StationLoad extends LoadRow {
  /** Open weighted work per person. */
  perPerson: number;
  /** Compared with the average of all stations; null where there is nothing to compare (no staff, or no station). */
  level: LoadLevel | null;
  /** Open steps addressed to the station that nobody has picked up. */
  unassigned: number;
}

/**
 * The same figures per station, with the open load per person compared across stations:
 * HIGH is more than half above the average, LOW less than half of it.
 */
export function loadByStation(items: WorkItem[], users: UserLike[], stations: Station[], period: Period): StationLoad[] {
  const rows = new Map<string, StationLoad>();
  const row = (id: string) => {
    if (!rows.has(id)) rows.set(id, { ...emptyRow(id, stations.find((s) => s.id === id)?.name || 'بدون محطة', 0), perPerson: 0, level: null, unassigned: 0 });
    return rows.get(id)!;
  };
  stations.forEach((s) => row(s.id));
  for (const user of users) {
    if (user.isActive === false || user.deletedAt) continue;
    row(stations.some((s) => s.id === user.stationId) ? user.stationId! : '').people += 1;
  }
  for (const item of items) {
    const target = row(stations.some((s) => s.id === item.stationId) ? item.stationId! : '');
    addTo(target, item, period);
    if (item.open && !item.userId) target.unassigned += 1;
  }
  const list = [...rows.values()].filter((r) => r.id !== '' || r.people > 0 || r.open > 0 || r.done > 0);
  // People without a station are central management: listed, but not compared with stations.
  const staffed = list.filter((r) => r.people > 0 && r.id !== '');
  staffed.forEach((r) => (r.perPerson = r.openPoints / r.people));
  const average = staffed.length ? staffed.reduce((sum, r) => sum + r.perPerson, 0) / staffed.length : 0;
  for (const r of staffed) r.level = average > 0 && r.perPerson > average * HIGH_LOAD_FACTOR ? 'HIGH' : average > 0 && r.perPerson < average * LOW_LOAD_FACTOR ? 'LOW' : 'NORMAL';
  return list;
}

const DAY_MS = 86400_000;

/** The period of the same length just before this one, for comparison. */
export const previousPeriod = (period: Period): Period => ({ from: period.from - (period.to - period.from), to: period.from });

export interface TrendDay {
  /** YYYY-MM-DD (in the zone `dayOf` uses). */
  date: string;
  done: number;
  donePoints: number;
}

/**
 * Finished work day by day across the period, every day listed (zeros included) so a
 * quiet day shows as a gap rather than disappearing.
 */
export function dailyTrend(items: WorkItem[], period: Period, dayOf: (iso: string) => string = (iso) => iso.slice(0, 10)): TrendDay[] {
  const days = new Map<string, TrendDay>();
  // Noon of each day names it, so a daylight-saving shift never skips or repeats a date.
  for (let t = period.from; t < period.to; t += DAY_MS) {
    const date = dayOf(new Date(Math.min(t + DAY_MS / 2, period.to - 1)).toISOString());
    if (!days.has(date)) days.set(date, { date, done: 0, donePoints: 0 });
  }
  for (const item of items) {
    if (item.open || !inPeriod(item.doneAt, period)) continue;
    const date = dayOf(item.doneAt!);
    const day = days.get(date) || { date, done: 0, donePoints: 0 };
    day.done += 1;
    day.donePoints += item.points;
    days.set(date, day);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface PeriodComparison {
  done: number;
  donePoints: number;
  previousDone: number;
  previousPoints: number;
  /** Change in finished points against the previous period, in percent; null when there was nothing before. */
  change: number | null;
}

/** Finished work in the period against the same length of time just before it. */
export function comparePeriods(items: WorkItem[], period: Period): PeriodComparison {
  const before = previousPeriod(period);
  let done = 0, donePoints = 0, previousDone = 0, previousPoints = 0;
  for (const item of items) {
    if (item.open) continue;
    if (inPeriod(item.doneAt, period)) {
      done += 1;
      donePoints += item.points;
    } else if (inPeriod(item.doneAt, before)) {
      previousDone += 1;
      previousPoints += item.points;
    }
  }
  return { done, donePoints, previousDone, previousPoints, change: previousPoints ? Math.round(((donePoints - previousPoints) / previousPoints) * 100) : null };
}

export interface ProductionSummary {
  /** Finished cards in the period, each counted once however many stations worked on it. */
  total: number;
  /** Of those, cards more than one station worked on. */
  shared: number;
  byKind: { kind: string; count: number }[];
  byStation: { stationId: string; cards: number; shared: number; steps: number; points: number; share: number }[];
}

/** A card is produced when all its steps are done (or it was closed); the date is its last finished step. */
export function producedAt(card: ProductionCard): string | undefined {
  const state = cardState(card);
  if (state !== 'READY' && state !== 'CLOSED') return undefined;
  const dates = (card.steps || []).map((s) => s.doneAt).filter(Boolean) as string[];
  return dates.sort().pop() || card.closedAt || card.updatedAt;
}

export function productionSummary(cards: ProductionCard[], stepTypes: StepType[], period: Period): ProductionSummary {
  const produced = cards.filter((c) => !c.deletedAt && inPeriod(producedAt(c), period));
  const kinds = new Map<string, number>();
  const stations = new Map<string, { stationId: string; cards: number; shared: number; steps: number; points: number; share: number }>();
  let shared = 0;
  let allPoints = 0;
  for (const card of produced) {
    kinds.set(card.kind, (kinds.get(card.kind) || 0) + 1);
    const parts = cardContributions(card, stepTypes).filter((p) => p.done > 0);
    const isShared = parts.filter((p) => p.stationId).length > 1;
    if (isShared) shared += 1;
    for (const part of parts) {
      const row = stations.get(part.stationId) || { stationId: part.stationId, cards: 0, shared: 0, steps: 0, points: 0, share: 0 };
      row.cards += 1;
      if (isShared) row.shared += 1;
      row.steps += part.done;
      row.points += part.points;
      allPoints += part.points;
      stations.set(part.stationId, row);
    }
  }
  const byStation = [...stations.values()].map((r) => ({ ...r, share: allPoints ? Math.round((r.points / allPoints) * 100) : 0 })).sort((a, b) => b.points - a.points);
  return { total: produced.length, shared, byKind: [...kinds.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count), byStation };
}

export interface EmployeeFile {
  userId: string;
  totals: LoadRow;
  /** Finished in the period, newest first. */
  done: WorkItem[];
  /** Still on the person's desk. */
  open: WorkItem[];
  byType: { typeName: string; count: number; points: number }[];
  /** Days with finished or started work (YYYY-MM-DD in the given time zone), with counts. */
  days: { date: string; done: number; started: number }[];
}

/** What one colleague did in a period: when they worked, how many items, and which. */
export function employeeFile(items: WorkItem[], user: UserLike, period: Period, dayOf: (iso: string) => string = (iso) => iso.slice(0, 10)): EmployeeFile {
  const own = items.filter((i) => i.userId === user.id);
  const totals = emptyRow(user.id, user.fullName);
  own.forEach((i) => addTo(totals, i, period));
  const done = own.filter((i) => !i.open && inPeriod(i.doneAt, period)).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  const open = own.filter((i) => i.open).sort((a, b) => (a.dueAt || '9').localeCompare(b.dueAt || '9'));
  const types = new Map<string, { typeName: string; count: number; points: number }>();
  for (const item of done) {
    const row = types.get(item.typeName) || { typeName: item.typeName, count: 0, points: 0 };
    row.count += 1;
    row.points += item.points;
    types.set(item.typeName, row);
  }
  const days = new Map<string, { date: string; done: number; started: number }>();
  const day = (iso: string) => {
    const date = dayOf(iso);
    if (!days.has(date)) days.set(date, { date, done: 0, started: 0 });
    return days.get(date)!;
  };
  for (const item of own) {
    if (inPeriod(item.doneAt, period)) day(item.doneAt!).done += 1;
    if (inPeriod(item.startedAt, period)) day(item.startedAt!).started += 1;
  }
  return { userId: user.id, totals, done, open, byType: [...types.values()].sort((a, b) => b.points - a.points), days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)) };
}

export const minutesLabel = (minutes: number) => {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h} س ${m} د` : `${h} س`) : `${m} د`;
};
