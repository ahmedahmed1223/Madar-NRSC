import type { CollectionName } from '../shared/collections';
import { byRank, plainText, storyTiming, type Bulletin, type BulletinStory } from '../shared/bulletins';
import { departmentIdOf } from '../shared/departments';
import { segmentGuests } from '../shared/episodePlan';
import type { BroadcastArchiveItem } from '../shared/broadcastArchive';
import type { Episode, Guest, NewsItem, User } from '../types';

export function captureBroadcastPlan(showId: string, list: (collection: CollectionName) => any[], lookup: (collection: CollectionName, id: string) => any): BroadcastArchiveItem[] {
  const episode = lookup('episodes', showId) as Episode | undefined;
  const bulletin = lookup('bulletins', showId) as Bulletin | undefined;
  if (!episode && !bulletin) return [];
  const attribution = (newsId: string | undefined, responsible?: string) => {
    const item = newsId ? lookup('news', newsId) as NewsItem | undefined : undefined;
    const authorId = item?.authorId || responsible;
    const author = authorId ? lookup('users', authorId) as User | undefined : undefined;
    return { newsId, categoryId: item?.categoryId, stationId: author?.stationId, departmentId: author && departmentIdOf(author) };
  };
  const nameFor = (id?: string) => id ? (lookup('guests', id) as Guest | undefined)?.fullName : undefined;
  if (bulletin) {
    return (list('bulletinStories') as BulletinStory[]).filter(row => row.bulletinId === showId && !row.deletedAt).sort(byRank).map(row => ({
      id: row.id,
      title: row.slug,
      plannedSeconds: storyTiming(row).total,
      script: row.status === 'APPROVED' ? plainText(row.script) : '',
      guestNames: row.remoteGuest?.confirmed ? [nameFor(row.remoteGuest.guestId)].filter(Boolean) : [],
      countsForOutput: row.type !== 'BREAK',
      disposition: row.killed ? 'KILLED' : row.floated ? 'DEFERRED' : undefined,
      ...attribution(row.newsId, row.writerId || bulletin.editorId),
    }));
  }
  const guestNames = new Map((episode!.guests || []).map(guest =>
    ['guestId' in guest ? guest.guestId : guest.id, 'guestName' in guest ? guest.guestName : guest.fullName]));
  return (episode!.rundown || []).map(segment => ({
    id: segment.id,
    title: segment.title,
    plannedSeconds: Number(segment.durationSeconds) || 0,
    script: plainText(segment.scriptText || segment.script || ''),
    guestNames: [...new Set(segmentGuests(segment).map(guest => guest.guestName || guestNames.get(guest.guestId) || nameFor(guest.guestId) || '').filter(Boolean))],
    countsForOutput: segment.segmentType !== 'BREAK',
    ...attribution(segment.newsId, episode!.producerId),
  }));
}
