import type { NewsroomDatabase } from './db';
import type { CollectionName } from '../shared/collections';
import { logger } from './logger';
import { changeBus } from './sync';
import { removeUpload, uploadIdFromMedia } from './uploads';

export interface RetentionConfig {
  trashDays: number;
  notificationDays: number;
  logDays: number;
  auditLogDays: number;
  /** Agency wire items (always bounded). */
  wireDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Collections whose soft-deleted rows sit in a trash that users can restore from. */
const TRASH_COLLECTIONS: CollectionName[] = ['news', 'stories', 'programs', 'episodes', 'guests', 'media'];

/**
 * Keeps the synced collections from growing without bound (every browser downloads them):
 * empties old trash, drops old notifications, stale edit locks and, when configured, old logs.
 * Deletions go through tombstones so connected clients drop the rows too.
 */
export function runRetention(db: NewsroomDatabase, dataDir: string, cfg: RetentionConfig, now = Date.now()) {
  const cutoff = (days: number) => new Date(now - days * DAY_MS).toISOString();
  const removed: Record<string, number> = {};
  const purge = (collection: CollectionName, ids: string[]) => {
    for (const id of ids) {
      if (collection === 'media') {
        const uploadId = uploadIdFromMedia(db.getRow('media', id)?.d);
        if (uploadId) removeUpload(db, dataDir, uploadId);
      }
      if (db.deleteRow(collection, id, null)) removed[collection] = (removed[collection] || 0) + 1;
    }
  };

  if (cfg.trashDays > 0) {
    for (const c of TRASH_COLLECTIONS) purge(c, db.retentionCandidates(c, 'trashed', cutoff(cfg.trashDays)));
  }
  if (cfg.notificationDays > 0) {
    // Read notifications go after a month (or sooner if the window is shorter); unread ones after the full window.
    purge('notifications', db.retentionCandidates('notifications', 'readNotification', cutoff(Math.min(30, cfg.notificationDays))));
    purge('notifications', db.retentionCandidates('notifications', 'updated', cutoff(cfg.notificationDays)));
  }
  // Locks left behind by crashed tabs.
  purge('editLocks', db.retentionCandidates('editLocks', 'expiredLock', new Date(now - 60 * 60 * 1000).toISOString()));
  if (cfg.logDays > 0) {
    purge('activityLogs', db.retentionCandidates('activityLogs', 'updated', cutoff(cfg.logDays), 5000));
    purge('messages', db.retentionCandidates('messages', 'updated', cutoff(cfg.logDays), 5000));
  }
  if (cfg.auditLogDays > 0) {
    purge('auditLogs', db.retentionCandidates('auditLogs', 'updated', cutoff(cfg.auditLogDays), 5000));
  }
  if (cfg.wireDays && cfg.wireDays > 0) {
    purge('wires', db.retentionCandidates('wires', 'updated', cutoff(cfg.wireDays), 5000));
  }
  const history = db.purgeOrphanHistory();
  if (Object.keys(removed).length) changeBus.emit('rev', db.currentRev());
  if (Object.keys(removed).length || history) logger.info('retention cleanup', { removed, history });
  return { removed, history };
}
