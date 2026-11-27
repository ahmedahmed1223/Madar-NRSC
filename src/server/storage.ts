import { requireModule } from './moduleAccess';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import type { Express, NextFunction, Request, Response } from 'express';
import type { AppConfig } from './config';
import type { NewsroomDatabase, UploadRecord } from './db';
import { logger } from './logger';
import { requirePermission } from './auth';
import { ALLOWED_UPLOAD_TYPES, MEDIA_FILE_URL_PREFIX, uploadsDir } from './uploads';
import { DropboxClient, DropboxError, authorizeUrl as dropboxAuthorizeUrl, dropboxPath, exchangeAuthorizationCode } from './dropbox';
import { DriveClient, DriveError, driveAuthorizeUrl, exchangeDriveCode } from './gdrive';
import { newId } from '../shared/ids';
import {
  CLOUD_NAMES,
  addressInRanges,
  datedFolder,
  safeFileName,
  storageOf,
  type CloudProviderId,
  type CopyTarget,
  type StorageCopy,
  type StorageStatus,
} from '../shared/storage';

/**
 * Keeping uploaded material in Dropbox, Google Drive and the station's shared folder.
 *
 * Every upload lands on the server first (fast and dependable), then a background job copies it
 * to each connected cloud and, when a colleague on the local network asked for it, to the shared
 * folder. The shared folder is written either by the server itself (SHARE_DIRECTORY: the share is
 * mounted on the server) or by «جسر مدار» (bridge/madar-bridge.mjs) on a computer inside the
 * network, which also reports the folder's files so the library can search them.
 */

