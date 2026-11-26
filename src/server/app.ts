import { sanitizeDateSettings } from '../shared/dateFormat';
import { APP_VERSION } from '../shared/releaseVersion';
import { correctionTarget, createNewsCorrection, NewsCorrectionError } from './newsCorrections';
import { shiftHandoverRouter } from './shiftHandovers';
import { permissionsWorkspaceRouter } from './permissionsWorkspace';
import express, { NextFunction, Request, Response } from 'express';
import compression from 'compression';
import crypto from 'crypto';
import type { AuditLog, Episode, User } from '../types/index';
import { DEMO_COLLECTIONS, createDemoAccountReader, demoInventory, demoUsersPresent, removeDemoData, seedDatabase } from './seed';
import { createFirstAdministrator, loginSetupMode } from './loginSetup';
import { AI_PROVIDERS, type AiProvider, type AppConfig } from './config';
import type { NewsroomDatabase } from './db';
import { logger, getRecentErrors, errorJournalHealth } from './logger';
import { withRequestCorrelation, currentCorrelationId } from './requestCorrelation';
import { backupStatus } from './databaseDiagnostics';
import { databaseOperationLock, DatabaseOperationBusy, rehearseBackup } from './databaseRecovery';
import { DatabaseConfirmations, ConfirmationFailures } from './databaseConfirmation';
import { reconcileBackupIncidents } from './backupIncidents';
import { createRateLimiter } from './rateLimit';
import { changeBus, isValidCollectionPageCursor, MAX_OPS_PER_REQUEST, SyncService } from './sync';
import { canRead } from './policy';
import { assignedWorkOnly } from '../shared/assignedWork';
import { canPinAnnouncement, canonicalMessageChannel } from '../shared/chat';
import { departmentsOf } from '../shared/departments';
import { generateBulletinMosXml, generateEpisodeMosXml } from './mos';
import { evaluateBulletinReadiness } from '../shared/bulletinReadiness';
import { firstMediaRightsBlocker, plannedMediaAirAt, segmentMediaIds } from '../shared/mediaEditorial';
import type { Bulletin, BulletinStory } from '../shared/bulletins';
import { COPILOT_MODES, type CopilotMode, canUseCopilot, getAiStatus, runCopilot } from './ai';
import { moduleAllowed, requireModule } from './moduleAccess';
import { canDownloadLinkedMedia } from './linkedMedia';
import { MODULE_UNAVAILABLE, moduleForScreen } from '../shared/moduleAccess';
import { createAiBudget } from './aiBudget';
import { generateTotpSecret, otpauthUrl, verifyTotp } from './totp';
import { OfflineAirError, prepareOfflinePacket } from './offlineAir';
import { importOfflineSession } from './offlineAirSessions';
import { applyOfflineDraft, offlineDraftTarget } from './offlineAirDrafts';
import { MEDIA_FILE_URL_PREFIX, UploadError, receiveUpload, uploadsDir } from './uploads';
import { externalIntakeRouter } from './externalIntake';
import { databaseEngineStatus, readDatabaseEngineState, scheduleDatabaseEngine } from './databaseEngineState';
import { createResumableUploadRouter } from './resumableUploads';
import { mediaTranscriptionRouter } from './mediaTranscription';
import { messageActionsRouter } from './messageActions';
import { queueCopiesForUpload, registerStorageRoutes, sendStoredFile } from './storage';
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
  markTemporaryPassword,
  parseCookies,
  passwordChangeGuard,
  SESSION_COOKIE,
  temporaryPasswordExpired,
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
import { HISTORY_COLLECTIONS, PAGED_BOOTSTRAP_COLLECTIONS, SINGLETON_ID, isCollectionName } from '../shared/collections';
import { adminOverview } from './adminOverview';
import { createFullBackup, lastVerifiedExternalBackup } from './backupDelivery';
import { removeStation, StationRemovalError, stationUsage } from './stationRemoval';
import { applyDepartmentSettings } from '../shared/departments';
import { rememberStationSettings, stationsOf } from '../shared/stations';
import { searchArchive } from './archiveSearch';
import { listNewsReportRecords, summarizeNewsReport } from './newsReport';
import { readDepartmentWork } from './departmentWork';
import { canOpenScreen } from '../shared/screens';
import { findUserRole } from '../shared/rbac';
import { createAppUpdates } from './appUpdates';
import { isNewerVersion, type AppUpdateStatus } from '../shared/appUpdates';
import { CHAT_UPLOAD_TYPES, canReadMessage, isInlineChatType, parseChannel } from '../shared/chat';
import type { CollectionName, SyncOp } from '../shared/collections';

export { APP_VERSION };

/** Devices one person may stay signed in on; the least recently used sign-in ends beyond that. */
export const MAX_SESSIONS_PER_USER = 10;
/** Identifies this server process (health checks show when several run behind one address). */
const INSTANCE_ID = crypto.randomBytes(4).toString('hex');

/** API routes use named parameters only (no wildcards), so every parameter is a single string. */
type ApiRequest = Request<Record<string, string>>;
type AsyncHandler = (req: ApiRequest, res: Response, next: NextFunction) => Promise<unknown>;
const wrap = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => fn(req as ApiRequest, res, next).catch(next);

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

function denyAssignedOnlyScope(auth: { can: (permission: string) => boolean }) {
  if (assignedWorkOnly(auth.can)) throw new HttpError(403, 'هذا المسار غير متاح للحسابات المقيّدة بالعمل المسند');
}

