import fs from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import type { NewsroomDatabase } from './db';
import type { VerifiedExternalBackup } from '../shared/databaseDiagnostics';
import { logger } from './logger';

const run = promisify(execFile);
const bundleName = /^newsroom_backup_[0-9TZ-]+(?:_[a-z]+)?\.sqlite\.bundle$/;
const EXTERNAL_EVIDENCE = 'backup_last_verified_external';
type ExternalTargets = { backupDirectory?: string; backupRemote?: string };
type BundleFile = { path: string; bytes: number; sha256: string };
const ABANDONED_STAGING_MS = 24 * 60 * 60 * 1000;

function externalTargets({ backupDirectory, backupRemote }: ExternalTargets) {
  const directory = backupDirectory ? path.resolve(backupDirectory) : '';
  const remote = (backupRemote || '').replace(/\/+$/, '');
  const targets: VerifiedExternalBackup['targets'] = [];
  if (directory) targets.push('directory');
  if (remote) targets.push('remote');
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify([directory, remote])).digest('hex');
  return { targets, fingerprint };
}

/** Evidence applies only to a complete bundle delivered to every current external target. */
export function lastVerifiedExternalBackup(db: Pick<NewsroomDatabase, 'getMeta'>, config: ExternalTargets): VerifiedExternalBackup | null {
  const { targets, fingerprint } = externalTargets(config);
  if (!targets.length) return null;
  try {
    const value = JSON.parse(db.getMeta(EXTERNAL_EVIDENCE) || 'null');
    if (value?.fingerprint !== fingerprint || !Number.isFinite(Date.parse(value.at)) || !bundleName.test(`${value.fileName}.bundle`)) return null;
    return { at: value.at, fileName: value.fileName, targets };
  } catch {
    return null;
  }
}

function outside(relative: string) {
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

async function digest(file: string) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function backupOrigin(db: Pick<NewsroomDatabase, 'dbId'>) {
  return crypto.createHash('sha256').update(db.dbId).digest('hex');
}

async function externalDirectory(dataDir: string, configured: string, create: boolean) {
  const directory = path.resolve(configured);
  if (!outside(path.relative(dataDir, directory))) throw new Error('External backup directory must be outside DATA_DIR');
  if (create) await fs.mkdir(directory, { recursive: true });
  const resolved = await fs.realpath(directory);
  if (!outside(path.relative(await fs.realpath(dataDir), resolved))) throw new Error('External backup directory must be outside DATA_DIR');
  return resolved;
}

async function cleanPending(root: string, suffix: string, olderThan = Infinity) {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith(suffix) || !bundleName.test(entry.name.slice(0, -suffix.length))) continue;
    const pending = path.join(root, entry.name);
    const stat = await fs.lstat(pending);
    if (stat.isDirectory() && stat.mtimeMs < olderThan) await fs.rm(pending, { recursive: true, force: true });
  }
}

export async function cleanupBackupStaging(db: Pick<NewsroomDatabase, 'backupsDir' | 'dataDir' | 'dbId'>, config: ExternalTargets) {
  if ((await fs.lstat(db.backupsDir)).isDirectory()) await cleanPending(db.backupsDir, '.pending');
  if (!config.backupDirectory) return;
  try {
    const directory = await externalDirectory(db.dataDir, config.backupDirectory, false);
    await cleanPending(directory, `.pending-${backupOrigin(db)}`, Date.now() - ABANDONED_STAGING_MS);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn('external backup staging cleanup failed');
  }
}

async function withStaging<T>(staging: string, write: () => Promise<T>) {
  await fs.mkdir(staging, { mode: 0o700 });
  try {
    return await write();
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => logger.warn('backup staging cleanup failed'));
  }
}

