import type { NewsroomDatabase } from './db';
import { segmentMediaIds, type MediaBroadcastUse } from '../shared/mediaEditorial';

export function recordOneTimeMediaUse(db: NewsroomDatabase, use: MediaBroadcastUse, userId: string) {
  const episode = db.getRow('episodes', use.showId)?.d;
  const segment = episode?.rundown?.find((item: { id: string }) => item.id === use.segmentId);
  const story = db.getRow('bulletinStories', use.segmentId)?.d;
  const ids = segment
    ? segmentMediaIds(segment, use.showId, db.listCollection('media').map(row => row.d), db.listCollection('requests').map(row => row.d))
    : new Set<string>(story?.bulletinId === use.showId && story?.clipMediaId ? [story.clipMediaId] : []);

  for (const id of ids) {
    const row = db.getRow('media', id);
    if (row && !row.d.deletedAt && row.d.rights?.status === 'CLEARED' && row.d.rights.origin === 'ONE_TIME' && !row.d.broadcastUse) {
      db.writeRow('media', row.id, { ...row.d, broadcastUse: use }, row.p, userId);
    }
  }
}
