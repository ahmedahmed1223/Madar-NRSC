import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs, { constants, createReadStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { PrimaryStorageTarget } from '../shared/storage';
import { storageOf } from '../shared/storage';
import type { NewsroomDatabase } from './db';
import { logger } from './logger';

type BackupFile = ReturnType<NewsroomDatabase['listBackups']>[number];
type BackupDb = Pick<NewsroomDatabase, 'dataDir' | 'dbId' | 'getRow'>;
type Carrier = Exclude<PrimaryStorageTarget, 'local'>;
export type BackupTransportConfig = {
  backupDirectory?: string;
  backupNasDirectory?: string;
  backupRemote?: string;
  backupDropboxRemote?: string;
  backupGDriveRemote?: string;
};
export type BackupBundleFile = { path: string; bytes: number; sha256: string };
export type BackupCarrier = { kind: Carrier; root: string };
type Entry = { format: 1; file: BackupFile; carrier: BackupCarrier; artifact: string; sha256: string };

const run = promisify(execFile);
const FILE_NAME = /^newsroom_backup_[0-9TZ-]+(?:_[a-z]+)?\.sqlite$/;
const ARTIFACT = /^newsroom_backup_[0-9TZ-]+(?:_[a-z]+)?\.sqlite\.bundle-[a-f0-9]{16}-[a-f0-9-]{36}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const STAGING_NAME = /^backup-[a-zA-Z0-9_-]+$/;
export const NAS_BACKUP_FOLDER = '.madar-backups';
export const isNasBackupPath = (value: string) => value.split(/[\\/]/).some(part => part.toLowerCase() === NAS_BACKUP_FOLDER);
const REMOTE = /^([a-zA-Z0-9_-]+):([^:\r\n]+)$/;
const transfer = { timeout: 60 * 60 * 1000, windowsHide: true };

function outside(relative: string) {
  return relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
}

export async function backupHash(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function mountedBackupDirectory(dataDir: string, configured: string, create = false) {
  const target = path.resolve(configured);
  if (!outside(path.relative(dataDir, target))) throw new Error('External backup directory must be outside DATA_DIR');
  if (create) await fsp.mkdir(target, { recursive: true });
  const resolved = await fsp.realpath(target);
  if (!outside(path.relative(await fsp.realpath(dataDir), resolved))) throw new Error('External backup directory must be outside DATA_DIR');
  if (!(await fsp.stat(resolved)).isDirectory()) throw new Error('Invalid external backup directory');
  return resolved;
}

async function nasBackupDirectory(dataDir: string, configured: string, create = false) {
  const directory = path.join(await mountedBackupDirectory(dataDir, configured), NAS_BACKUP_FOLDER);
  if (create) await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fsp.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid NAS archive directory');
  return directory;
}

function privateDirectory(directory: string) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe backup work directory');
  return directory;
}

const catalog = (dataDir: string) => path.join(dataDir, 'backup-catalog');
const staging = (dataDir: string) => path.join(dataDir, 'backup-staging');
const filename = (dataDir: string, name: string) => path.join(catalog(dataDir), name + '.json');

export async function withPrimaryBackupStaging<T>(dataDir: string, work: (directory: string) => Promise<T>) {
  const directory = await fsp.mkdtemp(path.join(privateDirectory(staging(dataDir)), 'backup-'));
  try { return await work(directory); }
  finally { await fsp.rm(directory, { recursive: true, force: true }).catch(() => logger.warn('primary backup staging cleanup failed')); }
}

export async function cleanupPrimaryBackupStaging(db: Pick<BackupDb, 'dataDir' | 'dbId'>, config: BackupTransportConfig) {
  const root = privateDirectory(staging(db.dataDir));
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.isSymbolicLink() && STAGING_NAME.test(entry.name)) {
      await fsp.rm(path.join(root, entry.name), { recursive: true, force: true });
    }
  }
  const catalogRoot = privateDirectory(catalog(db.dataDir));
  for (const entry of await fsp.readdir(catalogRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.tmp') && ARTIFACT.test(entry.name.slice(0, -4))) {
      await fsp.unlink(path.join(catalogRoot, entry.name));
    }
  }
  const nas = requestedDestinations(config).nas;
  if (!nas) return;
  try {
    const directory = await nasBackupDirectory(db.dataDir, nas);
    const owner = backupOwner(db.dbId);
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const artifact = entry.name.slice(0, -8);
      if (!entry.isDirectory() || entry.isSymbolicLink() || !entry.name.endsWith('.pending') ||
          !ARTIFACT.test(artifact) || !artifact.includes('.bundle-' + owner + '-')) continue;
      const pending = path.join(directory, entry.name);
      if ((await fsp.lstat(pending)).mtimeMs < Date.now() - 24 * 60 * 60 * 1000) {
        await fsp.rm(pending, { recursive: true, force: true });
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn('primary NAS backup staging cleanup unavailable');
  }
}

