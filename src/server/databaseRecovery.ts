import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { NewsroomDatabase } from './db';
import type { BackupRehearsal } from '../shared/databaseDiagnostics';

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

export async function withStableBackup<T>(db: NewsroomDatabase, fileName: string, tempRoot: string,
  work: (source: string, sha256: string) => Promise<T>): Promise<T> {
  const source = db.backupFilePath(fileName);
  ensureRoot(tempRoot);
  const directory = await fs.promises.mkdtemp(path.join(tempRoot, 'rehearsal-'));
  try {
    const copy = path.join(directory, 'snapshot.sqlite');
    await fs.promises.copyFile(source, copy, fs.constants.COPYFILE_EXCL);
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(copy)) hash.update(chunk);
    return await work(copy, hash.digest('hex'));
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

export async function rehearseBackup(db: NewsroomDatabase, fileName: string, tempRoot: string): Promise<BackupRehearsal> {
  return withStableBackup(db, fileName, tempRoot, async (source, sha256) => {
    const probe = new Database(source, { readonly: true, fileMustExist: true });
    try {
      if (probe.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Invalid snapshot');
      db.checkBackupSchema(probe);
      const rows = probe.prepare('SELECT collection, COUNT(*) AS count FROM entities WHERE deleted = 0 GROUP BY collection').all() as { collection: string; count: number }[];
      const counts: Record<string, number> = {};
      for (const row of rows) if (db.isKnownCollection(row.collection)) counts[row.collection] = row.count;
      return { fileName, sha256, checkedAt: new Date().toISOString(), version: '3.23.0', compatible: true, counts,
        mediaVerified: false };
    } finally { probe.close(); }
  });
}
