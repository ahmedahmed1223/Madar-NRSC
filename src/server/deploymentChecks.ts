import type { AppConfig } from './config';
import type { NewsroomDatabase } from './db';
import { verifyPassword } from './auth';

/**
 * Accounts found still signing in with the shared demo password, with the hash checked, so the
 * warning disappears as soon as the password is changed (no new scrypt run per overview request).
 */
const demoPasswordHashes = new Map<string, string>();

/** Checks every account against DEMO_USER_PASSWORD (once at start-up; scrypt is slow on purpose). */
export async function scanDemoPasswords(db: NewsroomDatabase, config: AppConfig, limit = 300) {
  demoPasswordHashes.clear();
  if (db.getMeta('demo_seeded') !== '1' && !config.seedDemoData) return 0;
  const users = db.listCollection('users').map((r) => r.d).filter((u) => u && !u.deletedAt && u.isActive !== false).slice(0, limit);
  for (const user of users) {
    const cred = db.getCredentials(user.id);
    if (cred && (await verifyPassword(config.demoUserPassword, cred.passwordHash))) demoPasswordHashes.set(user.id, cred.passwordHash);
  }
  return demoPasswordHashes.size;
}

/** Accounts still on the demo password (those whose password changed since the scan drop out). */
export function demoPasswordAccounts(db: NewsroomDatabase): { id: string; fullName: string }[] {
  const out: { id: string; fullName: string }[] = [];
  for (const [userId, hash] of demoPasswordHashes) {
    const user = db.getRow('users', userId)?.d;
    if (user && !user.deletedAt && user.isActive !== false && db.getCredentials(userId)?.passwordHash === hash) out.push({ id: userId, fullName: user.fullName });
  }
  return out;
}

export interface DeploymentWarning {
  level: 'error' | 'warning';
  /** Arabic, for «مراقبة النظام». */
  text: string;
  /** English, for the server log. */
  log: string;
}

/** Deployment settings that put a production installation at risk (logged at start-up, shown in «مراقبة النظام»). */
export function deploymentWarnings(db: NewsroomDatabase, config: AppConfig): DeploymentWarning[] {
  const out: DeploymentWarning[] = [];
  if (config.isProduction) {
    if (config.seedDemoData) out.push({ level: 'error', text: 'البيانات التجريبية مفعّلة على خادم إنتاج (ALLOW_DEMO_IN_PRODUCTION)؛ كلمة مرور الحسابات التجريبية منشورة في صفحة الدخول.', log: 'demo data is enabled in production (ALLOW_DEMO_IN_PRODUCTION=true): demo accounts share a published password' });
    if (!config.cookieSecure) out.push({ level: 'error', text: 'كوكي الجلسة غير آمنة (COOKIE_SECURE=false)؛ شغّل النظام خلف HTTPS وأعد تفعيلها.', log: 'COOKIE_SECURE=false in production: session cookies travel without HTTPS protection' });
    if (!config.appUrl) out.push({ level: 'warning', text: 'عنوان النظام APP_URL غير مضبوط؛ روابط البريد والتنبيهات لن تفتح النظام.', log: 'APP_URL is not set: links in e-mails and push notifications cannot point at the system' });
    if (!config.timeZone) out.push({ level: 'warning', text: 'المنطقة الزمنية للخادم (TZ) غير مضبوطة؛ يعمل الخادم بتوقيت UTC في السجلات والمهام الدورية.', log: 'TZ is not set: the server runs on UTC for logs and scheduled jobs' });
  }
  const demo = demoPasswordAccounts(db);
  if (demo.length) {
    out.push({ level: config.isProduction ? 'error' : 'warning', text: `${demo.length} من الحسابات ما زالت تستخدم كلمة المرور التجريبية المنشورة (${demo.slice(0, 5).map((u) => u.fullName).join('، ')}${demo.length > 5 ? '…' : ''}).`, log: `${demo.length} account(s) still use the demo password` });
  }
  return out;
}