async function buildBundle(db: NewsroomDatabase, fileName: string, staging: string, origin: string) {
  await fs.mkdir(path.join(staging, 'uploads'));
  await fs.copyFile(path.join(db.backupsDir, fileName), path.join(staging, 'newsroom.sqlite'));
  const snapshot = new Database(path.join(staging, 'newsroom.sqlite'), { readonly: true, fileMustExist: true });
  let uploads: { stored_name: string; size_bytes: number }[];
  // Files kept only in Dropbox, Google Drive or the shared folder (nothing on this server's disk).
  let elsewhere = 0;
  try {
    if (snapshot.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Backup database failed integrity check');
    const evictable = (snapshot.prepare('PRAGMA table_info(uploads)').all() as { name: string }[]).some((c) => c.name === 'local_evicted');
    const all = snapshot.prepare(`SELECT stored_name, size_bytes${evictable ? ', local_evicted' : ''} FROM uploads`).all() as { stored_name: string; size_bytes: number; local_evicted?: number }[];
    uploads = all.filter((u) => u.stored_name && !u.local_evicted);
    elsewhere = all.length - uploads.length;
  } finally { snapshot.close(); }
  const files: BundleFile[] = [];
  for (const upload of uploads) {
    if (path.basename(upload.stored_name) !== upload.stored_name) throw new Error('Unsafe upload path');
    const relative = `uploads/${upload.stored_name}`;
    const target = path.join(staging, relative);
    // An independent copy that shares disk blocks only on filesystems with copy-on-write support.
    await fs.copyFile(path.join(db.dataDir, relative), target, constants.COPYFILE_FICLONE);
    if ((await fs.stat(target)).size !== upload.size_bytes) throw new Error(`Incomplete upload: ${upload.stored_name}`);
    files.push({ path: relative, bytes: upload.size_bytes, sha256: await digest(target) });
  }
  const database = path.join(staging, 'newsroom.sqlite');
  files.push({ path: 'newsroom.sqlite', bytes: (await fs.stat(database)).size, sha256: await digest(database) });
  await fs.writeFile(path.join(staging, 'manifest.json'), JSON.stringify({ format: 1, origin, createdAt: new Date().toISOString(), files, ...(elsewhere ? { filesKeptElsewhere: elsewhere } : {}) }, null, 2), { flag: 'wx' });
  return { files, uploads: uploads.length, filesKeptElsewhere: elsewhere };
}

async function copyExternal(bundle: string, directory: string, name: string, origin: string, files: BundleFile[]) {
  const pending = path.join(directory, `${name}.pending-${origin}`);
  await withStaging(pending, async () => {
    const mode = constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL;
    await fs.mkdir(path.join(pending, 'uploads'));
    for (const file of files) await fs.copyFile(path.join(bundle, file.path), path.join(pending, file.path), mode);
    await fs.copyFile(path.join(bundle, 'manifest.json'), path.join(pending, 'manifest.json'), mode);
    if (await digest(path.join(pending, 'manifest.json')) !== await digest(path.join(bundle, 'manifest.json'))) throw new Error('External backup manifest checksum mismatch');
    for (const file of files) if (await digest(path.join(pending, file.path)) !== file.sha256) throw new Error('External backup checksum mismatch');
    await fs.rename(pending, path.join(directory, name));
  });
}

async function pruneExternal(directory: string, keep: string, origin: string, retention: number) {
  const owned: string[] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === keep || !bundleName.test(entry.name)) continue;
    try {
      const manifest = path.join(directory, entry.name, 'manifest.json');
      if (!(await fs.lstat(manifest)).isFile()) continue;
      const metadata = JSON.parse(await fs.readFile(manifest, 'utf8'));
      if (metadata.format === 1 && metadata.origin === origin && !metadata.filesKeptElsewhere && Array.isArray(metadata.files)) owned.push(entry.name);
    } catch { /* Legacy, unrelated and unreadable bundles stay untouched. */ }
  }
  for (const old of owned.sort().slice(0, Math.max(0, owned.length + 1 - retention))) {
    await fs.rm(path.join(directory, old), { recursive: true, force: true });
  }
}

/** A complete database snapshot plus every upload referenced by that snapshot. */
export async function deliverBackup(db: NewsroomDatabase, fileName: string,
  options: { directory?: string; remote?: string; retention: number }) {
  if (path.basename(fileName) !== fileName || !bundleName.test(`${fileName}.bundle`)) throw new Error('Invalid backup name');
  const name = `${fileName}.bundle`;
  const origin = backupOrigin(db);
  const staging = path.join(db.backupsDir, `${name}.pending`);
  const bundle = path.join(db.backupsDir, name);
  const { files, uploads, filesKeptElsewhere } = await withStaging(staging, async () => {
    const result = await buildBundle(db, fileName, staging, origin);
    await fs.rename(staging, bundle);
    return result;
  });
  const directory = options.directory ? await externalDirectory(db.dataDir, options.directory, true) : undefined;
  if (directory) await copyExternal(bundle, directory, name, origin, files);
  if (options.remote) {
    if (options.remote.startsWith('-') || !/^[a-zA-Z0-9_-]+:.+/.test(options.remote)) throw new Error('Use a configured rclone remote:path');
    const destination = `${options.remote.replace(/\/$/, '')}/${name}`;
    await run('rclone', ['copy', bundle, destination, '--immutable'], { timeout: 60 * 60 * 1000, windowsHide: true });
    await run('rclone', ['check', bundle, destination, '--one-way', '--download'], { timeout: 60 * 60 * 1000, windowsHide: true });
  }
  const retained = (await fs.readdir(db.backupsDir)).filter(file => bundleName.test(file)).sort();
  for (const old of retained.slice(0, Math.max(0, retained.length - options.retention))) {
    await fs.rm(path.join(db.backupsDir, old), { recursive: true });
  }
  if (directory && filesKeptElsewhere === 0) {
    await pruneExternal(directory, name, origin, options.retention).catch(() => logger.warn('external backup retention failed'));
  }
  return { bundle, uploads, filesKeptElsewhere };
}

/**
 * The one full backup, used by the schedule and by «نسخة احتياطية كاملة الآن»: a database snapshot,
 * then the bundle with every referenced upload and a SHA-256 manifest, copied to BACKUP_DIRECTORY
 * and BACKUP_REMOTE when configured. The delivery outcome is recorded for the backup status.
 */
export async function createFullBackup(db: NewsroomDatabase, config: { backupRetention: number; backupDirectory?: string; backupRemote?: string }, kind?: 'auto') {
  const file = await db.createBackup(kind, config.backupRetention);
  try {
    const result = await deliverBackup(db, file.fileName, { directory: config.backupDirectory, remote: config.backupRemote, retention: config.backupRetention });
    const at = new Date().toISOString();
    const { targets, fingerprint } = externalTargets(config);
    if (targets.length && result.filesKeptElsewhere === 0) {
      db.setMeta(EXTERNAL_EVIDENCE, JSON.stringify({ at, fileName: file.fileName, fingerprint }));
    }
    db.setMeta('backup_last_delivery', JSON.stringify({ at, status: 'ok' }));
    return { file, ...result };
  } catch (error) {
    db.setMeta('backup_last_delivery', JSON.stringify({ at: new Date().toISOString(), status: 'failed' }));
    throw error;
  }
}
