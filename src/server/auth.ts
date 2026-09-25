import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type { User } from '../types/index';
import { computeEffectivePermissions, evaluatePermission, RoleDefinition, DEFAULT_ROLE_DEFINITIONS } from '../shared/rbac';
import type { NewsroomDatabase } from './db';
import type { AppConfig } from './config';

export const SESSION_COOKIE = 'nrcs_sid';
export const CSRF_HEADER = 'x-nrcs-client';
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), Number(n), Number(r), Number(p));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Dummy hash so unknown e-mails take as long as wrong passwords (no user enumeration by timing). */
let dummyHash: Promise<string> | null = null;
export function getDummyHash() {
  dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHash;
}

export function validatePasswordStrength(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `كلمة المرور يجب ألا تقل عن ${MIN_PASSWORD_LENGTH} أحرف`;
  }
  if (password.length > 200) return 'كلمة المرور طويلة جداً';
  if (!/[A-Za-z؀-ۿ]/.test(password) || !/\d/.test(password)) {
    return 'كلمة المرور يجب أن تحتوي على حروف وأرقام';
  }
  return null;
}

export function generatePassword(): string {
  return `${crypto.randomBytes(9).toString('base64url')}9a`;
}

export function newSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Only the SHA-256 of the token is stored, so a leaked database cannot hijack sessions. */
export function sessionIdFromToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    if (!key) return;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[key] = part.slice(idx + 1).trim();
    }
  });
  return out;
}

export interface AuthContext {
  user: User;
  sessionId: string;
  roles: RoleDefinition[];
  can: (permission: string) => boolean;
  permissions: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function loadRoles(db: NewsroomDatabase): RoleDefinition[] {
  const rows = db.listCollection('roles');
  return rows.length ? rows.map((r) => r.d as RoleDefinition) : DEFAULT_ROLE_DEFINITIONS;
}

export function buildAuthContext(db: NewsroomDatabase, user: User, sessionId: string): AuthContext {
  const roles = loadRoles(db);
  return {
    user,
    sessionId,
    roles,
    can: (permission: string) => evaluatePermission(user, permission, roles),
    permissions: computeEffectivePermissions(user, roles),
  };
}

export function setSessionCookie(res: Response, token: string, config: AppConfig) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionTtlMs,
  });
}

export function clearSessionCookie(res: Response, config: AppConfig) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/' });
}

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** Resolves the session cookie into req.auth (does not reject anonymous requests). */
export function sessionMiddleware(db: NewsroomDatabase, config: AppConfig) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return next();
    const sessionId = sessionIdFromToken(token);
    const session = db.getSession(sessionId);
    if (!session) return next();
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      db.deleteSession(sessionId);
      return next();
    }
    const userRow = db.getRow('users', session.userId);
    const user = userRow?.d as User | undefined;
    if (!user || user.isActive === false || user.deletedAt) {
      db.deleteSession(sessionId);
      return next();
    }
    if (Date.now() - new Date(session.lastSeenAt).getTime() > TOUCH_INTERVAL_MS) {
      db.touchSession(sessionId, config.sessionTtlMs);
    }
    req.auth = buildAuthContext(db, user, sessionId);
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ success: false, error: 'يجب تسجيل الدخول أولاً', code: 'UNAUTHENTICATED' });
  next();
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ success: false, error: 'يجب تسجيل الدخول أولاً', code: 'UNAUTHENTICATED' });
    if (!req.auth.can(permission)) {
      return res.status(403).json({ success: false, error: 'لا تملك صلاحية تنفيذ هذا الإجراء', code: 'FORBIDDEN' });
    }
    next();
  };
}

/**
 * CSRF defence: state-changing API calls must carry a custom header, which browsers
 * never attach to cross-site form posts and which cross-origin scripts cannot set
 * without a CORS preflight (and no CORS is enabled). SameSite=Lax cookies add a second layer.
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get(CSRF_HEADER) !== 'web') {
    return res.status(403).json({ success: false, error: 'طلب غير موثوق (CSRF)', code: 'CSRF' });
  }
  next();
}
