import type { NewsroomDatabase } from './db';
import { newId } from '../shared/ids';
import { NotificationCategory, isFlashWire, watchWordHits, WIRE_ALERT_MAX_AGE_MS, NotificationPrefs } from '../shared/notifications';
import type { WireItem } from '../types/index';

export interface NewNotification {
  userId: string;
  title: string;
  message: string;
  linkUrl?: string;
  category: NotificationCategory;
  /** Urgent items ignore quiet hours for e-mail/push. */
  urgent?: boolean;
  type?: string;
}

/** Writes one bell notification (system write; the caller emits the revision). */
export function writeNotification(db: NewsroomDatabase, n: NewNotification) {
  const id = newId('notif');
  db.writeRow(
    'notifications',
    id,
    {
      id,
      userId: n.userId,
      title: n.title.slice(0, 200),
      message: n.message.slice(0, 600),
      type: n.type || (n.category === 'wire' ? 'BREAKING_NEWS' : n.category === 'assignment' ? 'TASK_ASSIGNED' : 'SYSTEM'),
      category: n.category,
      urgent: n.urgent || undefined,
      linkUrl: n.linkUrl,
      isRead: false,
      createdAt: new Date().toISOString(),
    },
    db.positionBounds('notifications').min - 1,
    null
  );
  return id;
}

const activeUsers = (db: NewsroomDatabase) =>
  new Map(db.listCollection('users').map((r) => r.d).filter((u: any) => u && u.isActive !== false && !u.deletedAt).map((u: any) => [u.id, u]));

export function prefsOf(db: NewsroomDatabase, userId: string): NotificationPrefs | undefined {
  return db.getRow('notificationPrefs', userId)?.d as NotificationPrefs | undefined;
}

/**
 * Alerts for freshly ingested wires: colleagues who asked for urgent/flash wires, and those
 * whose watch words appear. Old items (first seen long after publication) never alert.
 * Returns the number of notifications written.
 */
export function alertForWires(db: NewsroomDatabase, wires: WireItem[], now = Date.now()): number {
  const fresh = wires.filter((w) => now - Date.parse(w.publishedAt) <= WIRE_ALERT_MAX_AGE_MS);
  if (!fresh.length) return 0;
  const users = activeUsers(db);
  const prefs = db
    .listCollection('notificationPrefs')
    .map((r) => r.d as NotificationPrefs)
    .filter((p) => p && users.has(p.userId) && (p.flashAlerts || p.watchWords?.length));
  let written = 0;
  for (const wire of fresh) {
    const flash = isFlashWire(wire);
    for (const p of prefs) {
      const hits = watchWordHits(`${wire.title}\n${wire.summary}`, p.watchWords || []);
      if (!(flash && p.flashAlerts) && !hits.length) continue;
      const title = flash ? `عاجل — ${wire.sourceName}` : `برقية تحوي «${hits.slice(0, 3).join('، ')}»`;
      writeNotification(db, { userId: p.userId, title, message: wire.title, linkUrl: `/wires/${wire.id}`, category: 'wire', urgent: flash });
      written++;
    }
  }
  return written;
}

/** Local wall-clock time on the server (set TZ, e.g. TZ=Asia/Riyadh, to match the newsroom). */
export function localStamp(iso: string, withDate = true): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return withDate ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}` : time;
}
