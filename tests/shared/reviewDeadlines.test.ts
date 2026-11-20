import { expect, it } from 'vitest';
import { stationWallTime } from '../../src/shared/stationWallTime';
import { selectReviewDeadlines, reviewDeadlineLabel, reviewBroadcastVisibility } from '../../src/shared/reviewDeadlines';
import type { NewsItem, Episode } from '../../src/types';
import type { Bulletin, BulletinStory } from '../../src/shared/bulletins';

const news = (id: string, extra: Partial<NewsItem> = {}) => ({ id, status: 'UNDER_REVIEW', priority: 'NORMAL', updatedAt: '2026-10-10T10:00:00Z', ...extra } as NewsItem);
const bulletin = (id: string, startTime = '15:00', extra: Partial<Bulletin> = {}) => ({ id, title: id, date: '2026-10-11', startTime, status: 'PLANNING', ...extra } as Bulletin);
const story = (id: string, newsId: string, bulletinId: string, extra: Partial<BulletinStory> = {}) => ({ id, newsId, bulletinId, ...extra } as BulletinStory);
const episode = (extra: Partial<Episode> = {}) => ({ id: 'episode', title: 'Episode', broadcastDate: '2026-10-11', startTime: '13:00', status: 'READY', linkedNewsIds: ['a'], ...extra } as Episode);
const now = Date.parse('2026-10-11T11:00:00Z');
const select = (n = [news('a')], b: Bulletin[] = [], s: BulletinStory[] = [], e: Episode[] = []) => selectReviewDeadlines(n, b, s, e, 'Asia/Riyadh', now);

it('resolves station midnight without device timezone and rejects invalid dates/zones', () => {
  expect(stationWallTime('2026-10-11', '00:30', 'Asia/Riyadh (GMT+3)')).toBe(Date.parse('2026-10-10T21:30:00Z'));
  for (const [date, time, zone] of [['2026-02-30', '12:00', 'UTC'], ['2026-10-11', '24:00', 'UTC'], ['2026-10-11', '12:00', 'Invalid/Zone'], ['2026-10-11junk', '12:00', 'UTC']]) expect(stationWallTime(date, time, zone)).toBeNull();
});
it('rejects both nonexistent and ambiguous DST wall times including half-hour transitions', () => {
  expect(stationWallTime('2026-03-08', '02:30', 'America/New_York')).toBeNull();
  expect(stationWallTime('2026-11-01', '01:30', 'America/New_York')).toBeNull();
  expect(stationWallTime('2026-04-05', '01:45', 'Australia/Lord_Howe')).toBeNull();
  expect(stationWallTime('2026-03-08', '03:30', 'America/New_York')).toBe(Date.parse('2026-03-08T07:30:00Z'));
});
it('chooses the earliest authorized broadcast and deduplicates all episode links', () => {
  const row = select(undefined, [bulletin('late')], [story('s', 'a', 'late')], [episode({ rundown: [{ newsId: 'a' } as any], rundownSegments: [{ newsId: 'a' } as any] })])[0];
  expect(row.deadlineMs).toBe(Date.parse('2026-10-11T10:00:00Z'));
  expect(row.destination).toEqual({ collection: 'episodes', id: 'episode', title: 'Episode' });
  expect(row.overdue).toBe(true);
  expect(reviewDeadlineLabel(row, now)).toContain('متأخر');
});
it('ignores floated killed deleted and completed broadcast targets', () => {
  for (const extra of [{ floated: true }, { killed: true }, { deletedAt: 'now' }]) expect(select(undefined, [bulletin('b')], [story('s', 'a', 'b', extra)])[0].deadlineMs).toBeNull();
  for (const extra of [{ status: 'DONE' as const }, { deletedAt: 'now' }]) expect(select(undefined, [bulletin('b', '15:00', extra)], [story('s', 'a', 'b')])[0].deadlineMs).toBeNull();
  for (const status of ['CANCELLED', 'ARCHIVED', 'BROADCASTED']) expect(select(undefined, [], [], [episode({ status: status as any })])[0].deadlineMs).toBeNull();
  expect(select(undefined, [], [], [episode({ deletedAt: 'now' })])[0].deadlineMs).toBeNull();
});
it('orders known deadlines before unknown then priority submission and stable id', () => {
  const rows = select([news('unknown', { priority: 'CRITICAL' }), news('b'), news('a'), news('early', { priority: 'LOW' })], [bulletin('b'), bulletin('early', '12:00')], [story('1', 'a', 'b'), story('2', 'b', 'b'), story('3', 'early', 'early')]);
  expect(rows.map(r => r.newsId)).toEqual(['early', 'a', 'b', 'unknown']);
  expect(reviewDeadlineLabel(rows[3], now)).toBe('موعد البث غير محدد');
  expect(select([news('old'), news('urgent', { priority: 'URGENT' }), news('new', { updatedAt: '2026-10-11T10:00:00Z' })]).map(r => r.newsId)).toEqual(['urgent', 'old', 'new']);
});
it('uses review submission time and never substitutes embargo or publication dates', () => {
  expect(select([news('a', { publishDate: '2026-10-11T09:00:00Z', embargoUntil: '2026-10-11T09:00:00Z' })])[0].deadlineMs).toBeNull();
  expect(select([news('b'), news('a', { workflowLogs: [{ toStatus: 'UNDER_REVIEW', timestamp: '2026-10-11T09:00:00Z' } as any] })]).map(r => r.newsId)).toEqual(['b', 'a']);
  expect(select([news('draft', { status: 'DRAFT' }), news('deleted', { deletedAt: 'now' })])).toEqual([]);
});
it('does not expose broadcast deadlines without the relevant effective read permission', () => {
  expect(reviewBroadcastVisibility(() => false)).toEqual({ bulletins: false, episodes: false });
  expect(reviewBroadcastVisibility(code => code === 'rundown.view')).toEqual({ bulletins: true, episodes: false });
  expect(reviewBroadcastVisibility(code => code === 'programs.view')).toEqual({ bulletins: false, episodes: true });
});
