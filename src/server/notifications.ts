import { createHash } from 'node:crypto';
import type { NewsroomDatabase } from './db';
import { buildAuthContext } from './auth';
import { canRead } from './policy';
import { newId } from '../shared/ids';
import { NotificationCategory, isFlashWire, watchWordHits, WIRE_ALERT_MAX_AGE_MS, NEWS_KEYWORD_NOTICE_PREFIX, NotificationPrefs } from '../shared/notifications';
import { plainText } from '../shared/newsWorkflow';
import type { NewsItem, WireItem } from '../types/index';

export interface NewNotification {
  userId: string;
  title: string;
  message: string;
  linkUrl?: string;
  category: NotificationCategory;
  /** Urgent items ignore quiet hours for e-mail/push. */
  urgent?: boolean;
  type?: string;
  senderId?: string;
}

/** Writes one bell notification (system write; the caller emits the revision). */
export function writeNotification(db: NewsroomDatabase, n: NewNotification, options?: { id: string; createdAt: string }) {
  const id = options?.id ?? newId('notif');
  db.writeRow(
    'notifications',
    id,
    {
      id,
      userId: n.userId,
      senderId: n.senderId,
      title: n.title.slice(0, 200),
      message: n.message.slice(0, 600),
      type: n.type || (n.category === 'wire' ? 'BREAKING_NEWS' : n.category === 'assignment' ? 'TASK_ASSIGNED' : 'SYSTEM'),
      category: n.category,
      urgent: n.urgent || undefined,
      linkUrl: n.linkUrl,
      isRead: false,
      createdAt: options?.createdAt ?? new Date().toISOString(),
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

function keywordFields(news: Partial<NewsItem>) {
  const keywords = Array.isArray(news.keywords) ? news.keywords : [];
  return [news.title, news.shortTitle, plainText(news.summary), plainText(news.content), ...keywords]
    .filter((field): field is string => typeof field === 'string' && !!field.trim());
}

/** Called within the news write transaction so the alert arrives with the committed story. */
export function alertForNewsKeywords(db: NewsroomDatabase, before: NewsItem | null, after: NewsItem) {
  if (after.deletedAt || before?.deletedAt) return;
  const fields = keywordFields(after);
  if (!fields.length) return;
  const previous = before ? keywordFields(before) : [];
  if (fields.length === previous.length && fields.every((field, index) => field === previous[index])) return;

  for (const row of db.listCollection('notificationPrefs')) {
    const prefs = row.d as NotificationPrefs;
    if (!Array.isArray(prefs?.newsWatchWords) || !prefs.newsWatchWords.length) continue;
    const user = db.getRow('users', prefs.userId)?.d;
    if (!user || user.isActive === false || user.deletedAt || !canRead(buildAuthContext(db, user, ''), 'news', after)) continue;
    const digest = createHash('sha256').update(JSON.stringify([after.id, user.id])).digest('hex');
    const id = NEWS_KEYWORD_NOTICE_PREFIX + digest;
    if (db.getRow('notifications', id, true)) continue;

    const words = [...new Set(prefs.newsWatchWords)];
    const oldHits = new Set(previous.flatMap(field => watchWordHits(field, words)));
    const newWords = words.filter(word => !oldHits.has(word));
    const hits = [...new Set(fields.flatMap(field => watchWordHits(field, newWords)))];
    if (!hits.length) continue;
    writeNotification(db, {
      userId: user.id,
      title: `خبر يطابق «${hits.slice(0, 3).join('، ')}»`,
      message: typeof after.title === 'string' && after.title.trim() ? after.title : 'خبر بلا عنوان',
      linkUrl: `/news/${encodeURIComponent(after.id)}`,
      category: 'news-keyword',
    }, { id, createdAt: new Date().toISOString() });
  }
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
      const title = flash ? `عاجل — ${wire.sourceName}` : `مادة تحوي «${hits.slice(0, 3).join('، ')}»`;
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
