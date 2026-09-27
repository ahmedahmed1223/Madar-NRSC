/**
 * Delivers bell notifications by e-mail (SMTP) and Web Push to phones/desktops, following each
 * colleague's preferences. Runs on a timer: new notification rows since the last run are read
 * from the database, so nothing is lost across restarts and nothing old is re-sent.
 */
import webpush from 'web-push';
import nodemailer, { type Transporter } from 'nodemailer';
import type { NewsroomDatabase } from './db';
import type { AppConfig } from './config';
import { logger } from './logger';
import { prefsOf } from './notifications';
import { categoryName, inQuietHours, wantsDelivery } from '../shared/notifications';

const CURSOR_KEY = 'notify_delivery_rev';
/** Notifications older than this when the worker sees them (e.g. after downtime) stay in the bell only. */
const MAX_AGE_MS = 60 * 60 * 1000;
const BATCH = 200;

export interface DeliveryStats {
  push: number;
  email: number;
  skipped: number;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** Keys from the environment, or generated once and kept in the database. */
export function vapidKeys(db: NewsroomDatabase, config: AppConfig): VapidKeys {
  if (config.vapid.publicKey && config.vapid.privateKey) return { publicKey: config.vapid.publicKey, privateKey: config.vapid.privateKey };
  const stored = db.getMeta('vapid_keys');
  if (stored) return JSON.parse(stored) as VapidKeys;
  const keys = webpush.generateVAPIDKeys();
  db.setMeta('vapid_keys', JSON.stringify(keys));
  return keys;
}

let transporter: Transporter | null = null;
function mailer(config: AppConfig): Transporter | null {
  if (!config.mail) return null;
  transporter ??= nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    // Never read local files or URLs while building a message.
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return transporter;
}

export const mailEnabled = (config: AppConfig) => !!config.mail;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Absolute link that opens the app on the notification's target. */
export function openUrl(config: AppConfig, linkUrl: string | undefined): string {
  const base = (config.appUrl || '').replace(/\/+$/, '');
  const path = linkUrl ? `/?open=${encodeURIComponent(linkUrl)}` : '/';
  return `${base}${path}`;
}

export function notificationEmail(n: { title: string; message: string; category?: string; linkUrl?: string }, config: AppConfig) {
  const link = openUrl(config, n.linkUrl);
  const absolute = /^https?:\/\//.test(link);
  const html = `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#f1f5f9;font-family:Tahoma,Arial,sans-serif">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;text-align:right">
<div style="background:#1e3a8a;color:#fff;padding:14px 20px;font-weight:bold">مدار — ${escapeHtml(categoryName(n.category))}</div>
<div style="padding:20px">
<h2 style="margin:0 0 10px;font-size:18px;color:#0f172a">${escapeHtml(n.title)}</h2>
<p style="margin:0 0 18px;font-size:14px;line-height:1.8;color:#334155;white-space:pre-line">${escapeHtml(n.message)}</p>
${absolute ? `<a href="${escapeHtml(link)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">فتح في مدار</a>` : ''}
</div>
<div style="padding:12px 20px;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9">تصلك هذه الرسالة حسب إعدادات «تنبيهاتي» في مدار، ويمكنك تغييرها من هناك.</div>
</div></body></html>`;
  const text = `${n.title}\n\n${n.message}${absolute ? `\n\n${link}` : ''}`;
  return { subject: `مدار: ${n.title}`, html, text };
}

export async function sendEmail(config: AppConfig, to: string, content: { subject: string; html: string; text: string }) {
  const t = mailer(config);
  if (!t || !config.mail) throw new Error('البريد غير مهيأ (SMTP_HOST)');
  await t.sendMail({ from: config.mail.from, to, subject: content.subject, html: content.html, text: content.text });
}

/** Sends to every registered device of the user; dead subscriptions are removed. */
export async function sendPush(db: NewsroomDatabase, config: AppConfig, userId: string, payload: Record<string, unknown>): Promise<number> {
  const subs = db.listPushSubscriptions(userId);
  if (!subs.length) return 0;
  const keys = vapidKeys(db, config);
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
        vapidDetails: { subject: config.vapid.subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
        TTL: 60 * 60,
        urgency: payload.urgent ? 'high' : 'normal',
        timeout: 10_000,
      });
      sent++;
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) db.deletePushSubscription(s.endpoint);
      else logger.warn('push delivery failed', { userId, status: err?.statusCode, error: String(err?.body || err?.message || err).slice(0, 200) });
    }
  }
  return sent;
}

let running: Promise<DeliveryStats> | null = null;

/** One delivery pass; concurrent calls share the run. */
export function deliverPending(db: NewsroomDatabase, config: AppConfig, now = Date.now()): Promise<DeliveryStats> {
  if (running) return running;
  running = (async () => {
    const stats: DeliveryStats = { push: 0, email: 0, skipped: 0 };
    let cursor = Number(db.getMeta(CURSOR_KEY));
    if (!Number.isFinite(cursor) || db.getMeta(CURSOR_KEY) === null) {
      // First run: start from now, never replay history.
      db.setMeta(CURSOR_KEY, String(db.currentRev()));
      return stats;
    }
    for (;;) {
      const batch = db.collectionChangesSince('notifications', cursor, BATCH);
      if (!batch.length) break;
      for (const { rev, row } of batch) {
        cursor = rev;
        const n = row.d;
        // Only brand-new, unread notifications addressed to one person.
        if (!n || row.v !== 1 || n.isRead || !n.userId || n.userId === 'all' || now - Date.parse(n.createdAt) > MAX_AGE_MS) {
          stats.skipped++;
          continue;
        }
        const user = db.getRow('users', n.userId)?.d;
        if (!user || user.isActive === false) continue;
        const prefs = prefsOf(db, n.userId);
        const local = new Date(now);
        if (!n.urgent && inQuietHours(prefs, local.getHours() * 60 + local.getMinutes())) {
          stats.skipped++;
          continue;
        }
        if (wantsDelivery(prefs, n.category, 'push')) {
          stats.push += await sendPush(db, config, n.userId, {
            title: n.title,
            body: n.message,
            url: openUrl(config, n.linkUrl).replace(/^https?:\/\/[^/]+/, ''),
            tag: n.id,
            urgent: !!n.urgent,
          }).catch(() => 0);
        }
        if (config.mail && user.email && wantsDelivery(prefs, n.category, 'email')) {
          try {
            await sendEmail(config, user.email, notificationEmail(n, config));
            stats.email++;
          } catch (err: any) {
            logger.warn('e-mail delivery failed', { userId: n.userId, error: String(err?.message || err).slice(0, 200) });
          }
        }
      }
      db.setMeta(CURSOR_KEY, String(cursor));
      if (batch.length < BATCH) break;
    }
    return stats;
  })().finally(() => {
    running = null;
  });
  return running;
}
