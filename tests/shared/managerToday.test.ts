import { describe, expect, it } from 'vitest';
import type { CardStep, ProductionCard } from '../../src/shared/productionCards';
import { cardInScope, cardsAwaitingMyDecision, isManagerRole, issuesInScope, managerScope, reviewableNews, stationDayStrip, stationFilterMatcher, stationGroupsOf } from '../../src/shared/managerToday';
import type { Station } from '../../src/shared/stations';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const DAY = Date.parse('2026-11-19T00:00:00Z');
const stations: Station[] = [{ id: 'istanbul', name: 'إسطنبول', isMain: true }, { id: 'gaza', name: 'غزة', linkedIds: [] }, { id: 'beirut', name: 'بيروت', linkedIds: [] }];
const step = (id: string, extra: Partial<CardStep> = {}): CardStep => ({ id, type: 'edit', status: 'TODO', complexity: 1, ...extra });
const card = (id: string, extra: Partial<ProductionCard>): ProductionCard => ({ id, title: id, kind: 'NEWS', priority: 'NORMAL', status: 'OPEN', steps: [], ...extra });

// Blocked in Gaza and owned by the Gaza manager; late in Beirut; fine in Istanbul; closed today in Gaza.
const blocked = card('blocked', { ownerId: 'gm', ownerStationId: 'gaza', steps: [step('a', { stationId: 'gaza', status: 'DONE', doneAt: '2026-11-19T08:00:00Z' }), step('b', { stationId: 'gaza', status: 'BLOCKED', dueAt: '2026-11-19T11:00:00Z' })] });
const late = card('late', { ownerId: 'bm', ownerStationId: 'beirut', steps: [step('a', { stationId: 'beirut', dueAt: '2026-11-19T10:00:00Z' })] });
const fine = card('fine', { ownerId: 'gm', ownerStationId: 'istanbul', steps: [step('a', { stationId: 'istanbul', dueAt: '2026-11-19T20:00:00Z' })] });
const closed = card('closed', { status: 'CLOSED', steps: [step('a', { stationId: 'gaza', status: 'DONE', doneAt: '2026-11-19T09:00:00Z' })] });
const cards = [blocked, late, fine, closed];

describe('manager «حالة اليوم»', () => {
  it('knows which roles are managers', () => {
    expect(isManagerRole('STATION_MANAGER')).toBe(true);
    expect(isManagerRole('ADMIN')).toBe(true);
    expect(isManagerRole('EDITOR')).toBe(false);
  });

  it('follows every station from the main station and its own scope from a branch', () => {
    expect([...managerScope({ role: 'MAIN_STATION_MANAGER', stationId: 'istanbul' }, stations)].sort()).toEqual(['beirut', 'gaza', 'istanbul']);
    expect([...managerScope({ role: 'STATION_MANAGER', stationId: 'gaza' }, stations)].sort()).toEqual(['gaza', 'istanbul']);
    expect(cardInScope(late, managerScope({ role: 'STATION_MANAGER', stationId: 'gaza' }, stations))).toBe(false);
  });

  it('lists the cards that wait on my decision: mine and blocked or late', () => {
    expect(cardsAwaitingMyDecision(cards, 'gm', NOW).map((i) => i.card.id)).toEqual(['blocked']);
    const issue = cardsAwaitingMyDecision(cards, 'gm', NOW)[0];
    expect(issue.blocked).toBe(true);
    // Blocked and past due at once: both are reported.
    expect(issue.late).toBe(true);
    expect(issue.stationId).toBe('gaza');
  });

  it('lists late and blocked cards in scope, blocked first', () => {
    const all = managerScope({ role: 'ADMIN' }, stations);
    expect(issuesInScope(cards, all, NOW).map((i) => i.card.id)).toEqual(['blocked', 'late']);
    expect(issuesInScope(cards, managerScope({ role: 'STATION_MANAGER', stationId: 'gaza' }, stations), NOW).map((i) => i.card.id)).toEqual(['blocked']);
  });

  it('sums open, late, blocked and finished-today per station', () => {
    const strip = stationDayStrip(cards, stations, managerScope({ role: 'ADMIN' }, stations), DAY, NOW);
    const by = Object.fromEntries(strip.map((r) => [r.stationId, r]));
    expect(by.gaza).toMatchObject({ open: 1, blocked: 1, late: 1, doneToday: 2 });
    expect(by.beirut).toMatchObject({ open: 1, blocked: 0, late: 1, doneToday: 0 });
    expect(by.istanbul).toMatchObject({ open: 1, blocked: 0, late: 0 });
  });
});

describe('stories waiting for my review', () => {
  const news = [
    { id: 'a', status: 'UNDER_REVIEW', authorId: 'gaza-writer' },
    { id: 'b', status: 'UNDER_REVIEW', authorId: 'beirut-writer' },
    { id: 'c', status: 'UNDER_REVIEW', authorId: 'me' },
    { id: 'd', status: 'DRAFT', authorId: 'gaza-writer' },
  ];
  const stationOf = (id: string) => ({ 'gaza-writer': 'gaza', 'beirut-writer': 'beirut' } as Record<string, string>)[id];
  it('counts nothing for someone who cannot review', () => {
    expect(reviewableNews(news, { id: 'me', role: 'ADMIN' }, { canReview: false, stations, stationOf })).toEqual([]);
  });
  it('counts others\' stories in review, limited to a branch manager\'s scope', () => {
    expect(reviewableNews(news, { id: 'me', role: 'ADMIN' }, { canReview: true, stations, stationOf }).map((n) => n.id)).toEqual(['a', 'b']);
    expect(reviewableNews(news, { id: 'me', role: 'STATION_MANAGER', stationId: 'gaza' }, { canReview: true, stations, stationOf }).map((n) => n.id)).toEqual(['a']);
  });
});

describe('station filters and groups', () => {
  it('reads station groups defensively and filters by station or group', () => {
    expect(stationGroupsOf(null)).toEqual([]);
    expect(stationGroupsOf({ stationGroups: [{ id: 'lev', name: 'المشرق', stationIds: ['gaza', 'beirut'] }, { bad: true }] })).toHaveLength(1);
    const groups = stationGroupsOf({ stationGroups: [{ id: 'lev', name: 'المشرق', stationIds: ['gaza', 'beirut'] }] });
    expect(stationFilterMatcher('group:lev', groups)('beirut')).toBe(true);
    expect(stationFilterMatcher('group:lev', groups)('istanbul')).toBe(false);
    expect(stationFilterMatcher('gaza', groups)('gaza')).toBe(true);
    expect(stationFilterMatcher('ALL', groups)(undefined)).toBe(true);
  });
  it('adds the stations a general manager manages to their scope', () => {
    expect([...managerScope({ role: 'GENERAL_MANAGER', stationId: 'gaza', managedStationIds: ['beirut'] }, stations)].sort()).toEqual(['beirut', 'gaza', 'istanbul']);
    expect(isManagerRole('GENERAL_MANAGER')).toBe(true);
  });
});
