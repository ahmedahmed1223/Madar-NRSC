import type { NewsItem, Episode } from '../types';
import type { Bulletin, BulletinStory } from './bulletins';
import { stationWallTime } from './stationWallTime';

export interface ReviewDeadline {
  newsId: string;
  deadlineMs: number | null;
  destination: { collection: 'bulletins' | 'episodes'; id: string; title: string } | null;
  overdue: boolean;
}
const priority: Record<string, number> = { LOW: 0, NORMAL: 1, MEDIUM: 1, HIGH: 2, URGENT: 3, CRITICAL: 4 };
export const submittedForReview = (news: NewsItem) => [...(news.workflowLogs || [])].reverse().find(log => log.toStatus === 'UNDER_REVIEW')?.timestamp || news.updatedAt;
const submittedAt = (news: NewsItem) => Date.parse(submittedForReview(news)) || 0;

/** All source arrays must already be restricted to currently readable entities. */
export function selectReviewDeadlines(news: NewsItem[], bulletins: Bulletin[], stories: BulletinStory[], episodes: Episode[], zone: string, now: number): ReviewDeadline[] {
  const active = new Map(bulletins.filter(b => !b.deletedAt && b.status !== 'DONE').map(b => [b.id, b]));
  const deadlines = new Map<string, ReviewDeadline>();
  const add = (newsId: string, date: string, time: string, destination: NonNullable<ReviewDeadline['destination']>) => {
    const deadlineMs = stationWallTime(date, time, zone);
    if (deadlineMs === null) return;
    const previous = deadlines.get(newsId);
    if (!previous || deadlineMs < previous.deadlineMs! || (deadlineMs === previous.deadlineMs && `${destination.collection}:${destination.id}` < `${previous.destination!.collection}:${previous.destination!.id}`)) {
      deadlines.set(newsId, { newsId, deadlineMs, destination, overdue: deadlineMs < now });
    }
  };
  for (const story of stories) {
    const bulletin = active.get(story.bulletinId);
    if (bulletin && story.newsId && !story.deletedAt && !story.killed && !story.floated) add(story.newsId, bulletin.date, bulletin.startTime, { collection: 'bulletins', id: bulletin.id, title: bulletin.title });
  }
  for (const episode of episodes) {
    if (episode.deletedAt || ['CANCELLED', 'ARCHIVED', 'BROADCASTED'].includes(episode.status)) continue;
    const ids = new Set([...(episode.linkedNewsIds || []), ...(episode.rundown || []).map(s => s.newsId), ...(episode.rundownSegments || []).map(s => s.newsId)]);
    for (const id of ids) if (id) add(id, episode.broadcastDate || '', episode.startTime || '', { collection: 'episodes', id: episode.id, title: episode.title });
  }
  return news.filter(n => !n.deletedAt && n.status === 'UNDER_REVIEW').map(n => ({ news: n, row: deadlines.get(n.id) || { newsId: n.id, deadlineMs: null, destination: null, overdue: false } }))
    .sort((a, b) => (a.row.deadlineMs ?? Infinity) - (b.row.deadlineMs ?? Infinity) || (priority[b.news.priority] ?? 1) - (priority[a.news.priority] ?? 1) || submittedAt(a.news) - submittedAt(b.news) || a.news.id.localeCompare(b.news.id))
    .map(value => value.row);
}

export function reviewDeadlineLabel(row: ReviewDeadline, now: number): string {
  if (row.deadlineMs === null) return 'موعد البث غير محدد';
  const minutes = Math.ceil(Math.abs(row.deadlineMs - now) / 60_000);
  return `${row.deadlineMs < now ? 'متأخر عن البث' : 'البث خلال'} ${minutes < 60 ? `${minutes} دقيقة` : `${Math.floor(minutes / 60)} ساعة ${minutes % 60} دقيقة`}`;
}