export const primaryBackupTarget = (db: Pick<NewsroomDatabase, 'getRow'>) =>
  storageOf(db.getRow('settings', 'singleton')?.d).primaryBackups;

function remoteRoot(raw?: string) {
  const value = raw?.trim().replace(/\/+$/, '');
  const match = value?.match(REMOTE);
  if (!match || !value || match[2].split(/[\\/]/).some(part => part === '.' || part === '..')) return;
  return { value, alias: match[1] };
}

let remotesCache: { expiresAt: number; data: Promise<Map<string, string>> } | undefined;
function remoteTypes() {
  if (!remotesCache || remotesCache.expiresAt <= Date.now()) {
    const data = run('rclone', ['listremotes', '--long'], { timeout: 3000, windowsHide: true })
      .then(({ stdout }) => {
        const types = new Map<string, string>();
        for (const line of stdout.split(/\r?\n/)) {
          const match = line.match(/^\s*([a-zA-Z0-9_-]+):\s+(\S+)/);
          if (match) types.set(match[1], match[2]);
        }
        return types;
      }).catch(() => new Map<string, string>());
    remotesCache = { data, expiresAt: Date.now() + 15_000 };
  }
  return remotesCache.data;
}

function requestedDestinations(config: BackupTransportConfig) {
  return {
    nas: config.backupNasDirectory || process.env.BACKUP_NAS_DIRECTORY || process.env.SHARE_DIRECTORY,
    dropbox: config.backupDropboxRemote || process.env.BACKUP_DROPBOX_REMOTE || config.backupRemote,
    gdrive: config.backupGDriveRemote || process.env.BACKUP_GDRIVE_REMOTE || config.backupRemote,
  };
}

export async function primaryBackupCarriers(db: Pick<NewsroomDatabase, 'dataDir'>, config: BackupTransportConfig) {
  const requested = requestedDestinations(config);
  const dropbox = remoteRoot(requested.dropbox);
  const gdrive = remoteRoot(requested.gdrive);
  const [nas, types] = await Promise.all([
    requested.nas ? mountedBackupDirectory(db.dataDir, requested.nas)
      .then(async root => { await fsp.access(root, constants.W_OK); return root; }).catch(() => undefined) : undefined,
    dropbox || gdrive ? remoteTypes() : new Map<string, string>(),
  ]);
  return {
    nas,
    dropbox: dropbox && types.get(dropbox.alias) === 'dropbox' ? dropbox.value : undefined,
    gdrive: gdrive && types.get(gdrive.alias) === 'drive' ? gdrive.value : undefined,
  };
}

export async function primaryBackupReadiness(db: BackupDb, config: BackupTransportConfig) {
  const primaryTarget = primaryBackupTarget(db);
  const carriers = await primaryBackupCarriers(db, config);
  return {
    primaryTarget,
    primaryConfigured: primaryTarget === 'local' || Boolean(carriers[primaryTarget]),
    primaryDestinations: { nas: Boolean(carriers.nas), dropbox: Boolean(carriers.dropbox), gdrive: Boolean(carriers.gdrive) },
  };
}

