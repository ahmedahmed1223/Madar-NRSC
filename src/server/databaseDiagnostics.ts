import type { NewsroomDatabase } from './db';
import type { BackupStatus } from '../shared/databaseDiagnostics';
import { backupIncidents } from './backupIncidents';
import { lastVerifiedExternalBackup } from './backupDelivery';
import { readRehearsalEvidence } from './databaseRecovery';

function attempt(value: string | undefined | null): BackupStatus['lastAttempt'] {
  try {
    const parsed = JSON.parse(value || 'null');
    return parsed && ['ok', 'failed'].includes(parsed.status) && Number.isFinite(Date.parse(parsed.at))
      ? { at: new Date(Date.parse(parsed.at)).toISOString(), status: parsed.status } : null;
  } catch { return null; }
}
function rehearsal(value: string | null | undefined): BackupStatus['lastRehearsal'] {
  try {
    const entry = JSON.parse(value || 'null');
    const at = Date.parse(entry?.at);
    return Number.isFinite(at) && typeof entry.fileName === 'string' && /^newsroom_backup_[\w-]+\.sqlite$/.test(entry.fileName)
      ? { at: new Date(at).toISOString(), fileName: entry.fileName } : null;
  } catch { return null; }
}

export function nextBackupDelayMs(
  intervalHours: number,
  lastDelivery: BackupStatus['lastDelivery'],
  lastAttempt: BackupStatus['lastAttempt'],
  now = Date.now(),
): number | null {
  if (!Number.isInteger(intervalHours) || intervalHours <= 0) return null;
  const intervalMs = intervalHours * 60 * 60 * 1000;
  if (lastDelivery?.status === 'failed' || lastAttempt?.status === 'failed') return Math.min(intervalMs, 60 * 60 * 1000);
  if (!lastDelivery || lastDelivery.status !== 'ok') return Math.min(intervalMs, 60 * 1000);
  const deliveredAt = Date.parse(lastDelivery.at);
  if (!Number.isFinite(deliveredAt)) return Math.min(intervalMs, 60 * 1000);
  const elapsed = Math.max(0, now - deliveredAt);
  return Math.max(Math.min(intervalMs, 60 * 1000), intervalMs - elapsed);
}

export function backupStatus(db: NewsroomDatabase, intervalHours: number, destinations: { backupDirectory?: string; backupRemote?: string } = {}): BackupStatus {
  const files = db.listBackups();
  const lastSnapshotAt = files[0]?.createdAt || null;
  const lastAttempt = attempt(db.getMeta('backup_last_attempt'));
  const lastDelivery = attempt(db.getMeta('backup_last_delivery'));
  const lastCompleteDeliveryAt = lastDelivery?.status === 'ok' ? Date.parse(lastDelivery.at) : NaN;
  return { lastSnapshotAt, count: files.length, intervalHours, incidents: backupIncidents(db),
    overdue: intervalHours > 0 && (!Number.isFinite(lastCompleteDeliveryAt) || Date.now() - lastCompleteDeliveryAt > intervalHours * 3600000),
    lastAttempt, lastDelivery,
    lastVerifiedExternal: lastVerifiedExternalBackup(db, destinations), lastRehearsal: rehearsal(readRehearsalEvidence(db.dataDir)) };
}
