import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type { User } from '../types/index';
import { computeEffectivePermissions, evaluatePermission, findUserRole, RoleDefinition, DEFAULT_ROLE_DEFINITIONS } from '../shared/rbac';
import { allowsModule, type ModuleId } from '../shared/moduleAccess';
import type { NewsroomDatabase } from './db';
import type { AppConfig } from './config';
import { MIN_PASSWORD_LENGTH, temporaryPassword, validatePasswordStrength } from '../shared/passwords';
import { cardProductionAssignment, type ProductionCard } from '../shared/productionCards';
import { assignedWorkOnly } from '../shared/assignedWork';
import { departmentsOf, departmentWorkScope } from '../shared/departments';

export const SESSION_COOKIE = 'nrcs_sid';
export const CSRF_HEADER = 'x-nrcs-client';
export { MIN_PASSWORD_LENGTH };
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

export { validatePasswordStrength };

/** Generated passwords (first administrator, temporary passwords): no characters that read alike (I l 1 O 0). */
export function generatePassword(): string {
  return temporaryPassword((n) => new Uint32Array(crypto.randomBytes(n * 4).buffer));
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
  moduleAllowed?: (id: ModuleId) => boolean;
  productionAssignments?: () => ReadonlySet<string>;
  departmentTaskMembers?: () => ReadonlySet<string> | null;
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
  const roleId = findUserRole(user, roles)?.id;
  const settings = db.getRow('settings', 'singleton')?.d;
  const moduleAllowed = (id: ModuleId) => allowsModule(settings?.moduleAccess, id, user.id, roleId);
  const decisions = new Map<string, boolean>();
  const can = (permission: string) => {
    let allowed = decisions.get(permission);
    if (allowed === undefined) {
      allowed = evaluatePermission(user, permission, roles);
      decisions.set(permission, allowed);
    }
    return allowed;
  };
  let assignments: Set<string> | undefined;
  let team: ReadonlySet<string> | null | undefined;
  return {
    user,
    sessionId,
    roles,
    can,
    permissions: computeEffectivePermissions(user, roles),
    moduleAllowed,
    departmentTaskMembers: () => {
      if (team !== undefined) return team;
      if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' || assignedWorkOnly(can)) return team = null;
      const scope = departmentWorkScope(user.id, departmentsOf(settings));
      if (!scope.led.length) return team = null;
      return team = new Set(db.listCollection('users').filter(row => scope.departmentFor(row.d)).map(row => row.id));
    },
    productionAssignments: () => {
      if (assignments) return assignments;
      assignments = new Set();
      if (!moduleAllowed('assignments') || can('rundown.view') || !can('cards.view') || assignedWorkOnly(can)) return assignments;
      for (const { d } of db.listCollection('productionCards')) {
        const target = cardProductionAssignment(d as ProductionCard, user.id);
        if (target && (moduleAllowed('programmes') || !target.startsWith('episode:'))) assignments.add(target);
      }
      return assignments;
    },
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

/** Meta key holding when a temporary password (issued by an administrator) stops working. */
export const tempPasswordKey = (userId: string) => `temp_password_expires:${userId}`;

/** Marks the password just set by an administrator as temporary for `hours`; pass 0 to clear the mark. */
export function markTemporaryPassword(db: NewsroomDatabase, userId: string, hours: number, now = Date.now()) {
  db.setMeta(tempPasswordKey(userId), hours > 0 ? new Date(now + hours * 3600_000).toISOString() : '');
}

/** A temporary password that was not replaced in time no longer opens the account. */
export function temporaryPasswordExpired(db: NewsroomDatabase, userId: string, now = Date.now()): boolean {
  const at = db.getMeta(tempPasswordKey(userId));
  return !!at && Number.isFinite(Date.parse(at)) && Date.parse(at) <= now;
}

/** What a signed-in user may still reach while their password must be changed. */
const OPEN_WHILE_PASSWORD_CHANGE = new Set(['/api/v1/auth/me', '/api/v1/auth/logout', '/api/v1/auth/change-password']);

/**
 * Enforces «change your password» on the server: while the account carries a temporary password
 * (or the first administrator's), every API call but the three above answers 403
 * PASSWORD_CHANGE_REQUIRED, so the temporary password never works for real work.
 */
export function passwordChangeGuard(db: NewsroomDatabase) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return next();
    const cred = db.getCredentials(req.auth.user.id);
    if (!cred?.mustChangePassword) return next();
    if (temporaryPasswordExpired(db, req.auth.user.id)) {
      db.deleteUserSessions(req.auth.user.id);
      return res.status(401).json({ success: false, error: 'انتهت صلاحية كلمة المرور المؤقتة؛ اطلب من مدير النظام إصدار كلمة جديدة', code: 'TEMP_PASSWORD_EXPIRED' });
    }
    const path = req.originalUrl.split('?')[0];
    if (OPEN_WHILE_PASSWORD_CHANGE.has(path)) return next();
    return res.status(403).json({ success: false, error: 'غيّر كلمة المرور المؤقتة أولاً لمتابعة العمل', code: 'PASSWORD_CHANGE_REQUIRED' });
  };
}
