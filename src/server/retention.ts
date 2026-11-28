import type { NewsroomDatabase } from './db';
import { SINGLETON_ID, type CollectionName } from '../shared/collections';
import { isTaskTrashCollection, TRASH_COLLECTIONS, trashRetentionError, type TrashCollection } from '../shared/trash';
import { logger } from './logger';
import { changeBus } from './sync';
import { removeUnreferencedMediaUpload, uploadIdFromMedia } from './uploads';

export interface RetentionConfig {
  trashDays: number;
  notificationDays: number;
  logDays: number;
  auditLogDays: number;
  /** Agency wire items (always bounded). */
  wireDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TRASH_RETENTION_START = 'trash_retention_started_at';
const TASK_TRASH_RETENTION_START = 'task_trash_retention_started_at';
const previouslyTimed: readonly TrashCollection[] = ['news', 'stories', 'programs', 'episodes', 'guests', 'media', 'diary', 'resources', 'bookings'];

export interface TrashRetentionPolicy {
  defaultDays: number;
  byCollection: Record<TrashCollection, { days: number; activeSince?: string }>;
}

/** Keep deletions made before this feature recoverable when no policy previously applied. */
export function initializeTrashRetention(db: NewsroomDatabase): void {
  const now = new Date().toISOString();
  if (!db.getMeta(TRASH_RETENTION_START)) db.setMeta(TRASH_RETENTION_START, now);
  if (!db.getMeta(TASK_TRASH_RETENTION_START)) db.setMeta(TASK_TRASH_RETENTION_START, now);
}

export function readTrashRetention(db: NewsroomDatabase, defaultDays: number): TrashRetentionPolicy {
  const overrides = db.getRow('settings', SINGLETON_ID)?.d?.trashRetentionDays;
  const now = new Date().toISOString();
  const startedAt = db.getMeta(TRASH_RETENTION_START) || now;
  const taskStartedAt = db.getMeta(TASK_TRASH_RETENTION_START) || now;
  const byCollection = Object.fromEntries(TRASH_COLLECTIONS.map(collection => {
    const override: unknown = overrides?.[collection];
    if (typeof override === 'number' && !trashRetentionError({ [collection]: override })) return [collection, { days: override }];
    if (previouslyTimed.includes(collection)) return [collection, { days: defaultDays }];
    return [collection, { days: defaultDays, activeSince: isTaskTrashCollection(collection) ? taskStartedAt : startedAt }];
  })) as TrashRetentionPolicy['byCollection'];
  return { defaultDays, byCollection };
}

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
      const uploadId = collection === 'media' ? uploadIdFromMedia(db.getRow('media', id)?.d) : null;
      if (!db.deleteRow(collection, id, null)) continue;
      removed[collection] = (removed[collection] || 0) + 1;
      if (uploadId) removeUnreferencedMediaUpload(db, dataDir, uploadId);
    }
  };

  initializeTrashRetention(db);
  const trash = readTrashRetention(db, cfg.trashDays);
  for (const collection of TRASH_COLLECTIONS) {
    const { days, activeSince } = trash.byCollection[collection];
    if (days > 0) purge(collection, db.retentionCandidates(collection, 'trashed', cutoff(days), 1000, activeSince));
  }
  if (cfg.notificationDays > 0) {
    // Read notifications go after a month (or sooner if the window is shorter); unread ones after the full window.
    purge('notifications', db.retentionCandidates('notifications', 'readNotification', cutoff(Math.min(30, cfg.notificationDays))));
    purge('notifications', db.retentionCandidates('notifications', 'updated', cutoff(cfg.notificationDays)));
  }
  // On-air alerts only matter during the broadcast.
  purge('cues', db.retentionCandidates('cues', 'updated', cutoff(1), 5000));
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
