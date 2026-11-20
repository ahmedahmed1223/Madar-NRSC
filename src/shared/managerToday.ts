/**
 * «حالة اليوم» for managers: the figures that answer "are we on track tonight?" in a glance.
 * Production cards needing this manager's decision, late and blocked cards in the stations the
 * manager follows, and a strip per station. Pure functions so the dashboard and tests agree.
 */
import { isCardLate, isStepLate, isStepOpen, type CardStep, type ProductionCard } from './productionCards';
import { stationScope, type Station } from './stations';

/** Roles that follow others' work and get «حالة اليوم» at the top of their home screen. */
export const MANAGER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'GENERAL_MANAGER', 'MAIN_STATION_MANAGER', 'STATION_MANAGER'] as const;
export const isManagerRole = (role?: string | null) => !!role && (MANAGER_ROLES as readonly string[]).includes(role);

const required = (card: ProductionCard) => (card.steps || []).filter((s) => s.status !== 'SKIPPED');
export const isCardBlocked = (card: ProductionCard) => card.status === 'OPEN' && required(card).some((s) => s.status === 'BLOCKED');

/**
 * Stations a manager follows: everyone for central management (no station), the main station
 * and administrators; a branch manager follows their own station and those linked with it.
 */
export function managerScope(user: { role?: string; stationId?: string | null; managedStationIds?: string[]; managedGroupIds?: string[] }, stations: Station[], seesAll = false): Set<string> {
  if (seesAll || user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'MAIN_STATION_MANAGER') return new Set(stations.map((s) => s.id));
  // The shared scope rule (own station, links, managed stations and station groups).
  const scope = new Set(stationScope(stations, { stationId: user.stationId, managedStationIds: user.managedStationIds, managedGroupIds: user.managedGroupIds }));
  // A manager of several stations (e.g. a general manager) follows each of them too.
  for (const id of Array.isArray(user.managedStationIds) ? user.managedStationIds : []) if (stations.some((s) => s.id === id)) scope.add(id);
  return scope;
}

export interface StationGroup {
  id: string;
  name: string;
  stationIds: string[];
}

/** Station groups from the settings, when the deployment defines any (read defensively). */
export function stationGroupsOf(settings: unknown): StationGroup[] {
  const raw = (settings as { stationGroups?: unknown } | null | undefined)?.stationGroups;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((g): g is StationGroup => !!g && typeof g.id === 'string' && typeof g.name === 'string' && Array.isArray(g.stationIds))
    .map((g) => ({ id: g.id, name: g.name, stationIds: g.stationIds.filter((x: unknown) => typeof x === 'string') }));
}

/**
 * A station filter value: 'ALL', a station id, or 'group:<id>' for a station group.
 * Returns whether a station id passes it.
 */
export function stationFilterMatcher(value: string, groups: StationGroup[]): (stationId?: string | null) => boolean {
  if (value === 'ALL') return () => true;
  if (value.startsWith('group:')) {
    const ids = new Set(groups.find((g) => g.id === value.slice(6))?.stationIds || []);
    return (id) => !!id && ids.has(id);
  }
  return (id) => id === value;
}

/** Stations a card touches: its steps' stations and its owner's station. */
export function cardStations(card: ProductionCard): Set<string> {
  const ids = new Set<string>();
  for (const step of card.steps || []) if (step.stationId) ids.add(step.stationId);
  if (card.ownerStationId) ids.add(card.ownerStationId);
  return ids;
}

/** A card is in scope when it touches a followed station (cards with no station belong to everyone). */
export function cardInScope(card: ProductionCard, scope: Set<string>): boolean {
  const ids = cardStations(card);
  if (!ids.size) return true;
  for (const id of ids) if (scope.has(id)) return true;
  return false;
}

export interface CardIssue {
  card: ProductionCard;
  blocked: boolean;
  late: boolean;
  /** The step that holds the card: the blocked one, else the late one, else the current one. */
  step?: CardStep;
  /** Where the hold is (the step's station, else the owner's). */
  stationId?: string;
}

