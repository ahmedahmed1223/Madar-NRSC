import express, { NextFunction, Request, Response } from 'express';
import compression from 'compression';
import crypto from 'crypto';
import type { AuditLog, Episode, User } from '../types/index';
import { DEMO_COLLECTIONS, demoInventory, demoUsersPresent, removeDemoData, seedDatabase } from './seed';
import type { AppConfig } from './config';
import type { NewsroomDatabase } from './db';
import { logger } from './logger';
import { createRateLimiter } from './rateLimit';
import { changeBus, MAX_OPS_PER_REQUEST, SyncService } from './sync';
import { generateBulletinMosXml, generateEpisodeMosXml } from './mos';
import type { Bulletin, BulletinStory } from '../shared/bulletins';
import { COPILOT_MODES, CopilotMode, isAiConfigured, runCopilot } from './ai';
import { generateTotpSecret, otpauthUrl, verifyTotp } from './totp';
import { MEDIA_FILE_URL_PREFIX, UploadError, receiveUpload, uploadsDir } from './uploads';
import path from 'path';
import fs from 'fs';
import {
  CSRF_HEADER,
  LOCKOUT_MS,
  MAX_FAILED_LOGINS,
  buildAuthContext,
  clearSessionCookie,
  csrfGuard,
  getDummyHash,
  hashPassword,
  newSessionToken,
  requireAuth,
  requirePermission,
  sessionIdFromToken,
  sessionMiddleware,
  setSessionCookie,
  validatePasswordStrength,
  verifyPassword,
} from './auth';
import { fetchFeed, getFeedStatus, parseFeed, pollWires } from './wires';
import { mailEnabled, notificationEmail, sendEmail, sendPush, vapidKeys } from './delivery';
import { newId } from '../shared/ids';
import { HISTORY_COLLECTIONS } from '../shared/collections';
import type { CollectionName, SyncOp } from '../shared/collections';