export function readPrimaryBackup(dataDir: string, name: string): Entry | undefined {
  if (!FILE_NAME.test(name)) return;
  try {
    const root = catalog(dataDir);
    const catalogStat = fs.lstatSync(root);
    if (!catalogStat.isDirectory() || catalogStat.isSymbolicLink()) return;
    const source = filename(dataDir, name);
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16000) return;
    const row = JSON.parse(fs.readFileSync(source, 'utf8')) as Entry;
    if (row.format !== 1 || row.file?.fileName !== name || !Number.isFinite(Date.parse(row.file.createdAt)) ||
        !Number.isSafeInteger(row.file.sizeBytes) || row.file.sizeBytes <= 0 || typeof row.file.sizeFormatted !== 'string' ||
        !SHA256.test(row.sha256) || !ARTIFACT.test(row.artifact) || !row.artifact.startsWith(name + '.bundle-')) return;
    if (row.carrier?.kind === 'nas' && path.isAbsolute(row.carrier.root)) return row;
    if ((row.carrier?.kind === 'dropbox' || row.carrier?.kind === 'gdrive') &&
        typeof row.carrier.root === 'string' && remoteRoot(row.carrier.root)?.value === row.carrier.root) return row;
  } catch { /* Ignore corrupt or missing catalog entries. */ }
}

function entries(dataDir: string): Entry[] {
  try {
    return fs.readdirSync(catalog(dataDir))
      .filter(name => name.endsWith('.json'))
      .flatMap(name => readPrimaryBackup(dataDir, name.slice(0, -5)) || []);
  } catch { return []; }
}

