import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import type { NewsroomDatabase } from './db';

const run = promisify(execFile);
const bundleName = /^newsroom_backup_[0-9TZ-]+(?:_[a-z]+)?\.sqlite\.bundle$/;

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
  try {
    if (snapshot.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Backup database failed integrity check');
    uploads = snapshot.prepare('SELECT stored_name, size_bytes FROM uploads').all() as typeof uploads;
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
  await fs.writeFile(path.join(staging, 'manifest.json'), JSON.stringify({ format: 1, createdAt: new Date().toISOString(), files }, null, 2), { flag: 'wx' });
  await fs.rename(staging, bundle);
  if (options.directory) {
    const directory = path.resolve(options.directory);
    const relative = path.relative(db.dataDir, directory);
    if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw new Error('External backup directory must be outside DATA_DIR');
    const pending = path.join(directory, `${name}.pending`);
    await fs.mkdir(directory, { recursive: true });
    await fs.cp(bundle, pending, { recursive: true, errorOnExist: true, force: false });
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
  return { bundle, uploads: uploads.length };
}
