import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import type { NewsroomDatabase } from './db';
import type { VerifiedExternalBackup } from '../shared/databaseDiagnostics';

const run = promisify(execFile);
const bundleName = /^newsroom_backup_[0-9TZ-]+(?:_[a-z]+)?\.sqlite\.bundle$/;
const EXTERNAL_EVIDENCE = 'backup_last_verified_external';
type ExternalTargets = { backupDirectory?: string; backupRemote?: string };

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

/** A complete database snapshot plus every upload referenced by that snapshot. */
export async function deliverBackup(db: NewsroomDatabase, fileName: string,
  options: { directory?: string; remote?: string; retention: number }) {
  if (path.basename(fileName) !== fileName || !bundleName.test(`${fileName}.bundle`)) throw new Error('Invalid backup name');
  const name = `${fileName}.bundle`;
  const staging = path.join(db.backupsDir, `${name}.pending`);
  const bundle = path.join(db.backupsDir, name);
  await fs.mkdir(path.join(staging, 'uploads'), { recursive: true });
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
  const files: { path: string; bytes: number; sha256: string }[] = [];
  for (const upload of uploads) {
    if (path.basename(upload.stored_name) !== upload.stored_name) throw new Error('Unsafe upload path');
    const relative = `uploads/${upload.stored_name}`;
    const target = path.join(staging, relative);
    await fs.copyFile(path.join(db.dataDir, relative), target);
    if ((await fs.stat(target)).size !== upload.size_bytes) throw new Error(`Incomplete upload: ${upload.stored_name}`);
    files.push({ path: relative, bytes: upload.size_bytes, sha256: await digest(target) });
  }
  const database = path.join(staging, 'newsroom.sqlite');
  files.push({ path: 'newsroom.sqlite', bytes: (await fs.stat(database)).size, sha256: await digest(database) });
  await fs.writeFile(path.join(staging, 'manifest.json'), JSON.stringify({ format: 1, createdAt: new Date().toISOString(), files, ...(elsewhere ? { filesKeptElsewhere: elsewhere } : {}) }, null, 2), { flag: 'wx' });
  await fs.rename(staging, bundle);
  if (options.directory) {
    const directory = path.resolve(options.directory);
    if (!outside(path.relative(db.dataDir, directory))) throw new Error('External backup directory must be outside DATA_DIR');
    const pending = path.join(directory, `${name}.pending`);
    await fs.mkdir(directory, { recursive: true });
    if (!outside(path.relative(await fs.realpath(db.dataDir), await fs.realpath(directory)))) throw new Error('External backup directory must be outside DATA_DIR');
    await fs.cp(bundle, pending, { recursive: true, errorOnExist: true, force: false });
    if (await digest(path.join(pending, 'manifest.json')) !== await digest(path.join(bundle, 'manifest.json'))) throw new Error('External backup manifest checksum mismatch');
    for (const file of files) if (await digest(path.join(pending, file.path)) !== file.sha256) throw new Error('External backup checksum mismatch');
    await fs.rename(pending, path.join(directory, name));
  }
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
  return { bundle, uploads: uploads.length, filesKeptElsewhere: elsewhere };
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