export function cardIssue(card: ProductionCard, now = Date.now()): CardIssue | null {
  if (card.deletedAt || card.status !== 'OPEN') return null;
  const blocked = isCardBlocked(card);
  const late = isCardLate(card, now);
  if (!blocked && !late) return null;
  const steps = required(card);
  const step = steps.find((s) => s.status === 'BLOCKED') || steps.find((s) => isStepLate(s, now)) || steps.find(isStepOpen);
  return { card, blocked, late, step, stationId: step?.stationId || card.ownerStationId };
}

/** Cards I own (I decide when they stall) that are blocked or late, blocked first then earliest due. */
export function cardsAwaitingMyDecision(cards: ProductionCard[], userId: string, now = Date.now()): CardIssue[] {
  return cards
    .filter((c) => c.ownerId === userId)
    .map((c) => cardIssue(c, now))
    .filter((x): x is CardIssue => !!x)
    .sort(issueOrder);
}

const issueOrder = (a: CardIssue, b: CardIssue) =>
  Number(b.blocked) - Number(a.blocked) || Number(b.card.priority === 'URGENT') - Number(a.card.priority === 'URGENT') || (a.card.airAt || a.card.dueAt || '9').localeCompare(b.card.airAt || b.card.dueAt || '9');

/** Late and blocked cards in the stations I follow. */
export function issuesInScope(cards: ProductionCard[], scope: Set<string>, now = Date.now()): CardIssue[] {
  return cards
    .filter((c) => cardInScope(c, scope))
    .map((c) => cardIssue(c, now))
    .filter((x): x is CardIssue => !!x)
    .sort(issueOrder);
}

export interface StationDayRow {
  stationId: string;
  /** Open cards with work at this station. */
  open: number;
  late: number;
  blocked: number;
  /** Card steps this station finished today. */
  doneToday: number;
}

/**
 * One row per followed station. A card counts at a station when the station has an open step on
 * it (or, when no open step names a station, at its owner's station); late and blocked follow the station of the step
 * that holds the card.
 */
export function stationDayStrip(cards: ProductionCard[], stations: Station[], scope: Set<string>, dayStart: number, now = Date.now()): StationDayRow[] {
  const rows = new Map<string, StationDayRow>(stations.filter((s) => scope.has(s.id)).map((s) => [s.id, { stationId: s.id, open: 0, late: 0, blocked: 0, doneToday: 0 }]));
  for (const card of cards) {
    if (card.deletedAt || card.status === 'CANCELLED') continue;
    const steps = required(card);
    for (const step of steps) {
      const row = step.stationId ? rows.get(step.stationId) : undefined;
      if (row && step.status === 'DONE' && step.doneAt) {
        const t = new Date(step.doneAt).getTime();
        if (t >= dayStart && t <= now) row.doneToday += 1;
      }
    }
    if (card.status !== 'OPEN') continue;
    const openAt = new Set(steps.filter((s) => isStepOpen(s) && s.stationId).map((s) => s.stationId!));
    if (!openAt.size && card.ownerStationId) openAt.add(card.ownerStationId);
    for (const id of openAt) {
      const row = rows.get(id);
      if (row) row.open += 1;
    }
    const issue = cardIssue(card, now);
    const at = issue?.stationId ? rows.get(issue.stationId) : undefined;
    if (issue && at) {
      if (issue.blocked) at.blocked += 1;
      if (issue.late) at.late += 1;
    }
  }
  return [...rows.values()];
}

/**
 * Stories waiting in review that this person can actually act on: someone else's, and for a
 * branch manager only those written by colleagues in the stations they follow.
 */
export function reviewableNews<T extends { status: string; authorId?: string; deletedAt?: string | null }>(
  news: T[],
  me: { id: string; role?: string; stationId?: string | null },
  ctx: { canReview: boolean; stations: Station[]; stationOf: (userId: string) => string | undefined }
): T[] {
  if (!ctx.canReview) return [];
  const scoped = me.role === 'STATION_MANAGER' || me.role === 'GENERAL_MANAGER';
  const scope = scoped ? managerScope(me, ctx.stations) : null;
  return news.filter((n) => {
    if (n.deletedAt || n.status !== 'UNDER_REVIEW' || !n.authorId || n.authorId === me.id) return false;
    if (!scope) return true;
    const station = ctx.stationOf(n.authorId);
    return !!station && scope.has(station);
  });
}
