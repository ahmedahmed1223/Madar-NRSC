import type { NewsroomDatabase } from './db';
import type { BackupStatus } from '../shared/databaseDiagnostics';

function attempt(value: string | undefined | null): BackupStatus['lastAttempt'] {
  try {
    const parsed = JSON.parse(value || 'null');
    return parsed && ['ok', 'failed'].includes(parsed.status) && Number.isFinite(Date.parse(parsed.at))
      ? { at: new Date(Date.parse(parsed.at)).toISOString(), status: parsed.status } : null;
  } catch { return null; }
}
export function backupStatus(db: NewsroomDatabase, intervalHours: number): BackupStatus {
  const files = db.listBackups();
  const lastSnapshotAt = files[0]?.createdAt || null;
  return { lastSnapshotAt, count: files.length, intervalHours,
    overdue: intervalHours > 0 && (!lastSnapshotAt || Date.now() - Date.parse(lastSnapshotAt) > intervalHours * 3600000),
    lastAttempt: attempt(db.getMeta('backup_last_attempt')), lastDelivery: attempt(db.getMeta('backup_last_delivery')) };
}