export const APP_VERSION = '3.9.0';
/** Identifies this server process (health checks show when several run behind one address). */
const INSTANCE_ID = crypto.randomBytes(4).toString('hex');

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
const wrap = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/** Security headers; the CSP forbids inline scripts, which neutralises stored-XSS payloads. */
function securityHeaders(config: AppConfig) {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
    // Vite's dev server injects inline scripts, so the CSP is only enforced for built assets.
    if (config.isProduction) res.setHeader('Content-Security-Policy', csp);
    if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

export function createApp(db: NewsroomDatabase, config: AppConfig) {
  const app = express();
  const sync = new SyncService(db, config.dataDir, config.newsActiveDays);

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(securityHeaders(config));
  app.use(compression({ filter: (req, res) => !req.path.endsWith('/stream') && compression.filter(req, res) }));

  // Request logging with correlation id.
  app.use('/api', (req, res, next) => {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => {
      if (req.path === '/health' || req.path.endsWith('/stream')) return;
      logger.info('request', {
        requestId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        ms: Date.now() - started,
        user: req.auth?.user.id,
      });
    });
    next();
  });

  const apiLimiter = createRateLimiter({
    windowMs: 60_000,
    max: config.rateLimitPerMinute,
    key: (req) => req.ip || 'unknown',
    message: 'عدد كبير من الطلبات، حاول لاحقاً',
  });
  // Per account+IP (so colleagues behind one NAT do not lock each other out) and a wider
  // per-IP ceiling against password spraying. Account lockout adds a third layer.
  const loginAccountLimiter = createRateLimiter({
    windowMs: 15 * 60_000,
    max: config.loginRateLimitPer15Min,
    key: (req) => `${req.ip}|${String(req.body?.email || '').trim().toLowerCase()}`,
    message: 'محاولات دخول كثيرة، يرجى الانتظار 15 دقيقة',
  });
  const loginIpLimiter = createRateLimiter({
    windowMs: 15 * 60_000,
    max: config.loginRateLimitPer15Min * 10,
    key: (req) => `${req.ip}`,
    message: 'محاولات دخول كثيرة من هذا العنوان، يرجى الانتظار 15 دقيقة',
  });

  app.use('/api', apiLimiter);
  app.use('/api', express.json({ limit: '5mb' }));
  app.use('/api', csrfGuard);
  app.use('/api', sessionMiddleware(db, config));

  const audit = (
    actor: Pick<User, 'id' | 'fullName' | 'role'> | null,
    actionType: string,
    targetEntity: string,
    targetId: string,
    severity: string,
    details: string,
    ip?: string
  ) => {
    const entry: AuditLog = {
      id: newId('aud'),
      userId: actor?.id || 'system',
      userName: actor?.fullName || 'النظام',
      userRole: (actor?.role || 'SUPER_ADMIN') as User['role'],
      actionType,
      targetEntity,
      targetId,
      severity,
      details,
      ipAddress: ip || 'unknown',
      timestamp: new Date().toISOString(),
    };
    db.writeRow('auditLogs', entry.id, entry, db.positionBounds('auditLogs').min - 1, actor?.id ?? null);
    changeBus.emit('rev', db.currentRev());
  };

  // --- Health ----------------------------------------------------------------

  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'ok', version: APP_VERSION, dbId: db.dbId, instance: INSTANCE_ID, timestamp: new Date().toISOString() });
  });

  app.get('/api/ready', (_req, res) => {
    const healthy = db.isHealthy();
    res.status(healthy ? 200 : 503).json({ status: healthy ? 'ready' : 'unavailable', database: healthy });
  });

  // --- Authentication ------------------------------------------------------

  const publicUser = (user: User, mustChangePassword: boolean, permissions: string[]) => ({
    user,
    mustChangePassword,
    permissions,
  });

  app.post(
    '/api/v1/auth/login',
    loginIpLimiter,
    loginAccountLimiter,
    wrap(async (req, res) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!email || !password) throw new HttpError(400, 'البريد الإلكتروني وكلمة المرور مطلوبان');

      const cred = db.getCredentialsByEmail(email);
      const invalid = new HttpError(401, 'البريد الإلكتروني أو كلمة المرور غير صحيحة', 'INVALID_CREDENTIALS');
      if (!cred) {
        await verifyPassword(password, await getDummyHash());
        throw invalid;
      }
      if (cred.lockedUntil && new Date(cred.lockedUntil).getTime() > Date.now()) {
        throw new HttpError(423, 'تم قفل الحساب مؤقتاً بسبب محاولات دخول فاشلة متكررة، حاول بعد 15 دقيقة', 'LOCKED');
      }
      const ok = await verifyPassword(password, cred.passwordHash);
      const user = db.getRow('users', cred.userId)?.d as User | undefined;
      if (!ok) {
        db.recordFailedLogin(cred.userId, MAX_FAILED_LOGINS, LOCKOUT_MS);
        audit(user ?? null, 'LOGIN_FAILED', 'USER', cred.userId, 'SECURITY', `محاولة دخول فاشلة للحساب ${email}`, req.ip);
        throw invalid;
      }
      if (!user || user.isActive === false || user.deletedAt) throw new HttpError(403, 'الحساب موقوف، يرجى مراجعة مدير النظام', 'INACTIVE');

      if (cred.totpEnabled && cred.totpSecret) {
        const code = typeof req.body?.totp === 'string' ? req.body.totp : '';
        if (!code) throw new HttpError(401, 'أدخل رمز التحقق من تطبيق المصادقة', 'TOTP_REQUIRED');
        const counter = verifyTotp(cred.totpSecret, code, cred.totpLastCounter);
        if (counter === null) {
          db.recordFailedLogin(cred.userId, MAX_FAILED_LOGINS, LOCKOUT_MS);
          audit(user, 'LOGIN_FAILED', 'USER', cred.userId, 'SECURITY', `رمز تحقق ثنائي خاطئ للحساب ${email}`, req.ip);
          throw new HttpError(401, 'رمز التحقق غير صحيح أو مستخدم مسبقاً', 'TOTP_INVALID');
        }
        db.setTotpLastCounter(cred.userId, counter);
      }

      db.resetFailedLogins(cred.userId);
      const token = newSessionToken();
      const session = db.createSession(sessionIdFromToken(token), user.id, config.sessionTtlMs, req.ip, req.get('user-agent'));
      const updatedUser = { ...user, lastLogin: new Date().toISOString() };
      db.writeRow('users', user.id, updatedUser, db.getRow('users', user.id)!.p, user.id);
      audit(user, 'LOGIN', 'USER', user.id, 'INFO', `تسجيل دخول ناجح: ${user.fullName}`, req.ip);
      setSessionCookie(res, token, config);
      const ctx = buildAuthContext(db, updatedUser, session.id);
      res.json({ success: true, ...publicUser(updatedUser, cred.mustChangePassword, ctx.permissions), trashRetentionDays: config.retention.trashDays });
    })
  );

  app.post('/api/v1/auth/logout', (req, res) => {
    if (req.auth) {
      db.deleteSession(req.auth.sessionId);
      audit(req.auth.user, 'LOGOUT', 'USER', req.auth.user.id, 'INFO', `تسجيل خروج: ${req.auth.user.fullName}`, req.ip);
    }
    clearSessionCookie(res, config);
    res.json({ success: true });
  });

  app.get('/api/v1/auth/me', requireAuth, (req, res) => {
    const cred = db.getCredentials(req.auth!.user.id);
    res.json({ success: true, ...publicUser(req.auth!.user, !!cred?.mustChangePassword, req.auth!.permissions), trashRetentionDays: config.retention.trashDays });
  });

  app.post(
    '/api/v1/auth/change-password',
    requireAuth,
    wrap(async (req, res) => {
      const { currentPassword, newPassword } = req.body ?? {};
      const user = req.auth!.user;
      const cred = db.getCredentials(user.id);
      if (!cred || typeof currentPassword !== 'string' || !(await verifyPassword(currentPassword, cred.passwordHash))) {
        throw new HttpError(400, 'كلمة المرور الحالية غير صحيحة');
      }
      const weak = validatePasswordStrength(newPassword);
      if (weak) throw new HttpError(400, weak);
      if (newPassword === currentPassword) throw new HttpError(400, 'يجب أن تختلف كلمة المرور الجديدة عن الحالية');
      db.setPassword(user.id, cred.email, await hashPassword(newPassword), false);
      db.deleteUserSessions(user.id, req.auth!.sessionId);
      audit(user, 'PASSWORD_CHANGE', 'USER', user.id, 'SECURITY', `قام ${user.fullName} بتغيير كلمة المرور`, req.ip);
      res.json({ success: true });
    })
  );

  app.post(
    '/api/v1/users/:id/password',
    requirePermission('users.create'),
    wrap(async (req, res) => {
      const target = db.getRow('users', req.params.id)?.d as User | undefined;
      if (!target) throw new HttpError(404, 'المستخدم غير موجود');
      if (target.role === 'SUPER_ADMIN' && req.auth!.user.role !== 'SUPER_ADMIN') {
        throw new HttpError(403, 'فقط مدير النظام العام يمكنه تعيين كلمة مرور مدير عام');
      }
      const weak = validatePasswordStrength(req.body?.password);
      if (weak) throw new HttpError(400, weak);
      const owner = db.getCredentialsByEmail(target.email.toLowerCase());
      if (owner && owner.userId !== target.id) throw new HttpError(409, 'البريد الإلكتروني مستخدم لحساب آخر');
      db.setPassword(target.id, target.email.toLowerCase(), await hashPassword(req.body.password), true);
      db.deleteUserSessions(target.id);
      audit(req.auth!.user, 'PASSWORD_RESET', 'USER', target.id, 'SECURITY', `تعيين كلمة مرور جديدة للمستخدم ${target.fullName}`, req.ip);
      res.json({ success: true });
    })
  );

  // --- Two-factor authentication (TOTP) --------------------------------------

  /** Keeps the user record's twoFactorEnabled flag in step with the credentials table. */
  const setTwoFactorFlag = (userId: string, enabled: boolean, actorId: string) => {
    const row = db.getRow('users', userId);
    if (row) {
      db.writeRow('users', userId, { ...row.d, twoFactorEnabled: enabled }, row.p, actorId);
      changeBus.emit('rev', db.currentRev());
    }
  };

  const requireCurrentPassword = async (userId: string, password: unknown) => {
    const cred = db.getCredentials(userId);
    if (!cred || typeof password !== 'string' || !(await verifyPassword(password, cred.passwordHash))) {
      throw new HttpError(400, 'كلمة المرور الحالية غير صحيحة');
    }
    return cred;
  };

  app.post(
    '/api/v1/auth/2fa/setup',
    requireAuth,
    wrap(async (req, res) => {
      const user = req.auth!.user;
      const cred = await requireCurrentPassword(user.id, req.body?.password);
      if (cred.totpEnabled) throw new HttpError(409, 'التحقق بخطوتين مفعّل مسبقاً');
      const secret = generateTotpSecret();
      db.setTotp(user.id, secret, false);
      const issuer = (db.getRow('settings', 'singleton')?.d as any)?.organizationNameEn || 'Madar NRCS';
      res.json({ success: true, secret, otpauthUrl: otpauthUrl(secret, cred.email, issuer) });
    })
  );

  app.post('/api/v1/auth/2fa/enable', requireAuth, (req, res) => {
    const user = req.auth!.user;
    const cred = db.getCredentials(user.id);
    if (!cred?.totpSecret) throw new HttpError(400, 'ابدأ إعداد التحقق بخطوتين أولاً');
    if (cred.totpEnabled) throw new HttpError(409, 'التحقق بخطوتين مفعّل مسبقاً');
    const counter = verifyTotp(cred.totpSecret, String(req.body?.code || ''));
    if (counter === null) throw new HttpError(400, 'رمز التحقق غير صحيح، تأكد من ضبط وقت الجهاز');
    db.setTotp(user.id, cred.totpSecret, true);
    db.setTotpLastCounter(user.id, counter);
    db.deleteUserSessions(user.id, req.auth!.sessionId);
    setTwoFactorFlag(user.id, true, user.id);
    audit(user, '2FA_ENABLED', 'USER', user.id, 'SECURITY', `تفعيل التحقق بخطوتين للحساب ${user.fullName}`, req.ip);
    res.json({ success: true });
  });

  app.post(
    '/api/v1/auth/2fa/disable',
    requireAuth,
    wrap(async (req, res) => {
      const user = req.auth!.user;
      const cred = await requireCurrentPassword(user.id, req.body?.password);
      if (!cred.totpEnabled || !cred.totpSecret) throw new HttpError(400, 'التحقق بخطوتين غير مفعّل');
      if (verifyTotp(cred.totpSecret, String(req.body?.code || ''), cred.totpLastCounter) === null) {
        throw new HttpError(400, 'رمز التحقق غير صحيح');
      }
      db.setTotp(user.id, null, false);
      setTwoFactorFlag(user.id, false, user.id);
      audit(user, '2FA_DISABLED', 'USER', user.id, 'SECURITY', `إلغاء التحقق بخطوتين للحساب ${user.fullName}`, req.ip);
      res.json({ success: true });
    })
  );

  /** Admin recovery when a user loses their authenticator device. */
  app.post('/api/v1/users/:id/2fa/reset', requirePermission('users.suspend_delete'), (req, res) => {
    const target = db.getRow('users', req.params.id)?.d as User | undefined;
    if (!target) throw new HttpError(404, 'المستخدم غير موجود');
    if (target.role === 'SUPER_ADMIN' && req.auth!.user.role !== 'SUPER_ADMIN') {
      throw new HttpError(403, 'فقط مدير النظام العام يمكنه إعادة ضبط حساب مدير عام');
    }
    db.setTotp(target.id, null, false);
    db.deleteUserSessions(target.id);
    setTwoFactorFlag(target.id, false, req.auth!.user.id);
    audit(req.auth!.user, '2FA_RESET', 'USER', target.id, 'SECURITY', `إلغاء التحقق بخطوتين للمستخدم ${target.fullName} من قبل الإدارة`, req.ip);
    res.json({ success: true });
  });

  // --- Media uploads ---------------------------------------------------------

  app.post(
    '/api/v1/media/upload',
    requirePermission('media.upload'),
    wrap(async (req, res) => {
      try {
        const record = await receiveUpload(req, db, config.dataDir, config.mediaMaxUploadBytes, req.auth!.user.id);
        res.status(201).json({
          success: true,
          data: {
            id: record.id,
            url: `${MEDIA_FILE_URL_PREFIX}${record.id}`,
            mimeType: record.mimeType,
            sizeBytes: record.sizeBytes,
            originalName: record.originalName,
          },
        });
      } catch (err) {
        if (err instanceof UploadError) throw new HttpError(err.status, err.message);
        throw err;
      }
    })
  );

  app.get('/api/v1/media/files/:id', requirePermission('media.view'), (req, res) => {
    const record = /^[A-Za-z0-9_\-]+$/.test(req.params.id) ? db.getUpload(req.params.id) : null;
    if (!record) throw new HttpError(404, 'الملف غير موجود');
    const filePath = path.join(uploadsDir(config.dataDir), record.storedName);
    if (!fs.existsSync(filePath)) throw new HttpError(404, 'الملف غير موجود');
    // Served as an inert document: never executed, never sniffed, cached privately.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(record.originalName)}`);
    res.type(record.mimeType);
    res.sendFile(filePath);
  });

  // --- Data synchronisation -------------------------------------------------

  app.get('/api/v1/data', requireAuth, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, dbId: db.dbId, ...sync.bootstrap(req.auth!) });
  });

  app.get('/api/v1/data/changes', requireAuth, (req, res) => {
    const since = Number(req.query.since);
    if (!Number.isInteger(since) || since < 0) throw new HttpError(400, 'since must be a non-negative integer');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, dbId: db.dbId, ...sync.changes(req.auth!, since) });
  });

  app.post('/api/v1/data/sync', requireAuth, (req, res) => {
    const ops = req.body?.ops;
    if (!Array.isArray(ops) || ops.length === 0) throw new HttpError(400, 'ops array is required');
    if (ops.length > MAX_OPS_PER_REQUEST) throw new HttpError(413, 'عدد العمليات في الطلب الواحد كبير جداً');
    const results = sync.apply(req.auth!, ops as SyncOp[], req.ip);
    res.json({ success: true, rev: db.currentRev(), dbId: db.dbId, results });
  });

  /** Server-Sent Events: tells browsers a new revision exists so they pull changes immediately. */
  app.get('/api/v1/data/stream', requireAuth, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 5000\nevent: rev\ndata: ${db.currentRev()}\n\n`);
    const onRev = (rev: number) => res.write(`event: rev\ndata: ${rev}\n\n`);
    const heartbeat = setInterval(() => res.write(`: ping\n\n`), 25_000);
    changeBus.on('rev', onRev);
    req.on('close', () => {
      clearInterval(heartbeat);
      changeBus.off('rev', onRev);
    });
  });

  // --- Revision history -----------------------------------------------------

  app.get('/api/v1/history/:collection/:id', requirePermission('news.view'), (req, res) => {
    const collection = req.params.collection as CollectionName;
    if (!HISTORY_COLLECTIONS.has(collection)) throw new HttpError(404, 'لا يوجد سجل نسخ لهذا النوع');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: db.listHistory(collection, req.params.id) });
  });

  // --- Broadcast exports ----------------------------------------------------

  app.get(['/api/v1/episodes/:id/export/mos', '/api/v1/episodes/:id/mos'], requirePermission('rundown.view'), (req, res) => {
    const episode = db.getRow('episodes', req.params.id)?.d as Episode | undefined;
    if (!episode || episode.deletedAt) throw new HttpError(404, 'الحلقة غير موجودة');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="episode_${encodeURIComponent(episode.id)}_mos.xml"`);
    res.send(generateEpisodeMosXml(episode));
  });

  app.get('/api/v1/bulletins/:id/mos', requirePermission('rundown.view'), (req, res) => {
    const bulletin = db.getRow('bulletins', req.params.id)?.d as Bulletin | undefined;
    if (!bulletin || bulletin.deletedAt) throw new HttpError(404, 'النشرة غير موجودة');
    const stories = db.listCollection('bulletinStories').map((r) => r.d).filter((s: any) => s?.bulletinId === bulletin.id && !s.deletedAt);
    const media = db.listCollection('media').map((r) => r.d);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bulletin_${encodeURIComponent(bulletin.id)}_mos.xml"`);
    res.send(generateBulletinMosXml(bulletin, stories as BulletinStory[], media));
  });

  // --- News archive (settled news outside the synced working set) ------------

  const archiveCutoff = () =>
    new Date(Date.now() - (config.newsActiveDays > 0 ? config.newsActiveDays : 36500) * 24 * 60 * 60 * 1000).toISOString();

  app.get('/api/v1/archive/news', requirePermission('news.view'), (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
    const page = Math.max(1, Math.min(1000, Number(req.query.page) || 1));
    const pageSize = 25;
    const result = db.searchNewsArchive(archiveCutoff(), q, pageSize, (page - 1) * pageSize);
    res.json({ success: true, data: { ...result, page, pageSize, activeDays: config.newsActiveDays } });
  });

  app.get('/api/v1/archive/news/:id', requirePermission('news.view'), (req, res) => {
    const row = db.getRow('news', String(req.params.id));
    if (!row || row.d?.deletedAt) throw new HttpError(404, 'الخبر غير موجود في الأرشيف');
    res.json({ success: true, data: row.d });
  });

  /** Brings an archived story back into the synced newsroom (e.g. to update or republish it). */
  app.post('/api/v1/archive/news/:id/reactivate', requirePermission('news.edit_any'), (req, res) => {
    const id = String(req.params.id);
    const row = db.getRow('news', id);
    if (!row || row.d?.deletedAt) throw new HttpError(404, 'الخبر غير موجود في الأرشيف');
    const now = new Date().toISOString();
    db.writeRow('news', id, { ...row.d, updatedAt: now }, row.p, req.auth!.user.id);
    audit(req.auth!.user, 'NEWS_REACTIVATE', 'NEWS', id, 'INFO', `إعادة خبر من الأرشيف إلى غرفة الأخبار: ${row.d.title}`, req.ip);
    changeBus.emit('rev', db.currentRev());
    res.json({ success: true });
  });

  // --- Agency wire feeds -----------------------------------------------------

  app.get('/api/v1/wires/status', requirePermission('news.view'), (_req, res) => {
    res.json({ success: true, data: { pollMinutes: config.wires.pollMinutes, retentionDays: config.wires.retentionDays, feeds: getFeedStatus() } });
  });

  const wireRefreshLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 6,
    key: (req) => req.auth?.user.id || req.ip || 'unknown',
    message: 'تم تحديث البرقيات قبل قليل، حاول بعد دقيقة',
  });

  app.post(
    '/api/v1/wires/refresh',
    requirePermission('news.create'),
    wireRefreshLimiter,
    wrap(async (_req, res) => {
      const feeds = await pollWires(db, config.wires);
      res.json({ success: true, data: { feeds } });
    })
  );

  app.post(
    '/api/v1/wires/test',
    requirePermission('system.settings'),
    wireRefreshLimiter,
    wrap(async (req, res) => {
      const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
      if (!url) throw new HttpError(400, 'رابط الخلاصة مطلوب');
      try {
        const feed = parseFeed(await fetchFeed(url, config.wires.allowPrivateHosts));
        res.json({ success: true, data: { title: feed.title, itemCount: feed.items.length, sample: feed.items.slice(0, 3).map((i) => i.title) } });
      } catch (err: any) {
        const message = err?.name === 'TimeoutError' ? 'انتهت مهلة الاتصال بمصدر الخلاصة' : String(err?.message || err);
        throw new HttpError(422, message, 'FEED_INVALID');
      }
    })
  );

  // --- Notification delivery (Web Push + e-mail) ------------------------------

  const notifyTestLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 5,
    key: (req) => req.auth?.user.id || req.ip || 'unknown',
    message: 'أُرسل تنبيه تجريبي قبل قليل، حاول بعد دقيقة',
  });

  app.get('/api/v1/notifications/delivery', requireAuth, (req, res) => {
    const devices = db.listPushSubscriptions(req.auth!.user.id).map((s) => ({ endpoint: s.endpoint, userAgent: s.userAgent, createdAt: s.createdAt }));
    res.json({
      success: true,
      data: {
        email: mailEnabled(config),
        emailAddress: req.auth!.user.email,
        push: config.deliverySeconds > 0,
        publicKey: vapidKeys(db, config).publicKey,
        devices,
      },
    });
  });

  app.post('/api/v1/notifications/push/subscribe', requireAuth, (req, res) => {
    const sub = req.body?.subscription;
    const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : '';
    const p256dh = sub?.keys?.p256dh;
    const authKey = sub?.keys?.auth;
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || typeof p256dh !== 'string' || typeof authKey !== 'string' || p256dh.length > 200 || authKey.length > 100) {
      throw new HttpError(400, 'اشتراك التنبيهات غير صالح');
    }
    if (db.listPushSubscriptions(req.auth!.user.id).length >= 10) throw new HttpError(400, 'سجّلت عشرة أجهزة؛ احذف جهازاً قديماً أولاً');
    db.savePushSubscription(req.auth!.user.id, { endpoint, p256dh, auth: authKey }, req.get('user-agent'));
    res.json({ success: true });
  });

  app.post('/api/v1/notifications/push/unsubscribe', requireAuth, (req, res) => {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
    db.deletePushSubscription(endpoint, req.auth!.user.id);
    res.json({ success: true });
  });

  app.post(
    '/api/v1/notifications/test',
    requireAuth,
    notifyTestLimiter,
    wrap(async (req, res) => {
      const user = req.auth!.user;
      const channel = req.body?.channel === 'email' ? 'email' : 'push';
      if (channel === 'push') {
        const sent = await sendPush(db, config, user.id, { title: 'تنبيه تجريبي من مدار', body: 'وصلت التنبيهات إلى هذا الجهاز بنجاح.', url: '/', tag: 'test' });
        if (!sent) throw new HttpError(422, 'لم يصل التنبيه: لا يوجد جهاز مسجّل أو رفضه متصفحك', 'PUSH_FAILED');
        res.json({ success: true, data: { sent } });
        return;
      }
      if (!mailEnabled(config)) throw new HttpError(422, 'البريد غير مهيأ على الخادم (SMTP_HOST)', 'MAIL_DISABLED');
      try {
        await sendEmail(config, user.email, notificationEmail({ title: 'رسالة تجريبية', message: 'وصل بريد التنبيهات إليك بنجاح.', category: 'system' }, config));
      } catch (err: any) {
        throw new HttpError(502, `تعذر إرسال البريد: ${String(err?.message || err).slice(0, 200)}`, 'MAIL_FAILED');
      }
      res.json({ success: true, data: { sent: 1 } });
    })
  );

  // --- AI co-pilot ----------------------------------------------------------

  app.get('/api/v1/ai/status', requireAuth, (_req, res) => {
    res.json({ success: true, configured: isAiConfigured(config), model: config.gemini.model });
  });

  const aiLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 20,
    key: (req) => req.auth?.user.id || req.ip || 'unknown',
    message: 'تم تجاوز حد طلبات المساعد الذكي، حاول بعد دقيقة',
  });

  app.post(
    '/api/v1/ai/copilot',
    requireAuth,
    aiLimiter,
    wrap(async (req, res) => {
      if (!req.auth!.can('news.create') && !req.auth!.can('news.edit_any')) throw new HttpError(403, 'لا تملك صلاحية استخدام المساعد التحريري');
      if (!isAiConfigured(config)) throw new HttpError(503, 'المساعد الذكي غير مفعّل على الخادم (GEMINI_API_KEY)', 'AI_NOT_CONFIGURED');
      const mode = req.body?.mode as CopilotMode;
      if (!COPILOT_MODES.includes(mode)) throw new HttpError(400, 'وضع غير مدعوم');
      try {
        const result = await runCopilot(config, {
          mode,
          tone: String(req.body?.tone || ''),
          title: String(req.body?.title || ''),
          summary: String(req.body?.summary || ''),
          content: String(req.body?.content || ''),
        });
        res.json({ success: true, data: result });
      } catch (err: any) {
        logger.error('gemini request failed', { error: String(err?.message || err) });
        throw new HttpError(502, 'تعذر الحصول على رد من خدمة الذكاء الاصطناعي، حاول مجدداً');
      }
    })
  );

  // --- Database administration ---------------------------------------------

  const dbAdmin = requirePermission('system.database_manage');

  app.get('/api/v1/db/stats', dbAdmin, (_req, res) => {
    res.json({
      success: true,
      data: { ...db.stats(), sqlConsoleEnabled: config.enableSqlConsole, resetEnabled: config.allowDbReset },
    });
  });

  app.get('/api/v1/db/export', dbAdmin, (req, res) => {
    const buffer = db.serialize();
    audit(req.auth!.user, 'DB_EXPORT', 'DATABASE', 'newsroom', 'SECURITY', 'تنزيل نسخة كاملة من قاعدة البيانات', req.ip);
    res.setHeader('Content-Type', 'application/x-sqlite3');
    res.setHeader('Content-Disposition', `attachment; filename="newsroom_${new Date().toISOString().slice(0, 10)}.sqlite"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  });

  app.post('/api/v1/db/query', dbAdmin, (req, res) => {
    if (!config.enableSqlConsole) throw new HttpError(403, 'وحدة استعلامات SQL معطلة في بيئة الإنتاج (ENABLE_SQL_CONSOLE)', 'DISABLED');
    const query = req.body?.query;
    if (typeof query !== 'string' || !query.trim()) throw new HttpError(400, 'نص الاستعلام مطلوب');
    try {
      const result = db.runReadOnlyQuery(query);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.json({
        success: false,
        data: { columns: ['Error'], values: [[err.message]], rowCount: 0, executionTimeMs: 0, error: err.message },
      });
    }
  });

  app.post(
    '/api/v1/db/reset',
    dbAdmin,
    wrap(async (req, res) => {
      if (!config.allowDbReset) throw new HttpError(403, 'إعادة تهيئة قاعدة البيانات معطلة في بيئة الإنتاج (ALLOW_DB_RESET)', 'DISABLED');
      await db.createBackup('prerestore', config.backupRetention);
      db.deleteCollections(DEMO_COLLECTIONS.map(([c]) => c) as CollectionName[]);
      db.setMeta('demo_seeded', '0');
      db.setMeta('demo_removed', '0');
      await seedDatabase(db, config);
      audit(req.auth!.user, 'DB_RESET', 'DATABASE', 'newsroom', 'SECURITY', 'إعادة تهيئة بيانات المحتوى', req.ip);
      changeBus.emit('rev', db.currentRev());
      res.json({ success: true, message: 'تمت إعادة تهيئة قاعدة البيانات بنجاح', data: db.stats() });
    })
  );

  // Demo data: what is left of it, and removing it for good.
  app.get('/api/v1/admin/demo-data', requirePermission('system.settings'), (req, res) => {
    const inventory = demoInventory(db);
    res.json({
      success: true,
      data: {
        counts: Object.fromEntries(Object.entries(inventory).map(([c, ids]) => [c, ids!.length])),
        users: demoUsersPresent(db, req.auth!.user.id),
        removed: db.getMeta('demo_removed') === '1',
      },
    });
  });

  app.post(
    '/api/v1/admin/demo-data/remove',
    requirePermission('system.settings'),
    wrap(async (req, res) => {
      if (req.body?.confirm !== 'حذف') throw new HttpError(400, 'اكتب كلمة «حذف» للتأكيد');
      await db.createBackup('prerestore', config.backupRetention);
      const removed = removeDemoData(db, { includeUsers: req.body?.includeUsers === true, actingUserId: req.auth!.user.id });
      const total = Object.values(removed).reduce((a, b) => a + b, 0);
      audit(req.auth!.user, 'DEMO_DATA_REMOVED', 'DATABASE', 'newsroom', 'SECURITY', `حذف البيانات التجريبية (${total} سجلاً)`, req.ip);
      changeBus.emit('rev', db.currentRev());
      res.json({ success: true, data: { removed, total } });
    })
  );

  app.get('/api/v1/db/backups', dbAdmin, (_req, res) => {
    res.json({ success: true, data: db.listBackups() });
  });

  app.post(
    '/api/v1/db/backups',
    dbAdmin,
    wrap(async (req, res) => {
      const backup = await db.createBackup(undefined, config.backupRetention);
      audit(req.auth!.user, 'DB_BACKUP', 'DATABASE', backup.fileName, 'INFO', `إنشاء نسخة احتياطية ${backup.fileName}`, req.ip);
      res.json({ success: true, message: 'تم إنشاء نسخة احتياطية بنجاح', data: backup });
    })
  );

  app.post(
    '/api/v1/db/backups/restore',
    dbAdmin,
    wrap(async (req, res) => {
      const fileName = req.body?.fileName;
      if (typeof fileName !== 'string' || !fileName) throw new HttpError(400, 'اسم ملف النسخة الاحتياطية مطلوب');
      const actor = req.auth!.user;
      try {
        await db.restoreBackup(fileName, config.backupRetention);
      } catch (err: any) {
        throw new HttpError(400, err?.message || 'تعذرت استعادة النسخة الاحتياطية');
      }
      audit(actor, 'DB_RESTORE', 'DATABASE', fileName, 'SECURITY', `استعادة قاعدة البيانات من ${fileName}`, req.ip);
      changeBus.emit('rev', db.currentRev());
      res.json({ success: true, message: 'تمت استعادة النسخة الاحتياطية بنجاح', data: db.stats() });
    })
  );

  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: 'المسار غير موجود', code: 'NOT_FOUND' });
  });

  // Central error handler: never leak internals to clients.
  app.use('/api', (err: any, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ success: false, error: err.message, code: err.code });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ success: false, error: 'حجم الطلب أكبر من المسموح', code: 'TOO_LARGE' });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ success: false, error: 'صيغة JSON غير صالحة', code: 'BAD_JSON' });
    }
    logger.error('unhandled error', { path: req.originalUrl, error: String(err?.stack || err) });
    res.status(500).json({ success: false, error: 'حدث خطأ داخلي في الخادم', code: 'INTERNAL' });
  });

  return { app, limiters: { apiLimiter, loginAccountLimiter, loginIpLimiter, aiLimiter } };
}

export { CSRF_HEADER };
