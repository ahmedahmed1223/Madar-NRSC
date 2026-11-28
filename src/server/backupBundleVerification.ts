import fs from 'node:fs/promises';
import path from 'node:path';
import { backupHash, type BackupBundleFile } from './primaryBackupStorage';

const SHA256 = /^[a-f0-9]{64}$/;
const MANIFEST_MAX_BYTES = 16 * 1024 * 1024;
const UPLOAD_PATH = /^uploads\/[^\\/:<>"|?*\u0000-\u001f]+$/;

export type BackupSnapshotInventory = {
  sha256: string;
  bytes: number;
  uploads: { stored_name: string; size_bytes: number; local_evicted?: number }[];
};
type FetchBundleFile = (relative: string, output: string, maxBytes: number) => Promise<void>;
export type BackupBundleVerification =
  | { valid: true; filesChecked: number; origin: string; createdAt: string; mediaVerified: boolean }
  | { valid: false; reason: string; tamperedPath?: string };

function missingUploads(inventory: BackupSnapshotInventory, entries: Map<string, BackupBundleFile>): number {
  const database = entries.get('newsroom.sqlite');
  if (database?.sha256 !== inventory.sha256 || database.bytes !== inventory.bytes) throw new Error('Bundle snapshot checksum mismatch');
  const uploads = new Set<string>();
  let missing = 0;
  for (const upload of inventory.uploads) {
    const relative = 'uploads/' + upload.stored_name;
    const entry = entries.get(relative);
    if (!entry && (upload.local_evicted || !upload.stored_name)) {
      missing++;
      continue;
    }
    if (entry?.bytes !== upload.size_bytes) throw new Error('Bundle does not match snapshot upload inventory');
    uploads.add(relative);
  }
  if (entries.size !== uploads.size + 1) throw new Error('Bundle includes unreferenced uploads');
  return missing;
}

async function verifyFile(root: string, entry: BackupBundleFile, fetchFile?: FetchBundleFile): Promise<string | undefined> {
  const target = path.join(root, entry.path);
  try {
    if (fetchFile) await fetchFile(entry.path, target, entry.bytes);
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) return 'Bundled file is not a regular file';
    if (stat.size !== entry.bytes) return 'Bundled file size mismatch';
    if (await backupHash(target) !== entry.sha256) return 'SHA-256 checksum mismatch';
  } catch {
    return 'Missing bundled file';
  } finally {
    if (fetchFile) await fs.unlink(target).catch(() => {});
  }
}

/** A remote bundle is verified one file at a time inside a private scratch directory. */
export async function verifyBackupBundle(bundleDir: string, options: {
  inventory?: BackupSnapshotInventory;
  fetchFile?: FetchBundleFile;
} = {}): Promise<BackupBundleVerification> {
  const { inventory, fetchFile } = options;
  let root: string;
  try {
    const stat = await fs.lstat(bundleDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { valid: false, reason: 'Invalid backup bundle directory' };
    root = await fs.realpath(bundleDir);
  } catch {
    return { valid: false, reason: 'Backup bundle directory not found' };
  }

  const manifestPath = path.join(root, 'manifest.json');
  let metadata: { format?: unknown; origin?: unknown; createdAt?: unknown; files?: unknown; filesKeptElsewhere?: unknown };
  try {
    if (fetchFile) await fetchFile('manifest.json', manifestPath, MANIFEST_MAX_BYTES);
    const stat = await fs.lstat(manifestPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MANIFEST_MAX_BYTES) return { valid: false, reason: 'Invalid manifest.json' };
    metadata = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {
    return { valid: false, reason: 'Missing or unreadable manifest.json' };
  }

  const filesKeptElsewhere = metadata?.filesKeptElsewhere ?? 0;
  if (metadata?.format !== 1 || typeof metadata.origin !== 'string' ||
      typeof metadata.createdAt !== 'string' || !Array.isArray(metadata.files) ||
      typeof filesKeptElsewhere !== 'number' || !Number.isSafeInteger(filesKeptElsewhere) || filesKeptElsewhere < 0) {
    return { valid: false, reason: 'Malformed backup manifest' };
  }

  const entries = new Map<string, BackupBundleFile>();
  for (const entry of metadata.files as Partial<BackupBundleFile>[]) {
    if (typeof entry?.path !== 'string' || typeof entry.bytes !== 'number' ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)) {
      return { valid: false, reason: 'Malformed manifest file entry' };
    }
    if (entry.path !== 'newsroom.sqlite' && (!UPLOAD_PATH.test(entry.path) || /[. ]$/.test(entry.path))) {
      return { valid: false, reason: 'Unsafe manifest file path', tamperedPath: entry.path };
    }
    if (entries.has(entry.path)) return { valid: false, reason: 'Duplicate manifest file', tamperedPath: entry.path };
    entries.set(entry.path, { path: entry.path, bytes: entry.bytes, sha256: entry.sha256 });
  }
  if (!entries.has('newsroom.sqlite')) return { valid: false, reason: 'Manifest does not include newsroom.sqlite' };
  if (fetchFile && filesKeptElsewhere > 0) return { valid: false, reason: 'Primary backup is missing uploads' };
  try {
    if (inventory && missingUploads(inventory, entries) !== filesKeptElsewhere) {
      return { valid: false, reason: 'Manifest has an inconsistent count of external uploads' };
    }
    if (entries.size > 1) {
      const directory = path.join(root, 'uploads');
      if (fetchFile) await fs.mkdir(directory, { mode: 0o700 });
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return { valid: false, reason: 'Invalid bundled upload directory' };
    }
  } catch {
    return { valid: false, reason: 'Backup bundle does not match its snapshot or upload directory' };
  }

  for (const entry of entries.values()) {
    // A primary snapshot was fetched and matched to its catalog hash before this check.
    if (fetchFile && inventory && entry.path === 'newsroom.sqlite') continue;
    const reason = await verifyFile(root, entry, fetchFile);
    if (reason) return { valid: false, reason, tamperedPath: entry.path };
  }
  return { valid: true, filesChecked: entries.size, origin: metadata.origin, createdAt: metadata.createdAt,
    mediaVerified: Boolean(inventory) && filesKeptElsewhere === 0 };
}
