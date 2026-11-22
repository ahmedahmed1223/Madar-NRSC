import { createHash, timingSafeEqual } from 'node:crypto';
import { newId } from '../shared/ids';
import { validatePasswordStrength } from '../shared/passwords';
import type { LoginSetupMode } from '../shared/setup';
import type { User } from '../types';
import { hashPassword } from './auth';
import type { AppConfig } from './config';
import type { NewsroomDatabase } from './db';

const INSTALLATION = 'first_administrator_setup';
const PENDING = 'pending';

function hasNoAccounts(db: NewsroomDatabase) {
  return db.countCredentials() === 0 && db.countCollection('users') === 0;
}

/** The seed path calls this only when creating the initial settings. */
export function prepareBrowserSetup(db: NewsroomDatabase, config: AppConfig) {
  if (config.installSetupToken && !db.getMeta(INSTALLATION) && hasNoAccounts(db)) {
    db.setMeta(INSTALLATION, PENDING);
  }
}

export function browserSetupAvailable(db: NewsroomDatabase, config: AppConfig) {
  return !!config.installSetupToken && db.getMeta(INSTALLATION) === PENDING && hasNoAccounts(db);
}

export function closeBrowserSetup(db: NewsroomDatabase) {
  if (db.getMeta(INSTALLATION) === PENDING) db.setMeta(INSTALLATION, 'completed');
}

export async function loginSetupMode(db: NewsroomDatabase, config: AppConfig, hasDemoAdministrator: () => Promise<boolean>): Promise<LoginSetupMode> {
  if (browserSetupAvailable(db, config)) return 'browser';
  if (!db.getMeta('setup_review')) return null;
  if (config.seedDemoData && await hasDemoAdministrator()) return 'demo';
  if (db.countCredentials() !== 1) return null;
  const hasInitialAdmin = db.listCollection('users')
    .some(({ id, d }) => d.role === 'SUPER_ADMIN' && d.isActive !== false && !d.deletedAt && db.getCredentials(id)?.mustChangePassword);
  return hasInitialAdmin ? 'sign-in' : null;
}

function verifyToken(expected: string, given: unknown) {
  if (typeof given !== 'string' || given.length > 200) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(expected), digest(given.trim()));
}

type ClaimResult = { status: 201 } | { status: 400 | 403 | 409; error: string };
const setupClosed = { status: 409, error: 'انتهت مرحلة إنشاء المسؤول الأول. سجّل الدخول بحساب الإدارة.' } as const;

export async function createFirstAdministrator(
  db: NewsroomDatabase,
  config: AppConfig,
  body: { token?: unknown; fullName?: unknown; email?: unknown; password?: unknown } | undefined,
  auditCreated: (user: User) => void,
): Promise<ClaimResult> {
  if (!config.installSetupToken || !browserSetupAvailable(db, config)) return setupClosed;
  if (!verifyToken(config.installSetupToken, body?.token)) return { status: 403, error: 'رمز إعداد الخادم غير صحيح' };

  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!fullName || fullName.length > 120 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: 400, error: 'أدخل اسم المسؤول وبريداً إلكترونياً صالحاً' };
  }
  const weak = validatePasswordStrength(password);
  if (weak) return { status: 400, error: weak };
  const hash = await hashPassword(password);

  return db.transaction(() => {
    if (!browserSetupAvailable(db, config)) return setupClosed;
    const user: User = {
      id: newId('usr'),
      fullName,
      email,
      role: 'SUPER_ADMIN',
      avatarUrl: '/icon.svg',
      jobTitle: 'مدير النظام',
      department: 'غرفة التحرير',
      departmentId: 'newsroom',
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    db.writeRow('users', user.id, user, -1, null);
    db.setPassword(user.id, email, hash, false);
    closeBrowserSetup(db);
    auditCreated(user);
    return { status: 201 };
  });
}