/** Security headers; the CSP forbids inline scripts, which neutralises stored-XSS payloads. */
function securityHeaders(config: AppConfig) {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
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
  // Shared helpers (department names, station archive and groups) follow the stored settings.
  applyDepartmentSettings(db.getRow('settings', 'singleton')?.d);
  rememberStationSettings(db.getRow('settings', 'singleton')?.d);
  const sync = new SyncService(db, config.dataDir, config.newsActiveDays,
    config.mediaTranscriptionAuto ? { video: !!config.mediaTranscription?.ffmpeg } : undefined);
  const updates = createAppUpdates(config.updates, db);
  const broadcastActive = () => db.listCollection('onAir').some(row => ['LIVE', 'RUNNING', 'PAUSED'].includes(String(row.d?.status)));
  let draining = false;
  const streams = new Set<Response>();
  app.locals.beginShutdown = () => {
    draining = true;
    for (const stream of streams) stream.end();
    streams.clear();
  };

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
    withRequestCorrelation(requestId, next);
  });

  const apiLimiter = createRateLimiter({
    windowMs: 60_000,
    max: config.rateLimitPerMinute,
    key: (req) => req.auth?.user.id ? `user:${req.auth.user.id}` : `ip:${req.ip || 'unknown'}`,
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

  // Probes bypass user traffic limits and session processing.
  // Anonymous callers learn only that the server is up; the database and process identity
  // (for spotting several instances behind one address) are for signed-in colleagues.
  app.get('/api/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const session = token ? db.getSession(sessionIdFromToken(token)) : null;
    const signedIn = !!session && Date.parse(session.expiresAt) > Date.now();
    res.json({ status: 'ok', version: APP_VERSION, timestamp: new Date().toISOString(), ...(signedIn ? { dbId: db.dbId, instance: INSTANCE_ID } : {}) });
  });
  app.get('/api/ready', (_req, res) => {
    const healthy = !draining && db.isHealthy();
    res.setHeader('Cache-Control', 'no-store');
    res.status(healthy ? 200 : 503).json({ status: healthy ? 'ready' : 'unavailable', database: healthy });
  });
  app.use('/api', (_req, res, next) => {
    if (!draining) return next();
    res.setHeader('Retry-After', '5');
    res.status(503).json({ success: false, code: 'DRAINING', error: 'الخادم يعاد تشغيله؛ حاول بعد لحظات' });
  });
  app.use('/api', createRateLimiter({ windowMs: 60_000, max: config.rateLimitPerMinute * 10,
    key: req => req.ip || 'unknown', message: 'عدد كبير من الطلبات من هذه الشبكة، حاول لاحقاً' }));
  app.use('/api', express.json({ limit: '5mb' }));
  // Express 5 leaves req.body undefined without a JSON body; handlers validate an empty object instead.
  app.use('/api', (req, _res, next) => { if (req.body === undefined) req.body = {}; next(); });
  app.use('/api', csrfGuard);
  app.use('/api', sessionMiddleware(db, config));
  // A temporary (or first) password opens nothing but the change-password screen.
  app.use('/api', passwordChangeGuard(db));
  app.use('/api', apiLimiter);

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
      details: actionType.startsWith('DB_') && currentCorrelationId() ? `${details} · رقم التتبع: ${currentCorrelationId()}` : details,
      ipAddress: ip || 'unknown',
      timestamp: new Date().toISOString(),
    };
    db.writeRow('auditLogs', entry.id, entry, db.positionBounds('auditLogs').min - 1, actor?.id ?? null);
    changeBus.emit('rev', db.currentRev());
  };

  app.get('/api/v1/news/:id/corrections', requireAuth, requireModule('news'), (req: ApiRequest, res) => {
    try {
      const { row } = correctionTarget(db, req.auth!, req.params.id);
      if (!moduleAllowed(req.auth!, 'news', row.d.stationId)) throw new HttpError(403, MODULE_UNAVAILABLE);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data: { newsVersion: row.v, newsTitle: row.d.title || '', newsText: row.d.content || '', records: db.listCollection('newsCorrections').map(r => r.d).filter(r => r.newsId === row.id), historyVersions: db.listHistory('news', row.id).map(h => h.version) } });
    } catch (error) { if (error instanceof NewsCorrectionError) throw new HttpError(error.status, error.message); throw error; }
  });
  app.post('/api/v1/news/:id/corrections', requireAuth, requireModule('news'), (req: ApiRequest, res) => {
    try {
      const news = db.getRow('news', req.params.id)?.d;
      if (!moduleAllowed(req.auth!, 'news', news?.stationId)) throw new HttpError(403, MODULE_UNAVAILABLE);
      const record = createNewsCorrection(db, req.auth!, { ...req.body, newsId: req.params.id });
      changeBus.emit('rev', db.currentRev()); res.json({ success: true, data: record });
    } catch (error) { if (error instanceof NewsCorrectionError) throw new HttpError(error.status, error.message); throw error; }
  });
  // --- Health ----------------------------------------------------------------
  const updateNeedsBackup = () => {
    if (!config.isProduction || !updates.deployment) return false;
    const backupAt = Date.parse(lastVerifiedExternalBackup(db, config)?.at || '');
    const age = Date.now() - backupAt;
    return !Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000;
  };
  app.get('/api/v1/updates', requireAuth, wrap(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const canDeploy = req.auth!.can('system.settings');
    const data: AppUpdateStatus = {
      deployedVersion: APP_VERSION,
      latest: await updates.latest(),
      broadcastActive: broadcastActive(),
      deployment: canDeploy ? updates.deployment : null,
      requestedVersion: canDeploy ? updates.requestedVersion(APP_VERSION) : null,
      tracking: canDeploy ? updates.tracking(APP_VERSION) : undefined,
      backupRequired: canDeploy && updateNeedsBackup(),
    };
    res.json({ success: true, data });
  }));

  app.post('/api/v1/updates/deploy', requirePermission('system.settings'), wrap(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!updates.deployment) throw new HttpError(409, 'النشر من داخل البرنامج غير مهيأ على هذا الخادم');
    if (req.body?.localAirEnded !== true) throw new HttpError(400, 'أكد انتهاء جلسات الهواء المحلية قبل طلب النشر');
    if (broadcastActive()) throw new HttpError(409, 'توجد جلسة بث نشطة، أنهِها قبل طلب النشر', 'AIR_ACTIVE');
    const latest = await updates.latest();
    if (!latest) throw new HttpError(503, 'تعذر التحقق من أحدث إصدار منشور');
    if (req.body.version !== latest.version || !isNewerVersion(latest.version, APP_VERSION)) {
      throw new HttpError(409, 'تغيّر الإصدار المتاح. افحص الإصدارات مجددًا.');
    }
    const { sessionId, user: actor } = req.auth!;
    const session = db.getSession(sessionId);
    const user = db.getRow('users', actor.id)?.d as User | undefined;
    if (!session || Date.parse(session.expiresAt) <= Date.now() || !user || user.isActive === false || user.deletedAt) {
      throw new HttpError(401, 'انتهت صلاحية الجلسة');
    }
    if (!buildAuthContext(db, user, sessionId).can('system.settings')) {
      throw new HttpError(403, 'تحتاج إلى صلاحية إدارة النظام لطلب النشر');
    }
    if (broadcastActive()) throw new HttpError(409, 'توجد جلسة بث نشطة، أنهِها قبل طلب النشر', 'AIR_ACTIVE');
    if (updateNeedsBackup()) throw new HttpError(409, 'أنشئ نسخة احتياطية كاملة وتحقق من تسليمها إلى وجهة خارجية خلال آخر 24 ساعة قبل النشر', 'UPDATE_BACKUP_REQUIRED');
    const result = await updates.dispatch(latest.version, APP_VERSION);
    if (result === 'failed') throw new HttpError(502, 'تعذر تأكيد استلام نظام النشر للطلب');
    if (result === 'pending') throw new HttpError(409, 'طلب نشر لهذا الإصدار قيد المعالجة');
    audit(user, 'APP_UPDATE_REQUEST', 'SYSTEM', latest.version, 'INFO', `طلب نشر إصدار مدار v${latest.version}`, req.ip);
    res.status(202).json({ success: true, data: { version: latest.version } });
  }));

  app.get('/api/v1/admin/runtime', requirePermission('system.settings'), (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { version: APP_VERSION, databaseHealthy: db.isHealthy(),
      sessionTtlHours: config.sessionTtlMs / 3600000, rateLimitPerMinute: config.rateLimitPerMinute,
      backupIntervalHours: config.backupIntervalHours, backupRetention: config.backupRetention,
      externalBackup: !!config.backupDirectory, cloudBackup: !!config.backupRemote, secureCookie: config.cookieSecure } });
  });


  // What the administrator follows day to day: sessions, storage, people, content and background jobs.
  app.get('/api/v1/admin/overview', requirePermission('system.settings'), (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: adminOverview(db, config) });
  });

  // Signs a colleague out of every device (a lost phone, a shared computer left open).
  app.post('/api/v1/admin/sessions/revoke', requirePermission('users.suspend_delete'), (req: ApiRequest, res) => {
    const target = db.getRow('users', String(req.body?.userId || ''))?.d as User | undefined;
    if (!target) throw new HttpError(404, 'المستخدم غير موجود');
    if (target.role === 'SUPER_ADMIN' && req.auth!.user.role !== 'SUPER_ADMIN') throw new HttpError(403, 'فقط مدير النظام العام ينهي جلسات مدير عام');
    // My own other devices are signed out; this one stays.
    db.deleteUserSessions(target.id, target.id === req.auth!.user.id ? req.auth!.sessionId : undefined);
    audit(req.auth!.user, 'SESSIONS_REVOKED', 'USER', target.id, 'SECURITY', `إنهاء كل جلسات: ${target.fullName}`, req.ip);
    res.json({ success: true });
  });

  // --- Authentication ------------------------------------------------------

  const publicUser = (user: User, mustChangePassword: boolean, permissions: string[]) => ({
    user,
    mustChangePassword,
    permissions,
    setupReviewId: permissions.includes('system.settings') ? db.getMeta('setup_review') || undefined : undefined,
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
      if (cred.mustChangePassword && temporaryPasswordExpired(db, cred.userId)) {
        audit(user, 'LOGIN_FAILED', 'USER', cred.userId, 'SECURITY', `كلمة مرور مؤقتة منتهية الصلاحية للحساب ${email}`, req.ip);
        throw new HttpError(401, `انتهت صلاحية كلمة المرور المؤقتة (${config.tempPasswordHours} ساعة)؛ اطلب من مدير النظام إصدار كلمة جديدة`, 'TEMP_PASSWORD_EXPIRED');
      }

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
      // At most MAX_SESSIONS_PER_USER devices: the least recently used sign-ins are ended.
      db.listSessions(new Date().toISOString()).filter((s) => s.userId === user.id && s.id !== session.id).slice(MAX_SESSIONS_PER_USER - 1).forEach((s) => db.deleteSession(s.id));
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

  const demoAccounts = createDemoAccountReader(db, config.demoUserPassword);
  app.get('/api/v1/auth/setup', wrap(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const mode = await loginSetupMode(db, config, async () => (await demoAccounts()).some((user) => user.canStartSetup));
    res.json({ success: true, data: { mode } });
  }));

  const setupLimiter = createRateLimiter({
    windowMs: 15 * 60_000,
    max: 10,
    key: (req) => `setup:${req.ip}`,
    message: 'محاولات إعداد كثيرة من هذا العنوان، يرجى الانتظار 15 دقيقة',
  });
  app.post('/api/v1/auth/setup/administrator', setupLimiter, wrap(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const result = await createFirstAdministrator(db, config, req.body, (user) => {
      audit(user, 'USER_CREATED', 'USER', user.id, 'SECURITY', 'إنشاء حساب المسؤول الأول', req.ip);
    });
    if ('error' in result) throw new HttpError(result.status, result.error);
    res.status(result.status).json({ success: true });
  }));

  // Demo installations only: which accounts can be tried (never listed when demo data is off or removed).
  app.get('/api/v1/auth/demo-accounts', wrap(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const accounts = config.seedDemoData ? await demoAccounts() : [];
    res.json({ success: true, data: accounts.length ? { password: config.demoUserPassword, accounts } : { accounts } });
  }));

  /** Public: the station's name, time zone and date/time conventions (clock on the sign-in screen). */
  app.get('/api/v1/auth/station', (_req, res) => {
    const settings = (db.getRow('settings', 'singleton')?.d as any) || {};
    res.setHeader('Cache-Control', 'no-cache');
    res.json({
      success: true,
      data: {
        organizationName: typeof settings.organizationName === 'string' ? settings.organizationName : '',
        defaultTimezone: typeof settings.defaultTimezone === 'string' ? settings.defaultTimezone : '',
        dateTime: sanitizeDateSettings(settings.dateTime),
      },
    });
  });

  app.get('/api/v1/auth/me', (req, res, next) => {
    // The sign-in screen asks with ?optional=1: «nobody signed in» is an answer, not an error (no 401 in the console).
    if (!req.auth && req.query.optional === '1') {
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ success: true, user: null });
    }
    next();
  }, requireAuth, (req, res) => {
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
      markTemporaryPassword(db, user.id, 0);
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
      markTemporaryPassword(db, target.id, config.tempPasswordHours);
      db.deleteUserSessions(target.id);
      audit(req.auth!.user, 'PASSWORD_RESET', 'USER', target.id, 'SECURITY', `إصدار كلمة مرور مؤقتة للمستخدم ${target.fullName} (تنتهي بعد ${config.tempPasswordHours} ساعة)`, req.ip);
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
  app.post('/api/v1/users/:id/2fa/reset', requirePermission('users.suspend_delete'), (req: ApiRequest, res) => {
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
  app.use('/api/v1/external-intake', externalIntakeRouter(db, config));

  app.use('/api/v1/media', mediaTranscriptionRouter(db, config, () => changeBus.emit('rev', db.currentRev())));

  app.use('/api/v1/media/resumable', requirePermission('media.upload'), requireModule('media'),
    createResumableUploadRouter(db, config.dataDir, config.mediaMaxUploadBytes, (record, req) => queueCopiesForUpload(db, record, req)));

  app.post(
    '/api/v1/media/upload',
    requirePermission('media.upload'),
    requireModule('media'),
    wrap(async (req, res) => {
      try {
        const record = await receiveUpload(req, db, config.dataDir, config.mediaMaxUploadBytes, req.auth!.user.id);
        // Copied to the connected cloud (and the shared folder, when asked for on the local network).
        queueCopiesForUpload(db, record, req);
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

  app.get('/api/v1/media/files/:id', requirePermission('media.view'), wrap(async (req, res) => {
    const record = /^[A-Za-z0-9_\-]+$/.test(req.params.id) ? db.getUpload(req.params.id) : null;
    if (!record || record.scope === 'chat' || (record.scope === 'legacy' && record.uploadedBy !== req.auth!.user.id)) {
      throw new HttpError(404, 'الملف غير موجود');
    }
    if (!moduleAllowed(req.auth!, 'media') && !canDownloadLinkedMedia(db, req.auth!, record.id)) {
      throw new HttpError(404, 'الملف غير موجود');
    }
    // Prevent execution and recheck authorization before reusing a cached asset.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Cache-Control', record.scope === 'legacy' ? 'private, no-store' : 'private, no-cache');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(record.originalName)}`);
    // From the server's disk, else from Dropbox/Google Drive/the shared folder (see storage.ts).
    await sendStoredFile(db, config, req, res, record, HttpError);
  }));

  // --- Messaging: files and older history -------------------------------------

  app.use('/api/v1/chat/actions', messageActionsRouter(db, config, () => changeBus.emit('rev', db.currentRev()), HttpError));

  app.post(
    '/api/v1/chat/upload',
    requireAuth,
    requireModule('messaging'),
    wrap(async (req, res) => {
      if (assignedWorkOnly(req.auth!.can)) throw new HttpError(403, 'المراسلات غير متاحة لهذا الحساب');
      try {
        const record = await receiveUpload(req, db, config.dataDir, config.mediaMaxUploadBytes, req.auth!.user.id, { allowed: CHAT_UPLOAD_TYPES, scope: 'chat' });
        res.status(201).json({ success: true, data: { id: record.id, name: record.originalName, mimeType: record.mimeType, size: record.sizeBytes } });
      } catch (err) {
        if (err instanceof UploadError) throw new HttpError(err.status, err.message);
        throw err;
      }
    })
  );

  // A file is downloaded by whoever uploaded it and by the people who may read a message carrying it.
  app.get('/api/v1/chat/files/:id', requireAuth, requireModule('messaging'), (req: ApiRequest, res) => {
    if (assignedWorkOnly(req.auth!.can)) throw new HttpError(403, 'المراسلات غير متاحة لهذا الحساب');
    const record = /^[A-Za-z0-9_\-]+$/.test(req.params.id) ? db.getUpload(req.params.id) : null;
    const me = req.auth!.user.id;
    if (!record || !(record.uploadedBy === me || db.messagesWithUpload(record.id).some((m) => canReadMessage(m, me)))) throw new HttpError(404, 'الملف غير موجود');
    const filePath = path.join(uploadsDir(config.dataDir), record.storedName);
    if (!fs.existsSync(filePath)) throw new HttpError(404, 'الملف غير موجود');
    // Inert: never executed or sniffed; documents a browser cannot show are downloaded.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `${isInlineChatType(record.mimeType) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(record.originalName)}`);
    res.type(record.mimeType);
    res.sendFile(filePath, { dotfiles: 'allow' });
  });

  app.get('/api/v1/chat/history', requireAuth, requireModule('messaging'), (req: ApiRequest, res) => {
    if (assignedWorkOnly(req.auth!.can)) throw new HttpError(403, 'المراسلات غير متاحة لهذا الحساب');
    const channel = String(req.query.channel || '');
    const before = String(req.query.before || '');
    if (!parseChannel(channel) || !Number.isFinite(Date.parse(before))) throw new HttpError(400, 'طلب غير صالح');
    const messages = db.messagesBefore(channel, before, 60).filter((m) => canReadMessage(m, req.auth!.user.id));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: messages.reverse() });
  });

  app.post('/api/v1/chat/pin', requireAuth, requireModule('messaging'), (req, res) => {
    const auth = req.auth!;
    const { channel, messageId, remove } = req.body ?? {};
    if (typeof channel !== 'string' || typeof messageId !== 'string' || typeof remove !== 'boolean') throw new HttpError(400, 'طلب تثبيت غير صالح');
    const departmentList = departmentsOf(db.getRow('settings', 'singleton')?.d);
    if (assignedWorkOnly(auth.can) || !canPinAnnouncement(channel, auth.user.id, departmentList, auth.can('tasks.intercom_broadcast') || auth.can('system.settings'))) {
      throw new HttpError(403, 'صلاحياتك لا تسمح بتثبيت بلاغات هذه القناة');
    }
    const current = db.getRow('chatPins', channel);
    if (remove) {
      if (current?.d.messageId !== messageId) throw new HttpError(409, 'تغيّر البلاغ المثبّت');
      db.deleteRow('chatPins', channel, auth.user.id);
    } else {
      const message = db.getRow('messages', messageId)?.d;
      if (!message || canonicalMessageChannel(message.channel) !== channel || !canReadMessage(message, auth.user.id)) throw new HttpError(404, 'رسالة القناة غير متاحة');
      const excerpt = (message.text || message.ref?.title || message.attachments?.[0]?.name || 'رسالة').slice(0, 350);
      db.writeRow('chatPins', channel, { id: channel, messageId, excerpt }, 0, auth.user.id);
    }
    changeBus.emit('rev', db.currentRev());
    res.json({ success: true });
  });

  // --- Data synchronisation -------------------------------------------------

  app.get('/api/v1/settings/module-history', requirePermission('system.settings'), (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ rows: db.listHistory('settings', SINGLETON_ID).map(({ data, ...revision }) => ({
      ...revision, policy: data.moduleAccess ?? {},
    })) });
  });

  app.get('/api/v1/data', requireAuth, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, dbId: db.dbId, ...sync.bootstrap(req.auth!) });
  });

  app.get('/api/v1/data/episode-summaries', requireAuth, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: sync.episodeSummaries(req.auth!) });
  });

  app.get('/api/v1/data/collections/:collection', requireAuth, (req, res) => {
    const name = req.params.collection;
    if (!isCollectionName(name) || !PAGED_BOOTSTRAP_COLLECTIONS.has(name)) throw new HttpError(404, 'المجموعة غير متاحة');
    const rawCursor = req.query.cursor;
    const cursor = rawCursor === undefined ? null : typeof rawCursor === 'string' ? rawCursor : '';
    const requestedLimit = req.query.limit === undefined ? undefined : Number(req.query.limit);
    const limit = requestedLimit ?? 100;
    const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
    if (cursor !== null && !isValidCollectionPageCursor(cursor)) throw new HttpError(400, 'مؤشر الصفحة غير صالح');
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new HttpError(400, 'حجم الصفحة غير صالح');
    if (query.length > 120) throw new HttpError(400, 'عبارة البحث طويلة جداً');
    const page = sync.collectionPage(req.auth!, name, cursor, limit, query);
    if (!page) throw new HttpError(403, 'لا تملك صلاحية قراءة هذه المجموعة');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, ...page });
  });

  app.get('/api/v1/saved-news-filters', requireAuth, requireModule('news'), (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ rows: db.listCollection('savedNewsFilters').filter(row => row.d?.ownerId === req.auth!.user.id) });
  });
  app.use('/api/v1/shift-handovers', shiftHandoverRouter(db, () => changeBus.emit('rev', db.currentRev())));

  app.get('/api/v1/air-offline/packet/:showId', requireAuth, (req: ApiRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json({ success: true, packet: prepareOfflinePacket(db, req.auth!, req.params.showId, APP_VERSION) }); }
    catch (error) {
      if (error instanceof OfflineAirError) throw new HttpError(error.status, error.message);
      throw error;
    }
  });
  app.get('/api/v1/air-offline/state/:showId', requireAuth, (req: ApiRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const packet = prepareOfflinePacket(db, req.auth!, req.params.showId, APP_VERSION);
      res.json({ success: true, dbId: db.dbId, userId: req.auth!.user.id, state: packet.confirmedState, show: packet.show });
    } catch (error) { if (error instanceof OfflineAirError) throw new HttpError(error.status, error.message); throw error; }
  });
  app.post('/api/v1/air-offline/sessions', requireAuth, (req, res) => {
    try { res.json({ success: true, record: importOfflineSession(db, req.auth!, req.body) }); }
    catch (error) { if (error instanceof OfflineAirError) throw new HttpError(error.status, error.message); throw error; }
  });
  app.get('/api/v1/air-offline/draft-target/:collection/:id', requireAuth, (req: ApiRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json({ success: true, row: offlineDraftTarget(db, req.auth!, req.params.collection, req.params.id), dbId: db.dbId, userId: req.auth!.user.id }); }
    catch (error) { if (error instanceof OfflineAirError) throw new HttpError(error.status, error.message); throw error; }
  });
  app.post('/api/v1/air-offline/apply-draft', requireAuth, (req, res) => {
    try { res.json({ success: true, result: applyOfflineDraft(db, sync, req.auth!, req.body, req.ip) }); }
    catch (error) { if (error instanceof OfflineAirError) throw new HttpError(error.status, error.message); throw error; }
  });

  app.get('/api/v1/work/department', requireAuth, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const data = readDepartmentWork(db, req.auth!);
    if (!data) throw new HttpError(403, 'متابعة القسم متاحة لرئيس القسم المعيّن');
    res.json({ success: true, data });
  });

  app.get('/api/v1/data/changes', requireAuth, (req, res) => {
    const since = Number(req.query.since);
    if (!Number.isInteger(since) || since < 0) throw new HttpError(400, 'since must be a non-negative integer');
    res.setHeader('Cache-Control', 'no-store');
    const access = typeof req.query.access === 'string' ? req.query.access : undefined;
    res.json({ success: true, dbId: db.dbId, ...sync.changes(req.auth!, since, access) });
  });

  app.post('/api/v1/data/sync', requireAuth, (req, res) => {
    const ops = req.body?.ops;
    if (!Array.isArray(ops) || ops.length === 0) throw new HttpError(400, 'الطلب لا يحمل أي عملية مزامنة (ops)', 'NO_OPS');
    if (ops.length > MAX_OPS_PER_REQUEST) throw new HttpError(413, 'عدد العمليات في الطلب الواحد كبير جداً');
    const results = sync.apply(req.auth!, ops as SyncOp[], req.ip);
    res.json({ success: true, rev: db.currentRev(), dbId: db.dbId, results });
  });

  /**
   * Releases an edit lock only if the caller holds it. Pages call this as they unload, even while
   * their own lock request is unanswered, without risking a colleague's lock (editors may delete
   * other people's locks through /data/sync, which is a deliberate takeover, not a release).
   */
  app.post('/api/v1/data/locks/release', requireAuth, (req, res) => {
    const id = req.body?.id;
    if (typeof id !== 'string' || !/^(news|episodes|bulletinStories):[^\s]{1,200}$/.test(id)) throw new HttpError(400, 'معرّف القفل غير صالح');
    const collection = id.split(':')[0];
    const lockModule = moduleForScreen(collection === 'bulletinStories' ? 'bulletins' : collection);
    if (lockModule && !moduleAllowed(req.auth!, lockModule)) throw new HttpError(403, MODULE_UNAVAILABLE);
    const lock = db.getRow('editLocks', id);
    const released = !!lock && !lock.deleted && lock.d?.userId === req.auth!.user.id;
    if (released) sync.apply(req.auth!, [{ c: 'editLocks', op: 'delete', id } as SyncOp], req.ip);
    res.json({ success: true, released });
  });

  /** Server-Sent Events: tells browsers a new revision exists so they pull changes immediately. */
  app.get('/api/v1/data/stream', requireAuth, (req, res) => {
    streams.add(res);
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
      streams.delete(res);
      clearInterval(heartbeat);
      changeBus.off('rev', onRev);
    });
  });

  // --- Revision history -----------------------------------------------------

  app.get('/api/v1/history/:collection/:id', requirePermission('news.view'), requireModule('news'), (req: ApiRequest, res) => {
    denyAssignedOnlyScope(req.auth!);
    const collection = req.params.collection as CollectionName;
    if (!HISTORY_COLLECTIONS.has(collection)) throw new HttpError(404, 'لا يوجد سجل نسخ لهذا النوع');
    res.setHeader('Cache-Control', 'no-store');
    const record = db.getRow(collection, req.params.id)?.d;
    if (record && !canRead(req.auth!, collection, record)) throw new HttpError(403, MODULE_UNAVAILABLE);
    res.json({ success: true, data: db.listHistory(collection, req.params.id) });
  });

  // --- Broadcast exports ----------------------------------------------------

  app.get(['/api/v1/episodes/:id/export/mos', '/api/v1/episodes/:id/mos'], requireAuth, (req: ApiRequest, res) => {
    const episode = db.getRow('episodes', req.params.id)?.d as Episode | undefined;
    if (!episode || episode.deletedAt) throw new HttpError(404, 'الحلقة غير موجودة');
    if (!canRead(req.auth!, 'episodes', episode)) throw new HttpError(403, 'لا تملك صلاحية قراءة الحلقة');
    const media = db.listCollection('media').map(row => row.d);
    const requests = db.listCollection('requests').map(row => row.d);
    const zone = db.getRow('settings', SINGLETON_ID)?.d?.defaultTimezone || config.timeZone;
    const state = db.getRow('onAir', episode.id)?.d;
    const session = state?.status === 'LIVE' ? { showId: episode.id, startedAt: state.startedAt } : undefined;
    for (const segment of episode.rundown || []) {
      const airAt = plannedMediaAirAt(episode.broadcastDate, episode.startTime, zone, segment.startTimeOffset);
      const blocker = firstMediaRightsBlocker(segmentMediaIds(segment, episode.id, media, requests), media, new Date(), airAt, session);
      if (blocker) throw new HttpError(409, `حقوق مواد الفقرة «${segment.title}» تمنع التصدير للبث: ${blocker}`);
    }
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="episode_${encodeURIComponent(episode.id)}_mos.xml"`);
    res.send(generateEpisodeMosXml(episode));
  });

  app.get('/api/v1/bulletins/:id/mos', requireAuth, (req: ApiRequest, res) => {
    const bulletin = db.getRow('bulletins', req.params.id)?.d as Bulletin | undefined;
    if (!bulletin || bulletin.deletedAt) throw new HttpError(404, 'النشرة غير موجودة');
    if (!canRead(req.auth!, 'bulletins', bulletin)) throw new HttpError(403, 'لا تملك صلاحية قراءة النشرة');
    const stories = db.listCollection('bulletinStories').map((r) => r.d).filter((s: any) => s?.bulletinId === bulletin.id && !s.deletedAt);
    const media = db.listCollection('media').map((r) => r.d);
    const zone = db.getRow('settings', SINGLETON_ID)?.d?.defaultTimezone || config.timeZone;
    const now = new Date();
    const forAir = req.query.mode === 'air';
    if (forAir && !stories.some((story: BulletinStory) => !story.killed && !story.floated)) throw new HttpError(409, 'لا توجد فقرات للبث');
    const news = forAir ? db.listCollection('news').map(row => row.d) : [];
    const state = db.getRow('onAir', bulletin.id)?.d;
    const session = state?.status === 'LIVE' ? { showId: bulletin.id, startedAt: state.startedAt } : undefined;
    const blocker = evaluateBulletinReadiness(bulletin, stories, news, media, now, zone, session)
      .find(issue => issue.severity === 'blocker' && (forAir || issue.code === 'MEDIA_RIGHTS'));
    if (blocker) throw new HttpError(409, `النشرة غير جاهزة للتصدير للبث: ${blocker.message}`);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bulletin_${encodeURIComponent(bulletin.id)}_mos.xml"`);
    res.send(generateBulletinMosXml(bulletin, stories as BulletinStory[], media));
  });

  // --- News archive (settled news outside the synced working set) ------------

  app.get('/api/v1/reports/news', requirePermission('news.view'), requireModule('reports'), (req, res) => {
    const auth = req.auth!;
    denyAssignedOnlyScope(auth);
    if (!moduleAllowed(auth, 'news')) throw new HttpError(403, MODULE_UNAVAILABLE);
    if (!canOpenScreen('reports', findUserRole(auth.user, auth.roles), auth.can, auth.user.role === 'SUPER_ADMIN')) {
      throw new HttpError(403, 'لا تملك صلاحية عرض التقارير');
    }
    const { since, station = 'ALL', category = 'ALL' } = req.query;
    if (typeof station !== 'string' || station.length > 210 || typeof category !== 'string' || category.length > 200
        || (since !== undefined && (typeof since !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(since) || !Number.isFinite(Date.parse(since))))) {
      throw new HttpError(400, 'فلاتر التقرير غير صالحة');
    }
    res.setHeader('Cache-Control', 'no-store');
    const filters = { since: typeof since === 'string' ? since : undefined, station, category };
    if (req.query.records !== undefined) {
      const status = req.query.records;
      const page = Number(req.query.page ?? 1);
      if (typeof status !== 'string' || !['ALL', 'PUBLISHED', 'APPROVED', 'UNDER_REVIEW', 'DRAFT'].includes(status) || !Number.isSafeInteger(page) || page < 1 || page > 1000) throw new HttpError(400, 'طلب سجلات التقرير غير صالح');
      return res.json({ data: listNewsReportRecords(db, auth, filters, status, page) });
    }
    res.json({ data: summarizeNewsReport(db, auth, filters) });
  });

  const archiveCutoff = () =>
    new Date(Date.now() - (config.newsActiveDays > 0 ? config.newsActiveDays : 36500) * 24 * 60 * 60 * 1000).toISOString();

  app.get('/api/v1/archive/news', requirePermission('news.view'), requireModule('news'), (req, res) => {
    denyAssignedOnlyScope(req.auth!);
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
    const page = Math.max(1, Math.min(1000, Math.trunc(Number(req.query.page) || 1)));
    const pageSize = 25;
    const { station, from, to } = req.query;
    const validDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) && new Date(value).toISOString().startsWith(`${value}T`);
    if ((station !== undefined && (typeof station !== 'string' || station.length > 128)) ||
        (from !== undefined && !validDay(from)) || (to !== undefined && !validDay(to)) ||
        (typeof from === 'string' && typeof to === 'string' && from > to)) {
      throw new HttpError(400, 'فلاتر الأرشيف غير صالحة');
    }
    const excluded = stationsOf(db.getRow('settings', SINGLETON_ID)?.d).filter(s => !moduleAllowed(req.auth!, 'news', s.id)).map(s => s.id);
    const result = searchArchive(db, archiveCutoff(), q, pageSize, (page - 1) * pageSize, {
      ...(excluded.length ? { excludedStations: excluded } : {}),
      ...(typeof station === 'string' && station !== 'ALL' && station ? { station } : {}),
      ...(typeof from === 'string' ? { from } : {}),
      ...(typeof to === 'string' ? { to } : {}),
    });
    res.json({ success: true, data: { ...result, page, pageSize, activeDays: config.newsActiveDays } });
  });

  app.get('/api/v1/archive/news/:id', requirePermission('news.view'), requireModule('news'), (req, res) => {
    denyAssignedOnlyScope(req.auth!);
    const row = db.getRow('news', String(req.params.id));
    if (!row || row.d?.deletedAt || !moduleAllowed(req.auth!, 'news', row.d.stationId)) throw new HttpError(404, 'الخبر غير موجود في الأرشيف');
    res.json({ success: true, data: row.d });
  });

  /** Brings an archived story back into the synced newsroom (e.g. to update or republish it). */
  app.post('/api/v1/archive/news/:id/reactivate', requirePermission('news.edit_any'), requireModule('news'), (req, res) => {
    denyAssignedOnlyScope(req.auth!);
    const id = String(req.params.id);
    const row = db.getRow('news', id);
    if (!row || row.d?.deletedAt || !moduleAllowed(req.auth!, 'news', row.d.stationId)) throw new HttpError(404, 'الخبر غير موجود في الأرشيف');
    const now = new Date().toISOString();
    db.writeRow('news', id, { ...row.d, updatedAt: now }, row.p, req.auth!.user.id);
    audit(req.auth!.user, 'NEWS_REACTIVATE', 'NEWS', id, 'INFO', `إعادة خبر من الأرشيف إلى غرفة الأخبار: ${row.d.title}`, req.ip);
    changeBus.emit('rev', db.currentRev());
    res.json({ success: true });
  });

  // --- Agency wire feeds -----------------------------------------------------

  app.get('/api/v1/wires/status', requirePermission('news.view'), requireModule('news'), (_req, res) => {
    res.json({ success: true, data: { pollMinutes: config.wires.pollMinutes, retentionDays: config.wires.retentionDays, feeds: getFeedStatus() } });
  });

  const wireRefreshLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 6,
    key: (req) => req.auth?.user.id || req.ip || 'unknown',
    message: 'تم تحديث المصادر قبل قليل، حاول بعد دقيقة',
  });

  app.post(
    '/api/v1/wires/refresh',
    requirePermission('news.create'),
    requireModule('news'),
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

  const aiBudget = createAiBudget(db, config.aiUsage);
  const aiRole = (auth: NonNullable<Request['auth']>) => findUserRole(auth.user, auth.roles)?.roleCode ?? auth.user.role;
  app.get('/api/v1/ai/status', requireAuth, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, ...getAiStatus(config), budget: aiBudget.status(req.auth!.user.id, aiRole(req.auth!)) });
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
      const mode = req.body?.mode as CopilotMode;
      if (!canUseCopilot(mode, permission => req.auth!.can(permission) &&
        (permission !== 'cards.work' || moduleAllowed(req.auth!, 'assignments')) &&
        (!permission.startsWith('news.') || moduleAllowed(req.auth!, 'editorialAi')) &&
        (!permission.startsWith('episodes.') || moduleAllowed(req.auth!, 'programmes')))) {
        throw new HttpError(403, 'لا تملك صلاحية استخدام المساعد التحريري');
      }
      if (!COPILOT_MODES.includes(mode)) throw new HttpError(400, 'وضع غير مدعوم');
      const provider = req.body?.provider as AiProvider | undefined;
      if (provider !== undefined && !AI_PROVIDERS.includes(provider)) throw new HttpError(400, 'خدمة ذكاء اصطناعي غير معروفة');
      if (req.body?.model !== undefined) throw new HttpError(400, 'يُحدَّد نموذج الذكاء الاصطناعي في إعدادات الخادم');
      if (req.body?.sensitive === true) throw new HttpError(400, 'المادة مصنّفة حساسة ولا يمكن إرسالها إلى المزوّد', 'AI_SENSITIVE_CONTENT');
      const text = (value: unknown) => typeof value === 'string' ? value : undefined;
      try {
        const status = getAiStatus(config);
        if (!status.providers.some((entry) => entry.id === (provider ?? status.defaultProvider))) throw new Error('AI_NOT_CONFIGURED');
        const auth = req.auth!;
        const { allowed, budget } = aiBudget.take(auth.user.id, aiRole(auth));
        if (!allowed) {
          res.setHeader('Retry-After', String(Math.max(1, Math.ceil((Date.parse(budget.resetsAt) - Date.now()) / 1000))));
          throw new HttpError(429, 'بلغت الحد اليومي لطلبات المساعد. حاول بعد موعد تجديد الرصيد.', 'AI_DAILY_BUDGET');
        }
        const result = await runCopilot(config, {
          mode,
          provider,
          tone: text(req.body?.tone),
          title: text(req.body?.title),
          summary: text(req.body?.summary),
          content: text(req.body?.content),
          instruction: text(req.body?.instruction),
        });
        res.setHeader('Cache-Control', 'no-store');
        res.json({ success: true, data: result, budget });
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (err instanceof Error && err.message === 'AI_NOT_CONFIGURED') {
          throw new HttpError(503, 'خدمة الذكاء الاصطناعي المحددة غير مفعّلة على الخادم', 'AI_NOT_CONFIGURED');
        }
        const badResponse = err instanceof Error && err.message === 'AI_BAD_RESPONSE';
        logger.error('AI copilot request failed', {
          provider: provider ?? config.defaultAiProvider,
          mode,
          reason: badResponse ? 'bad-response' : 'upstream-failure',
        });
        throw new HttpError(502, 'تعذر الحصول على رد من خدمة الذكاء الاصطناعي، حاول مجدداً', badResponse ? 'AI_BAD_RESPONSE' : undefined);
      }
    })
  );

  // --- Database administration ---------------------------------------------

  const dbAdmin = requirePermission('system.database_manage');
  const checkBackupIncidents = async () => {
    try {
      await reconcileBackupIncidents(db, backupStatus(db, config.backupIntervalHours, config));
      changeBus.emit('rev', db.currentRev());
    } catch { logger.warn('backup incident notifications unavailable'); }
  };
  const confirmations = new DatabaseConfirmations();
  const confirmationFailures = new ConfirmationFailures();
  const currentDatabaseActor = (req: Request) => {
    const auth = req.auth!;
    const session = db.getSession(auth.sessionId);
    const user = db.getRow('users', auth.user.id)?.d as User | undefined;
    if (!session || Date.parse(session.expiresAt) <= Date.now() || !user || user.isActive === false || user.deletedAt) throw new HttpError(401, 'انتهت صلاحية الجلسة');
    const current = buildAuthContext(db, user, auth.sessionId);
    if (!current.can('system.database_manage')) throw new HttpError(403, 'ليس لديك صلاحية إدارة قاعدة البيانات');
    return current;
  };
  const requireAirEnded = (req: Request, operation = 'الاستعادة أو إعادة التهيئة') => {
    if (broadcastActive()) throw new HttpError(409, `توجد جلسة بث نشطة؛ أنهِ جميع جلسات الهواء قبل ${operation}`, 'AIR_ACTIVE');
    if (req.body?.localAirEnded !== true) throw new HttpError(400, 'أكد انتهاء جلسات الهواء المحلية غير المتصلة أيضاً', 'LOCAL_AIR_CONFIRMATION');
  };
  const authorizeDestructive = (req: Request, action: 'restore' | 'reset', sha256?: string) => {
    const auth = currentDatabaseActor(req);
    const token = req.body?.confirmationToken;
    if (typeof token !== 'string' || !token) throw new HttpError(401, 'أعد تأكيد هويتك لإتمام العملية', 'CONFIRMATION_REQUIRED');
    requireAirEnded(req);
    if (!confirmations.consume(token, { actorId: auth.user.id, sessionId: auth.sessionId, action, sha256 })) throw new HttpError(401, 'انتهى التأكيد أو تغيرت النسخة؛ أعد تأكيد هويتك', 'CONFIRMATION_INVALID');
  };
  app.post('/api/v1/db/confirm-operation', dbAdmin, wrap(async (req, res) => {
    const action = req.body?.action;
    if (!['restore', 'reset', 'download', 'export'].includes(action)) throw new HttpError(400, 'نوع العملية غير صالح');
    if (action === 'reset' && !config.allowDbReset) throw new HttpError(403, 'إعادة التهيئة معطلة على الخادم', 'DISABLED');
    const initial = currentDatabaseActor(req);
    const keys = [`actor:${initial.user.id}`, `ip:${req.ip}`];
    if (confirmationFailures.blocked(keys)) throw new HttpError(429, 'محاولات تأكيد كثيرة؛ حاول بعد 15 دقيقة', 'RATE_LIMITED');
    const cred = db.getCredentials(initial.user.id);
    const password = typeof req.body?.password === 'string' && req.body.password.length <= 200 ? req.body.password : '';
    const valid = cred && password && await verifyPassword(password, cred.passwordHash);
    const auth = currentDatabaseActor(req);
    const currentCred = db.getCredentials(auth.user.id);
    let counter: number | null = null;
    if (valid && currentCred?.totpEnabled && currentCred.totpSecret) counter = verifyTotp(currentCred.totpSecret, String(req.body?.totp || ''), currentCred.totpLastCounter);
    if (!valid || !currentCred || currentCred.passwordHash !== cred?.passwordHash || (currentCred.totpEnabled && counter === null) || confirmationFailures.blocked(keys)) {
      confirmationFailures.record(keys);
      audit(auth.user, 'DB_CONFIRM_FAILED', 'DATABASE', 'newsroom', 'SECURITY', 'فشل تأكيد هوية مدير قاعدة البيانات', req.ip);
      throw new HttpError(401, 'تعذر تأكيد الهوية؛ تحقق من كلمة المرور ورمز المصادقة إن كان مفعلاً', 'CONFIRMATION_AUTH_FAILED');
    }
    if (counter !== null) db.setTotpLastCounter(auth.user.id, counter);
    let sha256: string | undefined;
    let target: string | undefined;
    if (action === 'restore') {
      if (typeof req.body?.fileName !== 'string') throw new HttpError(400, 'اسم النسخة مطلوب');
      try { sha256 = (await db.verifyBackup(req.body.fileName)).sha256; }
      catch { throw new HttpError(400, 'تعذر التحقق من النسخة المختارة'); }
    }
    if (action === 'download') {
      if (typeof req.body?.fileName !== 'string') throw new HttpError(400, 'اسم النسخة مطلوب');
      try { db.backupFilePath(req.body.fileName); } catch { throw new HttpError(400, 'اسم النسخة غير صالح أو ملفها غير موجود'); }
      target = req.body.fileName;
    }
    currentDatabaseActor(req);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: confirmations.issue({ actorId: auth.user.id, sessionId: auth.sessionId, action, sha256, target }) });
  }));
  const databaseWork = async <T,>(work: () => Promise<T>): Promise<T> => {
    try { return await databaseOperationLock(db).run(work); }
    catch (error) {
      if (error instanceof DatabaseOperationBusy) throw new HttpError(409, 'عملية قاعدة بيانات أخرى قيد التنفيذ؛ حاول بعد انتهائها', 'DATABASE_BUSY');
      throw error;
    }
  };
  app.post('/api/v1/db/backups/rehearse', dbAdmin, wrap(async (req, res) => {
    const fileName = req.body?.fileName;
    if (typeof fileName !== 'string') throw new HttpError(400, 'اسم النسخة مطلوب');
    const result = await databaseWork(async () => {
      try { return await rehearseBackup(db, fileName, path.join(config.dataDir, 'rehearsals')); }
      catch { throw new HttpError(400, 'تعذرت تجربة الاستعادة؛ تحقق من سلامة النسخة وتوافق إصدارها'); }
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: result });
  }));
  app.get('/api/v1/db/errors', dbAdmin, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: getRecentErrors() });
  });
  app.get('/api/v1/db/backup-status', dbAdmin, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: backupStatus(db, config.backupIntervalHours, config) });
  });
  app.get('/api/v1/db/diagnostics', dbAdmin, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: { version: APP_VERSION, generatedAt: new Date().toISOString(),
      journalHealth: errorJournalHealth(),
      uptimeSeconds: Math.floor(process.uptime()), ready: !draining && db.isHealthy(),
      backup: backupStatus(db, config.backupIntervalHours, config), errors: getRecentErrors() } });
  });
  app.post('/api/v1/db/backups/verify', dbAdmin, wrap(async (req, res) => {
    try {
      if (typeof req.body?.fileName !== 'string') throw new Error();
      const data = await db.verifyBackup(req.body.fileName);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data });
    } catch { throw new HttpError(400, 'تعذر التحقق: النسخة غير موجودة أو تالفة أو غير متوافقة'); }
  }));
  /** A file holding every password hash and 2FA secret leaves the server only after the identity is confirmed again. */
  const requireDownloadConfirmation = (req: Request, action: 'download' | 'export', target?: string) => {
    const auth = currentDatabaseActor(req);
    const token = req.query.confirmationToken;
    if (typeof token !== 'string' || !token) throw new HttpError(401, 'أعد تأكيد هويتك قبل التنزيل', 'CONFIRMATION_REQUIRED');
    if (!confirmations.consume(token, { actorId: auth.user.id, sessionId: auth.sessionId, action, target })) throw new HttpError(401, 'انتهى التأكيد؛ أعد تأكيد هويتك', 'CONFIRMATION_INVALID');
    return auth;
  };
  app.get('/api/v1/db/backups/download', dbAdmin, (req, res) => {
    let source: string;
    const fileName = typeof req.query.fileName === 'string' ? req.query.fileName : '';
    try {
      if (!fileName) throw new Error();
      source = db.backupFilePath(fileName);
    } catch { throw new HttpError(400, 'اسم النسخة غير صالح أو ملفها غير موجود'); }
    const auth = requireDownloadConfirmation(req, 'download', fileName);
    audit(auth.user, 'DB_BACKUP_DOWNLOAD', 'DATABASE', fileName, 'SECURITY', `تنزيل ملف النسخة الاحتياطية ${fileName}`, req.ip);
    res.setHeader('Cache-Control', 'no-store');
    res.download(source, path.basename(source), { dotfiles: 'allow' });
  });

  app.get('/api/v1/db/stats', dbAdmin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: { ...db.stats(), sqlConsoleEnabled: config.enableSqlConsole, resetEnabled: config.allowDbReset,
        confirmationTotpRequired: db.getCredentials(req.auth!.user.id)?.totpEnabled === true },
    });
  });

  app.get('/api/v1/db/engine', dbAdmin, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: databaseEngineStatus(readDatabaseEngineState(db.dataDir, config.database), config.database) });
  });

  app.post('/api/v1/db/engine', dbAdmin, (req, res) => {
    const engine = req.body?.engine;
    if (engine !== 'sqlite' && engine !== 'postgresql') throw new HttpError(400, 'اختر محرك قاعدة بيانات صالحًا');
    if (engine === 'postgresql' && !config.database.postgresUrl) throw new HttpError(409, 'اضبط رابط اتصال PostgreSQL في إعدادات الخادم');
    if (engine !== db.engine) requireAirEnded(req, 'تبديل محرك القاعدة');
    const data = scheduleDatabaseEngine(db.dataDir, config.database, engine);
    audit(req.auth!.user, 'DB_ENGINE_SCHEDULED', 'DATABASE', engine, 'SECURITY',
      data.pending ? 'جدولة التبديل بين محركات قاعدة البيانات عند التشغيل القادم' : 'إلغاء التبديل المجدول لمحرك قاعدة البيانات', req.ip);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data });
  });

  app.get('/api/v1/db/export', dbAdmin, (req, res) => {
    requireDownloadConfirmation(req, 'export');
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
      try { await databaseWork(async () => {
      authorizeDestructive(req, 'reset');
      await db.createBackup('prerestore', config.backupRetention);
      currentDatabaseActor(req); requireAirEnded(req);
      db.deleteCollections(DEMO_COLLECTIONS.map(([c]) => c) as CollectionName[]);
      db.setMeta('demo_seeded', '0');
      db.setMeta('demo_removed', '0');
      await seedDatabase(db, config);
      }); } catch (error) {
        try { audit(req.auth!.user, 'DB_RESET_FAILED', 'DATABASE', 'newsroom', 'SECURITY', 'تعذر إتمام إعادة تهيئة القاعدة', req.ip); }
        catch { logger.warn('database operation audit unavailable'); }
        if (error instanceof HttpError) throw error;
        throw new HttpError(500, 'تعذرت إعادة التهيئة؛ لم يؤكد الخادم اكتمال العملية');
      }
      audit(req.auth!.user, 'DB_RESET', 'DATABASE', 'newsroom', 'SECURITY', 'إعادة تهيئة بيانات المحتوى', req.ip);
      changeBus.emit('rev', db.currentRev());
      res.json({ success: true, message: 'تمت إعادة تهيئة قاعدة البيانات بنجاح', data: db.stats() });
    })
  );

  // Demo data: what is left of it, and removing it for good.
  app.post('/api/v1/admin/setup/administrator', requirePermission('system.settings'), requirePermission('users.create'), requirePermission('users.manage_roles_permissions'), wrap(async (req, res) => {
    const actor = req.auth!.user;
    const { role, password } = req.body || {};
    if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'ADMIN') throw new HttpError(403, 'يتطلب إنشاء مسؤول حساب إدارة');
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') throw new HttpError(400, 'حدد دور المسؤول');
    if (role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') throw new HttpError(403, 'يتطلب إنشاء مدير عام صلاحية مدير عام');
    const fullName = typeof req.body.fullName === 'string' ? req.body.fullName.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!fullName || fullName.length > 120 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'أدخل اسم المسؤول وبريداً إلكترونياً صالحاً');
    const weak = validatePasswordStrength(password);
    if (weak) throw new HttpError(400, weak);
    const hash = await hashPassword(password);
    const id = newId('usr');
    db.transaction(() => {
      if (db.findUserIdByEmail(email) || db.getCredentialsByEmail(email)) throw new HttpError(409, 'البريد الإلكتروني مستخدم لحساب آخر');
      const user: User = { id, fullName, email, role, avatarUrl: '/icon.svg', jobTitle: 'مسؤول النظام', department: 'غرفة التحرير', departmentId: 'newsroom', isActive: true, createdAt: new Date().toISOString() };
      db.writeRow('users', id, user, db.positionBounds('users').max + 1, actor.id);
      db.setPassword(id, email, hash, true);
      markTemporaryPassword(db, id, config.tempPasswordHours);
      audit(actor, 'USER_CREATED', 'USER', id, 'SECURITY', `إنشاء حساب مسؤول من معالج الإعداد (${role})`, req.ip);
    });
    res.status(201).json({ success: true });
  }));

  app.post('/api/v1/admin/setup/review-shown', requirePermission('system.settings'), (req, res) => {
    const id = req.body?.id;
    if (typeof id !== 'string' || !id) throw new HttpError(400, 'معرّف مراجعة الإعداد مطلوب');
    db.transaction(() => {
      if (db.getMeta('setup_review') === id) db.setMeta('setup_review', '');
    });
    res.json({ success: true });
  });

  app.use('/api/v1/admin/permissions', permissionsWorkspaceRouter(db));

  app.get('/api/v1/admin/demo-data', requirePermission('system.settings'), (req, res) => {
    const inventory = demoInventory(db);
    res.json({
      success: true,
      data: {
        counts: Object.fromEntries(Object.entries(inventory).map(([c, ids]) => [c, ids!.length])),
        users: req.auth!.can('users.suspend_delete') ? demoUsersPresent(db, req.auth!.user.id) : [],
        removed: db.getMeta('demo_removed') === '1',
      },
    });
  });

  app.post(
    '/api/v1/admin/demo-data/remove',
    requirePermission('system.settings'),
    wrap(async (req, res) => {
      if (req.body?.confirm !== 'حذف') throw new HttpError(400, 'اكتب كلمة «حذف» للتأكيد');
      if (req.body?.includeUsers === true && !req.auth!.can('users.suspend_delete')) throw new HttpError(403, 'يتطلب حذف الحسابات التجريبية صلاحية حذف المستخدمين');
      await db.createBackup('prerestore', config.backupRetention);
      const removed = removeDemoData(db, { includeUsers: req.body?.includeUsers === true, actingUserId: req.auth!.user.id });
      const total = Object.values(removed).reduce((a, b) => a + b, 0);
      audit(req.auth!.user, 'DEMO_DATA_REMOVED', 'DATABASE', 'newsroom', 'SECURITY', `حذف البيانات التجريبية (${total} سجلاً)`, req.ip);
      changeBus.emit('rev', db.currentRev());
      res.json({ success: true, data: { removed, total, setupReviewId: total ? db.getMeta('setup_review') : undefined } });
    })
  );

  app.get('/api/v1/db/backups', dbAdmin, (_req, res) => {
    res.json({ success: true, data: db.listBackups() });
  });

  app.post(
    '/api/v1/db/backups',
    dbAdmin,
    wrap(async (req, res) => {
      // The same full backup as the schedule: database snapshot + uploads + SHA-256 manifest (+ external copies).
      let full;
      try { full = await databaseWork(() => createFullBackup(db, config)); }
      catch (error) {
        if (error instanceof HttpError) throw error;
        logger.error('manual backup failed', { error: String((error as Error)?.message || error) });
        await checkBackupIncidents();
        audit(req.auth!.user, 'DB_BACKUP_FAILED', 'DATABASE', 'newsroom', 'WARNING', 'تعذر إكمال النسخة الاحتياطية الكاملة (القاعدة والملفات)', req.ip);
        throw new HttpError(500, 'فشل إنشاء النسخة الاحتياطية الكاملة؛ تحقق من مساحة القرص وصلاحيات التخزين والوجهة الخارجية');
      }
      await checkBackupIncidents();
      const backup = full.file;
      audit(req.auth!.user, 'DB_BACKUP', 'DATABASE', backup.fileName, 'INFO', `نسخة احتياطية كاملة ${backup.fileName}: القاعدة و${full.uploads} ملفاً مع ملخص SHA-256${config.backupDirectory ? '، ونسخة في المجلد الخارجي' : ''}${config.backupRemote ? '، ونسخة سحابية' : ''}`, req.ip);
      res.json({ success: true, message: 'تم إنشاء نسخة احتياطية كاملة بنجاح', data: { ...backup, uploads: full.uploads } });
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
        await databaseWork(async () => {
          if (typeof req.body?.confirmationToken !== 'string') throw new HttpError(401, 'أعد تأكيد هويتك لإتمام العملية', 'CONFIRMATION_REQUIRED');
          let sha256: string;
          try { sha256 = (await db.verifyBackup(fileName)).sha256; }
          catch { throw new HttpError(400, 'تعذر التحقق من النسخة المختارة'); }
          authorizeDestructive(req, 'restore', sha256);
          await db.restoreBackup(fileName, config.backupRetention, sha256, () => { currentDatabaseActor(req); requireAirEnded(req); });
        });
      } catch (err: any) {
        try { audit(actor, 'DB_RESTORE_FAILED', 'DATABASE', 'newsroom', 'SECURITY', 'تعذر إتمام استعادة القاعدة', req.ip); }
        catch { logger.warn('database operation audit unavailable'); }
        if (err instanceof HttpError) throw err;
        throw new HttpError(400, 'تعذرت استعادة النسخة الاحتياطية');
      }
      audit(actor, 'DB_RESTORE', 'DATABASE', fileName, 'SECURITY', `استعادة قاعدة البيانات من ${fileName}`, req.ip);
      changeBus.emit('rev', db.currentRev());
      res.json({ success: true, message: 'تمت استعادة النسخة الاحتياطية بنجاح', data: db.stats() });
    })
  );

  // --- Stations: removing one moves its people and open work ---------------------

  app.get('/api/v1/admin/stations/:id/usage', requirePermission('system.settings'), (req: ApiRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: stationUsage(db, req.params.id) });
  });

  app.post('/api/v1/admin/stations/:id/remove', requirePermission('system.settings'), (req: ApiRequest, res) => {
    const replacementId = typeof req.body?.replacementId === 'string' && req.body.replacementId ? req.body.replacementId : undefined;
    let result;
    try { result = removeStation(db, req.params.id, replacementId, req.auth!.user); }
    catch (error) { if (error instanceof StationRemovalError) throw new HttpError(error.status, error.message); throw error; }
    const settings = db.getRow('settings', 'singleton')?.d;
    applyDepartmentSettings(settings);
    rememberStationSettings(settings);
    audit(req.auth!.user, 'STATION_REMOVE', 'STATION', result.station.id, 'WARNING',
      `حذف محطة «${result.station.name}»${result.replacement ? `: نُقل ${result.movedUsers} من الزملاء و${result.movedSteps} مهمة مفتوحة إلى «${result.replacement.name}»` : ''}؛ يبقى اسمها في سجل الأعمال المنجزة`, req.ip);
    res.json({ success: true, data: { movedUsers: result.movedUsers, movedSteps: result.movedSteps } });
  });

  registerStorageRoutes(app, { db, config, HttpError, wrap, audit });

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
