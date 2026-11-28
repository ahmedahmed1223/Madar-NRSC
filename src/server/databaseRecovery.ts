import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { NewsroomDatabase } from './db';
import type { BackupRehearsal } from '../shared/databaseDiagnostics';
import { APP_VERSION } from '../shared/releaseVersion';
import { backupHash, fetchPrimaryBackupSnapshot, primaryBackupBundleReader, readPrimaryBackup, withPrimaryBackupStaging } from './primaryBackupStorage';
import { verifyBackupBundle, type BackupSnapshotInventory } from './backupBundleVerification';

export class DatabaseOperationBusy extends Error {}
export class DatabaseOperationLock {
  private busy = false;
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy) throw new DatabaseOperationBusy('Database operation busy');
    this.busy = true;
    try { return await work(); } finally { this.busy = false; }
  }
}
const locks = new WeakMap<NewsroomDatabase, DatabaseOperationLock>();
export function databaseOperationLock(db: NewsroomDatabase) {
  let lock = locks.get(db);
  if (!lock) { lock = new DatabaseOperationLock(); locks.set(db, lock); }
  return lock;
}

const TEMP_NAME = /^rehearsal-[a-zA-Z0-9_-]+$/;
const REHEARSAL_EVIDENCE = 'last-backup-rehearsal.json';
export const BACKUP_REHEARSAL_VERSION = APP_VERSION;

export function readRehearsalEvidence(dataDir: string): string | null {
  try {
    return fs.readFileSync(path.join(dataDir, REHEARSAL_EVIDENCE), 'utf8');
  } catch {
    return null;
  }
}

async function recordRehearsal(dataDir: string, result: BackupRehearsal) {
  const target = path.join(dataDir, REHEARSAL_EVIDENCE);
  const pending = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(pending, JSON.stringify({ at: result.checkedAt, fileName: result.fileName }), { flag: 'wx', mode: 0o600 });
    await fs.promises.rename(pending, target);
  } finally {
    await fs.promises.unlink(pending).catch(() => {});
  }
}
function ensureRoot(root: string) {
  fs.mkdirSync(root, { recursive: true });
  if (fs.lstatSync(root).isSymbolicLink() || !fs.lstatSync(root).isDirectory()) throw new Error('Unsafe temporary directory');
}
export async function cleanupRehearsals(tempRoot: string): Promise<void> {
  ensureRoot(tempRoot);
  for (const name of fs.readdirSync(tempRoot)) {
    if (!TEMP_NAME.test(name)) continue;
    const target = path.resolve(tempRoot, name);
    if (path.dirname(target) !== path.resolve(tempRoot)) continue;
    const stat = fs.lstatSync(target);
    if (stat.isDirectory() && !stat.isSymbolicLink()) await fs.promises.rm(target, { recursive: true, force: true });
  }
}

export async function withBackupSource<T>(db: NewsroomDatabase, fileName: string, work: (source: string) => Promise<T>): Promise<T> {
  const primary = readPrimaryBackup(db.dataDir, fileName);
  if (!primary) return work(db.backupFilePath(fileName));
  return withPrimaryBackupStaging(db.dataDir, async directory => {
    const copy = path.join(directory, 'snapshot.sqlite');
    await fetchPrimaryBackupSnapshot(db.dataDir, primary, copy);
    return work(copy);
  });
}

export async function withStableBackup<T>(db: NewsroomDatabase, fileName: string, tempRoot: string,
  work: (source: string, sha256: string, directory: string, primary: ReturnType<typeof readPrimaryBackup>) => Promise<T>): Promise<T> {
  const primary = readPrimaryBackup(db.dataDir, fileName);
  ensureRoot(tempRoot);
  const directory = await fs.promises.mkdtemp(path.join(tempRoot, 'rehearsal-'));
  try {
    const copy = path.join(directory, 'snapshot.sqlite');
    if (primary) {
      await fetchPrimaryBackupSnapshot(db.dataDir, primary, copy);
      return await work(copy, primary.sha256, directory, primary);
    }
    await fs.promises.copyFile(db.backupFilePath(fileName), copy, fs.constants.COPYFILE_EXCL);
    return await work(copy, await backupHash(copy), directory, primary);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

export async function rehearseBackup(db: NewsroomDatabase, fileName: string, tempRoot: string): Promise<BackupRehearsal> {
  const result = await withStableBackup<BackupRehearsal>(db, fileName, tempRoot, async (source, sha256, directory, primary) => {
    const bundle = primary ? directory : db.backupFilePath(fileName) + '.bundle';
    // Older standalone snapshots have no associated media bundle.
    const exists = primary || await fs.promises.lstat(bundle).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    const bytes = exists ? (await fs.promises.stat(source)).size : 0;
    // The isolated probe can migrate an older snapshot before checking compatibility.
    const probe = new Database(source, { fileMustExist: true });
    const counts: Record<string, number> = {};
    let uploads: BackupSnapshotInventory['uploads'] | undefined;
    try {
      if (probe.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Invalid snapshot');
      db.checkBackupSchema(probe);
      const rows = probe.prepare('SELECT collection, COUNT(*) AS count FROM entities WHERE deleted = 0 GROUP BY collection').all() as { collection: string; count: number }[];
      for (const row of rows) if (db.isKnownCollection(row.collection)) counts[row.collection] = row.count;
      if (exists) {
        const columns = probe.pragma('table_info(uploads)') as { name: string }[];
        const evictable = columns.some(column => column.name === 'local_evicted');
        uploads = probe.prepare('SELECT stored_name, size_bytes' + (evictable ? ', local_evicted' : '') + ' FROM uploads').all() as BackupSnapshotInventory['uploads'];
      }
    } finally { probe.close(); }
    let mediaVerified = false;
    if (uploads) {
      const fetchFile = primary ? await primaryBackupBundleReader(db.dataDir, primary) : undefined;
      const inventory = { sha256, bytes, uploads };
      const verified = await verifyBackupBundle(bundle, { inventory, fetchFile });
      if (verified.valid === false) throw new Error(verified.reason);
      mediaVerified = verified.mediaVerified;
    }
    return { fileName, sha256, checkedAt: new Date().toISOString(), version: BACKUP_REHEARSAL_VERSION, compatible: true, counts, mediaVerified };
  });
  // Evidence survives restart without writing to the newsroom database being rehearsed.
  await recordRehearsal(db.dataDir, result);
  return result;
}