export function listAllBackupFiles(db: Pick<NewsroomDatabase, 'dataDir' | 'listBackups'>) {
  const rows = new Map(db.listBackups().map(file => [file.fileName, file]));
  for (const entry of entries(db.dataDir)) rows.set(entry.file.fileName, entry.file);
  return [...rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function latestVerifiedPrimaryBackup(db: BackupDb, config: BackupTransportConfig) {
  const kind = primaryBackupTarget(db);
  if (!kind || kind === 'local') return null;
  const configured = requestedDestinations(config)[kind];
  if (!configured) return null;
  let root: string | undefined;
  try { root = kind === 'nas' ? fs.realpathSync.native(configured) : remoteRoot(configured)?.value; }
  catch { return null; }
  if (!root) return null;
  const destination = root;
  const current = entries(db.dataDir).filter(entry => entry.carrier.kind === kind &&
    (kind === 'nas' ? path.relative(destination, entry.carrier.root) === '' : entry.carrier.root === destination))
    .sort((a, b) => b.file.createdAt.localeCompare(a.file.createdAt))[0];
  return current ? { at: current.file.createdAt, fileName: current.file.fileName, targets: [kind === 'nas' ? 'directory' as const : 'remote' as const] } : null;
}

async function artifactPath(dataDir: string, carrier: BackupCarrier, artifact: string, create = false) {
  if (!ARTIFACT.test(artifact)) throw new Error('Invalid backup artifact');
  return carrier.kind === 'nas'
    ? path.join(await nasBackupDirectory(dataDir, carrier.root, create), artifact)
    : carrier.root + '/' + artifact;
}

async function assertHash(file: string, expected: string) {
  if (await backupHash(file) !== expected) throw new Error('Backup checksum mismatch');
}

async function copyToNas(local: string, destination: string, files: BackupBundleFile[]) {
  const pending = destination + '.pending';
  await fsp.mkdir(pending, { mode: 0o700 });
  try {
    await fsp.mkdir(path.join(pending, 'uploads'), { mode: 0o700 });
    for (const file of files) await fsp.copyFile(path.join(local, file.path), path.join(pending, file.path), constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
    await fsp.copyFile(path.join(local, 'manifest.json'), path.join(pending, 'manifest.json'), constants.COPYFILE_EXCL);
    for (const file of files) await assertHash(path.join(pending, file.path), file.sha256);
    await assertHash(path.join(pending, 'manifest.json'), await backupHash(path.join(local, 'manifest.json')));
    await fsp.rename(pending, destination);
  } finally {
    await fsp.rm(pending, { recursive: true, force: true }).catch(() => logger.warn('NAS backup staging cleanup failed'));
  }
}

async function removeArtifact(dataDir: string, entry: Entry) {
  const target = await artifactPath(dataDir, entry.carrier, entry.artifact);
  if (entry.carrier.kind === 'nas') await fsp.rm(target, { recursive: true, force: true });
  else await run('rclone', ['purge', target], transfer);
}

async function retainPrimaryBackups(db: BackupDb, carrier: BackupCarrier, keep: string, retention: number) {
  const owned = entries(db.dataDir).filter(entry => entry.file.fileName !== keep &&
    entry.carrier.kind === carrier.kind && entry.carrier.root === carrier.root)
    .sort((a, b) => b.file.createdAt.localeCompare(a.file.createdAt));
  for (const previous of owned.slice(Math.max(0, retention - 1))) {
    try {
      await removeArtifact(db.dataDir, previous);
      await fsp.unlink(filename(db.dataDir, previous.file.fileName));
    } catch { logger.warn('primary backup retention failed'); }
  }
}

const backupOwner = (databaseId: string) => createHash('sha256').update(databaseId).digest('hex').slice(0, 16);

export async function publishPrimaryBackup(db: BackupDb, carrier: BackupCarrier, file: BackupFile, directory: string, files: BackupBundleFile[], retention: number) {
  const origin = backupOwner(db.dbId);
  const artifact = file.fileName + '.bundle-' + origin + '-' + randomUUID();
  const database = files.find(item => item.path === 'newsroom.sqlite');
  if (!database) throw new Error('Missing backup snapshot');
  const destination = await artifactPath(db.dataDir, carrier, artifact, true);
  const catalogPath = privateDirectory(catalog(db.dataDir));
  const stagedPointer = path.join(catalogPath, artifact + '.tmp');
  const entry: Entry = { format: 1, file, carrier, artifact, sha256: database.sha256 };
  let written = false;
  try {
    if (carrier.kind === 'nas') {
      await copyToNas(directory, destination, files);
      written = true;
    } else {
      written = true;
      await run('rclone', ['copy', directory, destination, '--immutable'], transfer);
      await run('rclone', ['check', directory, destination, '--one-way', '--download'], transfer);
    }
    await fsp.writeFile(stagedPointer, JSON.stringify(entry), { mode: 0o600, flag: 'wx' });
    await fsp.rename(stagedPointer, filename(db.dataDir, file.fileName));
  } catch {
    if (written) await removeArtifact(db.dataDir, entry).catch(() => logger.warn('partial primary backup cleanup failed'));
    throw new Error('Primary backup delivery or verification failed');
  } finally {
    await fsp.unlink(stagedPointer).catch(() => {});
  }
  await retainPrimaryBackups(db, carrier, file.fileName, retention);
  return destination;
}

export async function primaryBackupBundleReader(dataDir: string, entry: Entry) {
  const artifact = await artifactPath(dataDir, entry.carrier, entry.artifact);
  if (entry.carrier.kind !== 'nas') {
    return async (relative: string, output: string, maxBytes: number) => {
      // Leave one byte of headroom above the accepted size so exact-length transfers can complete.
      await run('rclone', ['copyto', artifact + '/' + relative, output, '--immutable',
        '--max-transfer', (maxBytes + 1) + 'B', '--retries', '1'], transfer);
      if ((await fsp.stat(output)).size > maxBytes) throw new Error('Oversized backup artifact');
    };
  }
  const root = await fsp.lstat(artifact);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Invalid primary backup artifact');
  return async (relative: string, output: string, maxBytes: number) => {
    const source = path.join(artifact, relative);
    if (relative.startsWith('uploads/')) {
      const uploads = await fsp.lstat(path.join(artifact, 'uploads'));
      if (!uploads.isDirectory() || uploads.isSymbolicLink()) throw new Error('Invalid primary backup uploads');
    }
    const stat = await fsp.lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error('Invalid primary backup file');
    await fsp.copyFile(source, output, constants.COPYFILE_EXCL);
  };
}

export async function fetchPrimaryBackupSnapshot(dataDir: string, entry: Entry, output: string) {
  const fetch = await primaryBackupBundleReader(dataDir, entry);
  await fetch('newsroom.sqlite', output, entry.file.sizeBytes);
  if ((await fsp.stat(output)).size !== entry.file.sizeBytes) throw new Error('Incomplete primary backup snapshot');
  await assertHash(output, entry.sha256);
}