export const BRIDGE_VERSION = '1.1.0';
const BRIDGE_ONLINE_MS = 90_000;
const EXT_TO_MIME = Object.fromEntries(Object.entries(ALLOWED_UPLOAD_TYPES).map(([mime, ext]) => [ext, mime]));
/** Extensions not in the upload list that are still useful to bring in from a share/cloud. */
const EXTRA_TYPES: Record<string, string> = { jpeg: 'image/jpeg', mxf: 'application/mxf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

export function mimeForName(name: string): string | null {
  const ext = path.extname(name).slice(1).toLowerCase();
  return EXT_TO_MIME[ext] || EXTRA_TYPES[ext] || null;
}

interface Deps {
  db: NewsroomDatabase;
  config: AppConfig;
  HttpError: new (status: number, message: string, code?: string) => Error;
  wrap: (fn: (req: any, res: Response, next: NextFunction) => Promise<unknown>) => any;
  audit: (actor: any, actionType: string, targetEntity: string, targetId: string, severity: string, details: string, ip?: string) => void;
}

interface StoredCreds<T> {
  creds: T;
  account?: string;
  connectedAt?: string;
}

const lastErrors: Partial<Record<CopyTarget, string>> = {};

// ---------------------------------------------------------------------------
// Credentials (server only: never in the synced settings)
// ---------------------------------------------------------------------------

function readMetaJson<T>(db: NewsroomDatabase, key: string): T | null {
  const raw = db.getMeta(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function dropboxCredentials(db: NewsroomDatabase, env = process.env): StoredCreds<{ appKey: string; appSecret: string; refreshToken: string }> & { fromEnv: boolean } | null {
  if (env.DROPBOX_APP_KEY && env.DROPBOX_APP_SECRET && env.DROPBOX_REFRESH_TOKEN) {
    return { creds: { appKey: env.DROPBOX_APP_KEY, appSecret: env.DROPBOX_APP_SECRET, refreshToken: env.DROPBOX_REFRESH_TOKEN }, fromEnv: true };
  }
  const stored = readMetaJson<StoredCreds<any>>(db, 'storage.dropbox.credentials');
  return stored?.creds?.refreshToken ? { ...stored, fromEnv: false } : null;
}

export function driveCredentials(db: NewsroomDatabase, env = process.env): StoredCreds<{ clientId: string; clientSecret: string; refreshToken: string }> & { fromEnv: boolean } | null {
  if (env.GDRIVE_CLIENT_ID && env.GDRIVE_CLIENT_SECRET && env.GDRIVE_REFRESH_TOKEN) {
    return { creds: { clientId: env.GDRIVE_CLIENT_ID, clientSecret: env.GDRIVE_CLIENT_SECRET, refreshToken: env.GDRIVE_REFRESH_TOKEN }, fromEnv: true };
  }
  const stored = readMetaJson<StoredCreds<any>>(db, 'storage.gdrive.credentials');
  return stored?.creds?.refreshToken ? { ...stored, fromEnv: false } : null;
}

const clients: { dropbox?: { key: string; client: DropboxClient }; gdrive?: { key: string; client: DriveClient } } = {};

function dropboxClient(db: NewsroomDatabase): DropboxClient | null {
  const c = dropboxCredentials(db);
  if (!c) return null;
  const key = c.creds.refreshToken;
  if (clients.dropbox?.key !== key) clients.dropbox = { key, client: new DropboxClient(c.creds) };
  return clients.dropbox.client;
}

function driveClient(db: NewsroomDatabase): DriveClient | null {
  const c = driveCredentials(db);
  if (!c) return null;
  const key = c.creds.refreshToken;
  if (clients.gdrive?.key !== key) clients.gdrive = { key, client: new DriveClient(c.creds) };
  return clients.gdrive.client;
}

function settingsOf(db: NewsroomDatabase) {
  return storageOf(db.getRow('settings', 'singleton')?.d);
}

/** Connected and switched on in the settings. */
export function activeClouds(db: NewsroomDatabase): CloudProviderId[] {
  const s = settingsOf(db);
  const out: CloudProviderId[] = [];
  if (s.dropbox.enabled && dropboxCredentials(db)) out.push('dropbox');
  if (s.gdrive.enabled && driveCredentials(db)) out.push('gdrive');
  return out;
}

function shareMode(db: NewsroomDatabase): 'direct' | 'bridge' | 'none' {
  if (process.env.SHARE_DIRECTORY) return 'direct';
  if (db.getMeta('storage.bridge.tokenHash')) return 'bridge';
  return 'none';
}

function bridgeHeartbeat(db: NewsroomDatabase): { at: string; version?: string } | null {
  return readMetaJson(db, 'storage.bridge.heartbeat');
}

function bridgeOnline(db: NewsroomDatabase): boolean {
  const hb = bridgeHeartbeat(db);
  return !!hb && Date.now() - Date.parse(hb.at) < BRIDGE_ONLINE_MS;
}

export function isLocalRequest(db: NewsroomDatabase, req: Request): boolean {
  return addressInRanges(req.ip, settingsOf(db).share.localNetworks);
}

/** Copies to queue for a file a colleague just uploaded to the library. */
export function queueCopiesForUpload(db: NewsroomDatabase, record: UploadRecord, req?: Request) {
  for (const cloud of activeClouds(db)) db.queueCopy(record.id, cloud);
  const share = settingsOf(db).share;
  if (req && share.enabled && shareMode(db) !== 'none' && req.get('x-storage-share') === '1' && isLocalRequest(db, req)) db.queueCopy(record.id, 'share');
}

// ---------------------------------------------------------------------------
// Copying (background job)
// ---------------------------------------------------------------------------

function localPathOf(config: AppConfig, record: UploadRecord): string | null {
  if (record.localEvicted || !record.storedName) return null;
  const p = path.join(uploadsDir(config.dataDir), record.storedName);
  return fs.existsSync(p) ? p : null;
}

async function driveRootId(db: NewsroomDatabase, client: DriveClient): Promise<string> {
  const s = settingsOf(db).gdrive;
  if (s.rootFolderId) return s.rootFolderId;
  const key = `storage.gdrive.rootId:${s.rootName}`;
  const known = db.getMeta(key);
  if (known) return known;
  const id = await client.folder(s.rootName, 'root');
  db.setMeta(key, id);
  return id;
}

/** Unique name inside a folder of the shared directory. */
function uniqueTarget(dir: string, name: string): string {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
}

async function copyOne(db: NewsroomDatabase, config: AppConfig, target: CopyTarget, uploadId: string) {
  const record = db.getUpload(uploadId);
  if (!record) return db.deleteCopies(uploadId);
  const local = localPathOf(config, record);
  if (!local) throw new Error('نسخة الخادم من الملف غير موجودة');
  const name = safeFileName(record.originalName);
  const folder = datedFolder(new Date(record.createdAt));
  if (target === 'dropbox') {
    const client = dropboxClient(db);
    if (!client) throw new Error('Dropbox غير مربوط');
    const entry = await client.upload(local, dropboxPath(settingsOf(db).dropbox.rootPath, folder, name), record.sizeBytes);
    db.finishCopy(uploadId, target, entry.path);
  } else if (target === 'gdrive') {
    const client = driveClient(db);
    if (!client) throw new Error('Google Drive غير مربوط');
    const parent = await client.folderPath(await driveRootId(db, client), folder.split('/'));
    const entry = await client.upload(local, parent, name, record.sizeBytes, record.mimeType);
    db.finishCopy(uploadId, target, entry.id);
  } else {
    const root = process.env.SHARE_DIRECTORY!;
    const dir = path.join(root, ...folder.split('/'));
    await fs.promises.mkdir(dir, { recursive: true });
    const dest = uniqueTarget(dir, name);
    await fs.promises.copyFile(local, dest, fs.constants.COPYFILE_EXCL);
    db.finishCopy(uploadId, target, path.relative(root, dest).split(path.sep).join('/'));
  }
  maybeEvict(db, config, uploadId);
}

/** Frees the server's disk once a cloud holds the file, when the settings ask for it. */
function maybeEvict(db: NewsroomDatabase, config: AppConfig, uploadId: string) {
  if (settingsOf(db).keepLocalCopy) return;
  const copies = db.copiesOf(uploadId);
  if (!copies.length || copies.some((c) => c.state !== 'DONE')) return;
  if (!copies.some((c) => c.target === 'dropbox' || c.target === 'gdrive')) return;
  const record = db.getUpload(uploadId);
  const local = record && localPathOf(config, record);
  if (!local) return;
  fs.rm(local, { force: true }, (err) => {
    if (err) logger.warn('could not free a copied upload', { id: uploadId, error: String(err) });
    else db.setUploadEvicted(uploadId, true);
  });
}

let syncing = false;

/** One pass of the copy queue; returns how many copies finished. */
export async function runStorageSync(db: NewsroomDatabase, config: AppConfig): Promise<number> {
  if (syncing) return 0;
  syncing = true;
  let done = 0;
  try {
    const targets: CopyTarget[] = [...activeClouds(db)];
    if (shareMode(db) === 'direct' && settingsOf(db).share.enabled) targets.push('share');
    for (const target of targets) {
      for (const copy of db.dueCopies(target, 3)) {
        try {
          await copyOne(db, config, target, copy.uploadId);
          delete lastErrors[target];
          done++;
        } catch (err) {
          const message = err instanceof DropboxError || err instanceof DriveError ? err.message : String((err as Error)?.message || err);
          lastErrors[target] = message;
          db.failCopy(copy.uploadId, target, message);
          logger.warn('storage copy failed', { target, upload: copy.uploadId, error: String((err as any)?.detail || (err as any)?.summary || message) });
          // A provider that is down fails every file the same way: try again next pass.
          if (err instanceof DropboxError || err instanceof DriveError) break;
        }
      }
    }
  } finally {
    syncing = false;
  }
  return done;
}

// ---------------------------------------------------------------------------
// Reading a file wherever it is
// ---------------------------------------------------------------------------

async function pipeRemote(upstream: globalThis.Response, res: Response, record: UploadRecord) {
  res.status(upstream.status === 206 ? 206 : 200);
  for (const h of ['content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  res.type(record.mimeType);
  if (!upstream.body) return res.end();
  await new Promise<void>((resolve) => {
    const stream = Readable.fromWeb(upstream.body as any);
    stream.on('error', () => {
      res.destroy();
      resolve();
    });
    res.on('close', () => {
      stream.destroy();
      resolve();
    });
    stream.pipe(res);
  });
}

/**
 * Sends an uploaded file: from the server's disk, else from Dropbox or Google Drive, else from the
 * shared folder (directly, or by asking the bridge for it and telling the browser to retry).
 */
export async function sendStoredFile(db: NewsroomDatabase, config: AppConfig, req: Request, res: Response, record: UploadRecord, HttpError: Deps['HttpError']) {
  const local = localPathOf(config, record);
  // The type is set only when a file is actually sent, so errors still go out as JSON.
  if (local) return res.type(record.mimeType).sendFile(local, { dotfiles: 'allow' });
  const copies = db.copiesOf(record.id).filter((c) => c.state === 'DONE' && c.remotePath);
  const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
  for (const copy of copies) {
    try {
      if (copy.target === 'dropbox') {
        const client = dropboxClient(db);
        if (client) return await pipeRemote(await client.download(copy.remotePath!, range), res, record);
      } else if (copy.target === 'gdrive') {
        const client = driveClient(db);
        if (client) return await pipeRemote(await client.download(copy.remotePath!, range), res, record);
      }
    } catch (err) {
      logger.warn('reading a cloud copy failed', { target: copy.target, upload: record.id, error: String(err) });
    }
  }
  const share = copies.find((c) => c.target === 'share');
  if (share && process.env.SHARE_DIRECTORY) {
    const p = path.resolve(process.env.SHARE_DIRECTORY, share.remotePath!);
    if (p.startsWith(path.resolve(process.env.SHARE_DIRECTORY) + path.sep) && fs.existsSync(p)) return res.type(record.mimeType).sendFile(p, { dotfiles: 'allow' });
  }
  if (share && shareMode(db) === 'bridge') {
    const state = db.shareFetchState(record.id);
    if (state?.state === 'FAILED') throw new HttpError(404, `تعذر جلب الملف من المجلد المشترك: ${state.error || 'غير موجود'}`, 'SHARE_FETCH_FAILED');
    db.requestShareFetch(record.id);
    res.setHeader('Retry-After', '5');
    throw new HttpError(503, bridgeOnline(db) ? 'يُجلب الملف من المجلد المشترك الآن؛ أعد المحاولة بعد لحظات' : 'الملف في المجلد المشترك وجسر مدار غير متصل الآن', 'SHARE_FETCHING');
  }
  throw new HttpError(404, 'الملف غير موجود');
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function storageStatus(db: NewsroomDatabase, req: Request): StorageStatus {
  const s = settingsOf(db);
  const dbx = dropboxCredentials(db);
  const gd = driveCredentials(db);
  const hb = bridgeHeartbeat(db);
  const q = db.copyQueueSummary();
  return {
    dropbox: { enabled: s.dropbox.enabled, connected: !!dbx, managedByEnvironment: !!dbx?.fromEnv, account: dbx?.account, root: dropboxPath(s.dropbox.rootPath) || '/', lastError: lastErrors.dropbox },
    gdrive: { enabled: s.gdrive.enabled, connected: !!gd, managedByEnvironment: !!gd?.fromEnv, account: gd?.account, root: s.gdrive.rootFolderId ? `مجلد ${s.gdrive.rootFolderId.slice(0, 8)}…` : s.gdrive.rootName, lastError: lastErrors.gdrive },
    share: {
      enabled: s.share.enabled,
      mode: shareMode(db),
      bridgeOnline: bridgeOnline(db),
      bridgeLastSeen: hb?.at,
      bridgeVersion: hb?.version,
      hasBridgeToken: !!db.getMeta('storage.bridge.tokenHash'),
      displayPath: s.share.displayPath,
      indexedFiles: db.shareIndexCount(),
      indexedAt: db.getMeta('storage.share.indexedAt') || undefined,
    },
    isLocal: isLocalRequest(db, req),
    queue: { pending: q.pending, failed: q.failed, done: q.done },
  };
}

/** Pending Google sign-ins (state → who asked and with which keys). */
const driveStates = new Map<string, { clientId: string; clientSecret: string; redirectUri: string; userId: string; expires: number }>();

function publicOrigin(config: AppConfig, req: Request): string {
  return (config.appUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

export function registerStorageRoutes(app: Express, deps: Deps) {
  const { db, config, HttpError, wrap, audit } = deps;
  const admin = requirePermission('system.settings');
  const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  app.get('/api/v1/storage/status', (req, res) => {
    if (!req.auth) throw new HttpError(401, 'يجب تسجيل الدخول أولاً', 'UNAUTHENTICATED');
    res.json({ success: true, data: storageStatus(db, req) });
  });

  /** Where the copies of some library files are (for the badges in the library). */
  app.post('/api/v1/storage/copies', requirePermission('media.view'), requireModule('media'), (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === 'string' && /^[A-Za-z0-9_-]+$/.test(x)).slice(0, 1000) : [];
    const map = db.copiesFor(ids);
    const data: Record<string, StorageCopy[]> = {};
    for (const [id, copies] of map) data[id] = copies.map((c) => ({ target: c.target, state: c.state, path: c.target === 'gdrive' ? undefined : c.remotePath, error: c.error }));
    res.json({ success: true, data });
  });

  // --- Dropbox --------------------------------------------------------------

  app.post('/api/v1/storage/dropbox/authorize-url', admin, (req, res) => {
    const appKey = str(req.body?.appKey, 100);
    if (!/^[a-z0-9]{5,40}$/i.test(appKey)) throw new HttpError(400, 'مفتاح تطبيق Dropbox غير صالح');
    res.json({ success: true, data: { url: dropboxAuthorizeUrl(appKey) } });
  });

  app.post(
    '/api/v1/storage/dropbox/connect',
    admin,
    wrap(async (req: Request, res: Response) => {
      if (dropboxCredentials(db)?.fromEnv) throw new HttpError(409, 'مفاتيح Dropbox محددة في إعدادات الخادم ولا تُغيّر من هنا');
      const appKey = str(req.body?.appKey, 100);
      const appSecret = str(req.body?.appSecret, 200);
      const code = str(req.body?.code, 400);
      if (!appKey || !appSecret || !code) throw new HttpError(400, 'مفتاح التطبيق وسرّه ورمز التفويض مطلوبة');
      let refreshToken: string;
      try {
        ({ refreshToken } = await exchangeAuthorizationCode(appKey, appSecret, code));
      } catch (err) {
        throw new HttpError(400, err instanceof DropboxError ? err.message : 'تعذر الاتصال بـ Dropbox');
      }
      const client = new DropboxClient({ appKey, appSecret, refreshToken });
      const account = await client.account().catch(() => ({ name: 'Dropbox' }));
      db.setMeta('storage.dropbox.credentials', JSON.stringify({ creds: { appKey, appSecret, refreshToken }, account: account.name, connectedAt: new Date().toISOString() }));
      delete lastErrors.dropbox;
      audit(req.auth!.user, 'STORAGE_CONNECTED', 'SETTINGS', 'dropbox', 'SECURITY', `ربط Dropbox بحساب ${account.name}`, req.ip);
      res.json({ success: true, data: storageStatus(db, req) });
    })
  );

  app.post('/api/v1/storage/dropbox/disconnect', admin, (req, res) => {
    if (dropboxCredentials(db)?.fromEnv) throw new HttpError(409, 'مفاتيح Dropbox محددة في إعدادات الخادم ولا تُغيّر من هنا');
    db.setMeta('storage.dropbox.credentials', '');
    clients.dropbox = undefined;
    audit(req.auth!.user, 'STORAGE_DISCONNECTED', 'SETTINGS', 'dropbox', 'SECURITY', 'فصل Dropbox', req.ip);
    res.json({ success: true, data: storageStatus(db, req) });
  });

  // --- Google Drive ---------------------------------------------------------

  app.post('/api/v1/storage/gdrive/authorize-url', admin, (req, res) => {
    if (driveCredentials(db)?.fromEnv) throw new HttpError(409, 'مفاتيح Google Drive محددة في إعدادات الخادم ولا تُغيّر من هنا');
    const clientId = str(req.body?.clientId, 300);
    const clientSecret = str(req.body?.clientSecret, 300);
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId) || !clientSecret) throw new HttpError(400, 'معرّف عميل Google وسرّه مطلوبان (المعرّف ينتهي بـ apps.googleusercontent.com)');
    const state = crypto.randomBytes(24).toString('base64url');
    const redirectUri = `${publicOrigin(config, req)}/api/v1/storage/gdrive/callback`;
    for (const [k, v] of driveStates) if (v.expires < Date.now()) driveStates.delete(k);
    driveStates.set(state, { clientId, clientSecret, redirectUri, userId: req.auth!.user.id, expires: Date.now() + 15 * 60_000 });
    res.json({ success: true, data: { url: driveAuthorizeUrl(clientId, redirectUri, state), redirectUri } });
  });

  // Google sends the administrator back here after they approve access.
  app.get(
    '/api/v1/storage/gdrive/callback',
    wrap(async (req: Request, res: Response) => {
      const state = str(req.query.state, 100);
      const pending = driveStates.get(state);
      driveStates.delete(state);
      const back = (result: string) => res.redirect(`/settings?storage=${result}`);
      if (!pending || pending.expires < Date.now() || req.auth?.user.id !== pending.userId || !req.auth.can('system.settings')) return back('gdrive-expired');
      if (req.query.error || !req.query.code) return back('gdrive-denied');
      try {
        const { refreshToken } = await exchangeDriveCode(pending.clientId, pending.clientSecret, str(req.query.code, 1000), pending.redirectUri);
        const creds = { clientId: pending.clientId, clientSecret: pending.clientSecret, refreshToken };
        const account = await new DriveClient(creds).account().catch(() => ({ name: 'Google Drive' }));
        db.setMeta('storage.gdrive.credentials', JSON.stringify({ creds, account: account.name, connectedAt: new Date().toISOString() }));
        delete lastErrors.gdrive;
        audit(req.auth.user, 'STORAGE_CONNECTED', 'SETTINGS', 'gdrive', 'SECURITY', `ربط Google Drive بحساب ${account.name}`, req.ip);
        return back('gdrive-connected');
      } catch (err) {
        logger.warn('google drive connection failed', { error: String((err as any)?.detail || err) });
        return back('gdrive-failed');
      }
    })
  );

  app.post('/api/v1/storage/gdrive/disconnect', admin, (req, res) => {
    if (driveCredentials(db)?.fromEnv) throw new HttpError(409, 'مفاتيح Google Drive محددة في إعدادات الخادم ولا تُغيّر من هنا');
    db.setMeta('storage.gdrive.credentials', '');
    clients.gdrive = undefined;
    audit(req.auth!.user, 'STORAGE_DISCONNECTED', 'SETTINGS', 'gdrive', 'SECURITY', 'فصل Google Drive', req.ip);
    res.json({ success: true, data: storageStatus(db, req) });
  });

  // --- Searching and bringing files in ------------------------------------

  const cloudOr404 = (provider: string): CloudProviderId => {
    if (provider !== 'dropbox' && provider !== 'gdrive') throw new HttpError(404, 'المسار غير موجود');
    if (!activeClouds(db).includes(provider)) throw new HttpError(409, `${CLOUD_NAMES[provider]} غير مفعّل أو غير مربوط`);
    return provider;
  };
  const cloudError = (err: unknown) => {
    if (err instanceof DropboxError || err instanceof DriveError) throw new HttpError(err.status === 404 ? 404 : 502, err.message);
    throw err;
  };

  // Registered before the /:provider routes, which would otherwise take «share».
  app.get('/api/v1/storage/share/search', requirePermission('media.view'), requireModule('media'), (req, res) => {
    const s = settingsOf(db).share;
    if (!s.enabled) throw new HttpError(409, 'المجلد المشترك غير مفعّل');
    const query = str(req.query.q, 200);
    if (query.length < 2) throw new HttpError(400, 'اكتب حرفين على الأقل للبحث');
    res.json({ success: true, data: db.searchShareIndex(query).map((r) => ({ ref: r.path, name: r.name, path: r.path, size: r.sizeBytes, modifiedAt: r.modifiedAt, supported: !!mimeForName(r.name) })) });
  });

  app.get(
    '/api/v1/storage/:provider/search',
    requirePermission('media.view'), requireModule('media'),
    wrap(async (req: Request<Record<string, string>>, res: Response) => {
      const provider = cloudOr404(req.params.provider);
      const query = str(req.query.q, 200);
      if (query.length < 2) throw new HttpError(400, 'اكتب حرفين على الأقل للبحث');
      try {
        const items =
          provider === 'dropbox'
            ? (await dropboxClient(db)!.search(query, dropboxPath(settingsOf(db).dropbox.rootPath))).filter((e) => !e.isFolder).map((e) => ({ ref: e.path, name: e.name, path: e.path, size: e.size, modifiedAt: e.modifiedAt }))
            : (await driveClient(db)!.search(query)).map((e) => ({ ref: e.id, name: e.name, path: e.name, size: e.size, modifiedAt: e.modifiedAt }));
        res.json({ success: true, data: items.map((i) => ({ ...i, supported: !!mimeForName(i.name) })) });
      } catch (err) {
        cloudError(err);
      }
    })
  );

  app.get(
    '/api/v1/storage/:provider/list',
    requirePermission('media.view'), requireModule('media'),
    wrap(async (req: Request<Record<string, string>>, res: Response) => {
      const provider = cloudOr404(req.params.provider);
      const at = str(req.query.at, 1000);
      try {
        if (provider === 'dropbox') {
          const root = dropboxPath(settingsOf(db).dropbox.rootPath);
          const folder = at && dropboxPath(at).toLowerCase().startsWith(root.toLowerCase()) ? dropboxPath(at) : root;
          const entries = await dropboxClient(db)!.list(folder);
          res.json({ success: true, data: { at: folder, items: entries.map((e) => ({ ref: e.path, name: e.name, path: e.path, size: e.size, modifiedAt: e.modifiedAt, isFolder: e.isFolder, supported: !e.isFolder && !!mimeForName(e.name) })) } });
        } else {
          const client = driveClient(db)!;
          const folder = /^[A-Za-z0-9_-]{5,200}$/.test(at) ? at : await driveRootId(db, client);
          const entries = await client.list(folder);
          res.json({ success: true, data: { at: folder, items: entries.map((e) => ({ ref: e.id, name: e.name, path: e.name, size: e.size, modifiedAt: e.modifiedAt, isFolder: e.isFolder, supported: !e.isFolder && !!mimeForName(e.name) })) } });
        }
      } catch (err) {
        cloudError(err);
      }
    })
  );

  /** Makes a cloud file part of the library without copying it to the server. */
  app.post(
    '/api/v1/storage/:provider/import',
    requireModule('media'),
    requirePermission('media.upload'),
    wrap(async (req: Request<Record<string, string>>, res: Response) => {
      const provider = req.params.provider === 'share' ? 'share' : cloudOr404(req.params.provider);
      const ref = str(req.body?.ref, 1000);
      if (!ref) throw new HttpError(400, 'الملف المطلوب غير محدد');
      let name = '';
      let size = 0;
      try {
        if (provider === 'dropbox') {
          const root = dropboxPath(settingsOf(db).dropbox.rootPath).toLowerCase();
          const p = dropboxPath(ref);
          // Search covers the station folder only; refuse paths outside it.
          if (root && !p.toLowerCase().startsWith(root + '/')) throw new HttpError(403, 'الملف خارج مجلد المحطة في Dropbox');
          const listing = await dropboxClient(db)!.list(p.slice(0, p.lastIndexOf('/')) || '');
          const entry = listing.find((e) => e.path.toLowerCase() === p.toLowerCase() && !e.isFolder);
          if (!entry) throw new HttpError(404, 'الملف غير موجود في Dropbox');
          name = entry.name;
          size = entry.size;
        } else if (provider === 'gdrive') {
          if (!/^[A-Za-z0-9_-]{5,200}$/.test(ref)) throw new HttpError(400, 'معرّف الملف غير صالح');
          const entry = await driveClient(db)!.get(ref);
          if (entry.isFolder) throw new HttpError(400, 'اختر ملفاً لا مجلداً');
          name = entry.name;
          size = entry.size;
        } else {
          const s = settingsOf(db).share;
          if (!s.enabled || shareMode(db) === 'none') throw new HttpError(409, 'المجلد المشترك غير مفعّل');
          const entry = db.getShareIndexEntry(ref);
          if (!entry) throw new HttpError(404, 'الملف غير موجود في فهرس المجلد المشترك');
          name = entry.name;
          size = entry.sizeBytes;
        }
      } catch (err) {
        cloudError(err);
      }
      const mimeType = mimeForName(name);
      if (!mimeType) throw new HttpError(415, 'نوع الملف غير مدعوم في المكتبة');
      const record: UploadRecord = {
        id: newId('upl'),
        storedName: '',
        originalName: name,
        mimeType,
        sizeBytes: size,
        uploadedBy: req.auth!.user.id,
        createdAt: new Date().toISOString(),
        localEvicted: true,
      };
      db.insertUpload(record);
      db.queueCopy(record.id, provider, 'DONE', provider === 'dropbox' ? dropboxPath(ref) : ref);
      res.status(201).json({ success: true, data: { id: record.id, url: `${MEDIA_FILE_URL_PREFIX}${record.id}`, mimeType, sizeBytes: size, originalName: name } });
    })
  );

  // --- Administration -------------------------------------------------------

  app.get('/api/v1/storage/queue', admin, (_req, res) => {
    res.json({ success: true, data: db.copyQueueSummary() });
  });

  app.post('/api/v1/storage/queue/retry', admin, (req, res) => {
    const n = db.retryFailedCopies();
    audit(req.auth!.user, 'STORAGE_RETRY', 'SETTINGS', 'storage', 'INFO', `إعادة محاولة نسخ ${n} ملف`, req.ip);
    res.json({ success: true, data: { retried: n } });
  });

  app.post('/api/v1/storage/sync-now', admin, wrap(async (req: Request, res: Response) => {
    const done = await runStorageSync(db, config);
    res.json({ success: true, data: { done, status: storageStatus(db, req) } });
  }));

  /** A new token for «جسر مدار»; shown once, only its hash is kept. */
  app.post('/api/v1/storage/bridge/token', admin, (req, res) => {
    const token = `mdb_${crypto.randomBytes(32).toString('base64url')}`;
    db.setMeta('storage.bridge.tokenHash', hashToken(token));
    audit(req.auth!.user, 'BRIDGE_TOKEN_CREATED', 'SETTINGS', 'bridge', 'SECURITY', 'إصدار رمز جديد لجسر مدار (الرمز السابق لم يعد صالحاً)', req.ip);
    res.json({ success: true, data: { token } });
  });

  /** The bridge program itself, to copy to a computer inside the network. */
  app.get('/api/v1/storage/bridge/program', admin, (_req, res) => {
    const file = path.join(process.cwd(), 'bridge', 'madar-bridge.mjs');
    if (!fs.existsSync(file)) throw new HttpError(404, 'ملف الجسر غير موجود في هذا التثبيت');
    res.setHeader('Content-Disposition', 'attachment; filename="madar-bridge.mjs"');
    res.type('text/javascript').sendFile(file, { dotfiles: 'allow' });
  });

  app.post('/api/v1/storage/bridge/revoke', admin, (req, res) => {
    db.setMeta('storage.bridge.tokenHash', '');
    db.setMeta('storage.bridge.heartbeat', '');
    audit(req.auth!.user, 'BRIDGE_TOKEN_REVOKED', 'SETTINGS', 'bridge', 'SECURITY', 'إلغاء رمز جسر مدار', req.ip);
    res.json({ success: true });
  });

  // --- «جسر مدار» (the bridge program on the local network) ----------------

  const bridgeOnly = (req: Request, _res: Response, next: NextFunction) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const expected = db.getMeta('storage.bridge.tokenHash');
    const ok = !!token && !!expected && crypto.timingSafeEqual(Buffer.from(hashToken(token)), Buffer.from(expected.padEnd(64, '0').slice(0, 64)));
    if (!ok) return next(new HttpError(401, 'رمز الجسر غير صالح', 'BRIDGE_UNAUTHORIZED'));
    next();
  };

  app.post('/api/v1/bridge/heartbeat', bridgeOnly, (req, res) => {
    db.setMeta('storage.bridge.heartbeat', JSON.stringify({ at: new Date().toISOString(), version: str(req.body?.version, 20) }));
    const s = settingsOf(db).share;
    res.json({ success: true, data: { enabled: s.enabled, serverVersion: BRIDGE_VERSION } });
  });

  app.get('/api/v1/bridge/jobs', bridgeOnly, (_req, res) => {
    const s = settingsOf(db).share;
    const copies = s.enabled
      ? db.dueCopies('share', 5).map((c) => {
          const u = db.getUpload(c.uploadId);
          return u ? { uploadId: u.id, name: safeFileName(u.originalName), folder: datedFolder(new Date(u.createdAt)), size: u.sizeBytes } : null;
        }).filter(Boolean)
      : [];
    res.json({ success: true, data: { copies, fetches: s.enabled ? db.pendingShareFetches(5) : [] } });
  });

  app.get('/api/v1/bridge/files/:id', bridgeOnly, wrap(async (req: Request<Record<string, string>>, res: Response) => {
    const record = /^[A-Za-z0-9_-]+$/.test(req.params.id) ? db.getUpload(req.params.id) : null;
    if (!record) throw new HttpError(404, 'الملف غير موجود');
    res.setHeader('Content-Disposition', 'attachment');
    await sendStoredFile(db, config, req, res, record, HttpError);
  }));

  app.post('/api/v1/bridge/copies/:id', bridgeOnly, (req: Request<Record<string, string>>, res) => {
    const id = req.params.id;
    const p = str(req.body?.path, 1000).replace(/\\/g, '/');
    if (req.body?.ok === true && p && !p.split('/').includes('..')) {
      db.finishCopy(id, 'share', p);
      maybeEvict(db, config, id);
    } else {
      db.failCopy(id, 'share', str(req.body?.error, 300) || 'تعذر الحفظ في المجلد المشترك');
    }
    res.json({ success: true });
  });

  /** The bridge sends a file someone asked for from the shared folder; it becomes the server's copy. */
  app.put('/api/v1/bridge/fetches/:id', bridgeOnly, wrap(async (req: Request<Record<string, string>>, res: Response) => {
    const record = /^[A-Za-z0-9_-]+$/.test(req.params.id) ? db.getUpload(req.params.id) : null;
    if (!record) throw new HttpError(404, 'الملف غير موجود');
    if (req.get('x-fetch-error')) {
      db.finishShareFetch(record.id, str(decodeURIComponent(req.get('x-fetch-error')!), 300));
      req.resume();
      return res.json({ success: true });
    }
    const ext = ALLOWED_UPLOAD_TYPES[record.mimeType] || path.extname(record.originalName).slice(1).replace(/[^a-z0-9]/gi, '') || 'bin';
    const storedName = record.storedName || `${record.id}.${ext}`;
    const dir = uploadsDir(config.dataDir);
    await fs.promises.mkdir(dir, { recursive: true });
    const finalPath = path.join(dir, storedName);
    const tmp = `${finalPath}.part`;
    let size = 0;
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > config.mediaMaxUploadBytes * 4) {
          req.unpipe(out);
          out.destroy();
          reject(new HttpError(413, 'الملف أكبر من المسموح'));
        }
      });
      out.on('error', reject);
      out.on('finish', resolve);
      req.pipe(out);
    }).catch(async (err) => {
      await fs.promises.rm(tmp, { force: true });
      throw err;
    });
    await fs.promises.rename(tmp, finalPath);
    db.updateUploadStorage(record.id, storedName, size);
    db.setUploadEvicted(record.id, false);
    db.finishShareFetch(record.id);
    res.json({ success: true });
  }));

  app.post('/api/v1/bridge/index', bridgeOnly, (req, res) => {
    const files = Array.isArray(req.body?.files) ? req.body.files.slice(0, 5000) : [];
    const scanStartedAt = str(req.body?.scanStartedAt, 40);
    if (!scanStartedAt || Number.isNaN(Date.parse(scanStartedAt))) throw new HttpError(400, 'بداية الفهرسة مطلوبة');
    const rows = files
      .filter((f: any) => typeof f?.path === 'string' && f.path.length <= 1000 && !f.path.split(/[\\/]/).includes('..'))
      .map((f: any) => ({
        path: f.path.replace(/\\/g, '/'),
        name: str(f.name || path.posix.basename(f.path.replace(/\\/g, '/')), 300),
        sizeBytes: Math.max(0, Number(f.size) || 0),
        modifiedAt: typeof f.modifiedAt === 'string' ? f.modifiedAt.slice(0, 40) : undefined,
      }));
    db.indexShareFiles(rows, scanStartedAt, req.body?.finished === true);
    res.json({ success: true, data: { indexed: db.shareIndexCount() } });
  });
}
