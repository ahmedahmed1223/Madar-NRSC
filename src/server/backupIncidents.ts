import crypto from 'node:crypto';
import type { NewsroomDatabase } from './db';
import type { BackupStatus, BackupIncident } from '../shared/databaseDiagnostics';
import { buildAuthContext } from './auth';
import { writeNotification } from './notifications';
import type { User } from '../types/index';

const KEY = 'backup_incidents_v1';
const PENDING_KEY = 'backup_incidents_pending_v1';
const IDS = ['snapshot-failure', 'delivery-failure', 'overdue'] as const;
type Id = typeof IDS[number];
interface Incident { active: boolean; generation: string; lastNotifiedAt: number; openedAt: string; recoveredAt?: string }
interface Transition { id: Id; generation: string; kind: 'opened' | 'reminder' | 'recovered'; at: string }
function pending(db: NewsroomDatabase): Transition[] {
  try {
    const parsed = JSON.parse(db.getMeta(PENDING_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(value => value && IDS.includes(value.id) && typeof value.generation === 'string' &&
      ['opened', 'reminder', 'recovered'].includes(value.kind) && typeof value.at === 'string' && Number.isFinite(Date.parse(value.at)))
      .map(value => ({ id: value.id, generation: value.generation, kind: value.kind, at: new Date(value.at).toISOString() }));
  } catch { return []; }
}
function state(db: NewsroomDatabase): Partial<Record<Id, Incident>> {
  try {
    const parsed = JSON.parse(db.getMeta(KEY) || '{}');
    const safe: Partial<Record<Id, Incident>> = {};
    for (const id of IDS) {
      const value = parsed?.[id];
      if (value && typeof value.active === 'boolean' && typeof value.generation === 'string' &&
        Number.isFinite(value.lastNotifiedAt) && Number.isFinite(Date.parse(value.openedAt))) safe[id] = value;
    }
    return safe;
  } catch { return {}; }
}
export function backupIncidents(db: NewsroomDatabase): BackupIncident[] {
  const stored = state(db);
  return IDS.flatMap(id => stored[id] ? [{ id, active: stored[id]!.active, openedAt: stored[id]!.openedAt,
    recoveredAt: stored[id]!.recoveredAt }] : []);
}
export async function reconcileBackupIncidents(db: NewsroomDatabase, status: BackupStatus, now = Date.now()): Promise<void> {
  const failed: Record<Id, boolean> = { 'snapshot-failure': status.lastAttempt?.status === 'failed',
    'delivery-failure': status.lastDelivery?.status === 'failed', overdue: status.intervalHours > 0 && status.overdue };
  const names: Record<Id, string> = { 'snapshot-failure': 'إنشاء نسخة قاعدة البيانات',
    'delivery-failure': 'تجهيز أو تسليم النسخة الكاملة', overdue: 'موعد النسخ الاحتياطي التلقائي' };
  db.transaction(() => {
    const stored = state(db);
    const queued = pending(db);
    for (const id of IDS) {
      let current = stored[id];
      let transition: 'opened' | 'reminder' | 'recovered' | null = null;
      if (failed[id] && !current?.active) {
        current = { active: true, generation: crypto.randomUUID(), openedAt: new Date(now).toISOString(), lastNotifiedAt: now };
        transition = 'opened';
      } else if (failed[id] && current && now - current.lastNotifiedAt >= 86400000) {
        transition = 'reminder'; current.lastNotifiedAt = now;
      } else if (!failed[id] && current?.active) {
        // Disabling a schedule is not a successful backup recovery.
        if (id === 'overdue' && status.intervalHours <= 0) continue;
        transition = 'recovered'; current.active = false; current.recoveredAt = new Date(now).toISOString();
      }
      if (!current || !transition) continue;
      queued.push({ id, generation: current.generation, kind: transition, at: new Date(now).toISOString() });
      stored[id] = current;
    }
    // Preserve transitions before attempting notification writes, even if outcomes change before retry.
    db.setMeta(KEY, JSON.stringify(stored));
    db.setMeta(PENDING_KEY, JSON.stringify(queued));
  });
  db.transaction(() => {
    const queued = pending(db);
    const managers = db.listCollection('users').map(row => row.d as User).filter(user => user && user.isActive !== false && !user.deletedAt &&
      buildAuthContext(db, user, '').can('system.database_manage'));
    for (const event of queued) {
      for (const manager of managers) {
        const notificationId = 'backup-' + crypto.createHash('sha256').update(`${event.id}:${event.generation}:${event.kind}:${event.at}:${manager.id}`).digest('hex');
        if (db.getRow('notifications', notificationId)) continue;
        writeNotification(db, { userId: manager.id, category: 'system', type: 'BACKUP_INCIDENT', linkUrl: '/database',
          title: event.kind === 'recovered' ? 'عاد النسخ الاحتياطي للعمل' : event.kind === 'reminder' ? 'تذكير بمشكلة النسخ الاحتياطي' : 'تنبيه النسخ الاحتياطي',
          message: (event.kind === 'recovered' ? `تمت معالجة مشكلة ${names[event.id]}.` : `تحتاج مشكلة ${names[event.id]} إلى مراجعة مدير النظام.`) + ` وقت الحدث: ${event.at}` },
          { id: notificationId, createdAt: new Date(now).toISOString() });
      }
    }
    // Clearing the outbox and inserting notifications succeed or roll back together.
    db.setMeta(PENDING_KEY, '[]');
  });
}
