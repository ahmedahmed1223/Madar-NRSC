/**
 * Where uploaded material is kept besides the server's own disk.
 *
 * - Cloud (Dropbox and/or Google Drive): every attached file is copied to the station's cloud
 *   folder (colleagues working over the internet upload there through «مدار»); the library can
 *   search the cloud and bring existing files in without copying them.
 * - Shared folder (SMB): colleagues on the station's local network can also keep a copy in the
 *   shared folder. The server writes there directly when the share is mounted on it
 *   (SHARE_DIRECTORY), or through «جسر مدار», a small program on a computer inside the network.
 *
 * Secrets (Dropbox keys, the bridge token) never live here: these settings sync to every browser.
 */

export type CloudProviderId = 'dropbox' | 'gdrive';
export type CopyTarget = CloudProviderId | 'share';

export const CLOUD_NAMES: Record<CloudProviderId, string> = { dropbox: 'Dropbox', gdrive: 'Google Drive' };
export const TARGET_NAMES: Record<CopyTarget, string> = { ...CLOUD_NAMES, share: 'المجلد المشترك' };

export interface DropboxStorageSettings {
  enabled: boolean;
  /** Folder inside Dropbox, e.g. «/مدار». */
  rootPath: string;
}

export interface DriveStorageSettings {
  enabled: boolean;
  /** Name of the folder created in «My Drive» when no folder id is given. */
  rootName: string;
  /** Id of an existing folder (also inside a shared drive); empty creates «rootName». */
  rootFolderId: string;
}

export interface ShareStorageSettings {
  enabled: boolean;
  /** How colleagues reach the folder from their computers, e.g. \\fileserver\news (shown, never opened by the server). */
  displayPath: string;
  /** Addresses counted as the station's local network (CIDR, e.g. 10.0.0.0/8). */
  localNetworks: string[];
  /** The «keep a copy in the shared folder» box starts ticked for local colleagues. */
  copyByDefault: boolean;
}

export interface StorageSettings {
  /** Keep the server's copy once the cloud holds the file (off frees the server's disk). */
  keepLocalCopy?: boolean;
  dropbox?: DropboxStorageSettings;
  gdrive?: DriveStorageSettings;
  share?: ShareStorageSettings;
}

export interface ResolvedStorageSettings {
  keepLocalCopy: boolean;
  dropbox: DropboxStorageSettings;
  gdrive: DriveStorageSettings;
  share: ShareStorageSettings;
}

export const DEFAULT_LOCAL_NETWORKS = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '::1/128', 'fc00::/7'];

export const DEFAULT_STORAGE: ResolvedStorageSettings = {
  keepLocalCopy: true,
  dropbox: { enabled: false, rootPath: '/مدار' },
  gdrive: { enabled: false, rootName: 'مدار', rootFolderId: '' },
  share: { enabled: false, displayPath: '', localNetworks: DEFAULT_LOCAL_NETWORKS, copyByDefault: true },
};

export function storageOf(settings: { storage?: StorageSettings } | null | undefined): ResolvedStorageSettings {
  const s = settings?.storage || {};
  return {
    keepLocalCopy: s.keepLocalCopy ?? DEFAULT_STORAGE.keepLocalCopy,
    dropbox: { ...DEFAULT_STORAGE.dropbox, ...(s.dropbox || {}) },
    gdrive: { ...DEFAULT_STORAGE.gdrive, ...(s.gdrive || {}) },
    share: { ...DEFAULT_STORAGE.share, ...(s.share || {}) },
  };
}

/** What the server reports about storage (GET /api/v1/storage/status). */
export interface CloudStatus {
  enabled: boolean;
  connected: boolean;
  /** Keys come from the server's environment and cannot be changed in the settings. */
  managedByEnvironment: boolean;
  account?: string;
  /** Where files go, as people see it («/مدار» or «مدار»). */
  root: string;
  lastError?: string;
}

export interface StorageStatus {
  dropbox: CloudStatus;
  gdrive: CloudStatus;
  share: {
    enabled: boolean;
    /** direct: the server writes to a mounted folder; bridge: «جسر مدار» writes for it. */
    mode: 'direct' | 'bridge' | 'none';
    bridgeOnline: boolean;
    bridgeLastSeen?: string;
    bridgeVersion?: string;
    hasBridgeToken: boolean;
    displayPath: string;
    indexedFiles: number;
    indexedAt?: string;
  };
  /** The colleague asking is on the station's local network. */
  isLocal: boolean;
  queue: { pending: number; failed: number; done: number };
}

/** Copy state of one uploaded file. */
export interface StorageCopy {
  target: CopyTarget;
  state: 'PENDING' | 'DONE' | 'FAILED';
  path?: string;
  error?: string;
}

export interface StorageLocations {
  local: boolean;
  copies: StorageCopy[];
}

export type DropboxCheck = 'connection' | 'permissions';

export type DropboxCheckStatus = 'verified' | 'not_configured' | 'invalid_credentials' | 'missing_scope' | 'folder_missing' | 'folder_denied' | 'unavailable' | 'failed';

export interface DropboxVerification {
  credentials: DropboxCheckStatus;
  root?: string;
  folder?: DropboxCheckStatus;
  read?: DropboxCheckStatus;
  write?: DropboxCheckStatus;
}

export function validateStorage(value: unknown): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object') return 'إعدادات التخزين غير صالحة';
  const v = value as StorageSettings;
  if (v.keepLocalCopy !== undefined && typeof v.keepLocalCopy !== 'boolean') return 'إعدادات التخزين غير صالحة';
  if (v.dropbox) {
    if (typeof v.dropbox.enabled !== 'boolean') return 'إعدادات Dropbox غير صالحة';
    if (typeof v.dropbox.rootPath !== 'string' || v.dropbox.rootPath.length > 200 || /(^|[\\/])\.\.([\\/]|$)/.test(v.dropbox.rootPath)) {
      return 'مجلد Dropbox غير صالح';
    }
  }
  if (v.gdrive) {
    if (typeof v.gdrive.enabled !== 'boolean') return 'إعدادات Google Drive غير صالحة';
    if (typeof v.gdrive.rootName !== 'string' || !v.gdrive.rootName.trim() || v.gdrive.rootName.length > 100 || /[\\/]/.test(v.gdrive.rootName)) return 'اسم مجلد Google Drive غير صالح';
    if (typeof v.gdrive.rootFolderId !== 'string' || !/^[A-Za-z0-9_-]{0,200}$/.test(v.gdrive.rootFolderId)) return 'معرّف مجلد Google Drive غير صالح';
  }
  if (v.share) {
    if (typeof v.share.enabled !== 'boolean' || typeof v.share.copyByDefault !== 'boolean') return 'إعدادات المجلد المشترك غير صالحة';
    if (typeof v.share.displayPath !== 'string' || v.share.displayPath.length > 300) return 'مسار المجلد المشترك طويل جداً';
    if (!Array.isArray(v.share.localNetworks) || v.share.localNetworks.length > 50) return 'قائمة الشبكات المحلية غير صالحة';
    for (const net of v.share.localNetworks) if (!parseCidr(net)) return `نطاق الشبكة غير صالح: ${String(net).slice(0, 60)}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Address ranges
// ---------------------------------------------------------------------------

function ipv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = (n << 8n) | BigInt(Number(p));
  }
  return n;
}

function ipv6ToBigInt(ip: string): bigint | null {
  if (!/^[0-9a-f:.]+$/i.test(ip) || ip.split('::').length > 2) return null;
  let [head, tail] = ip.includes('::') ? ip.split('::') : [ip, undefined];
  const parse = (s: string | undefined) => (s ? s.split(':') : []);
  let left = parse(head);
  let right = parse(tail);
  // An IPv4 tail (::ffff:10.0.0.1) counts as two groups.
  const v4 = (arr: string[]) => {
    const last = arr[arr.length - 1];
    if (last && last.includes('.')) {
      const n = ipv4ToBigInt(last);
      if (n === null) return null;
      return [...arr.slice(0, -1), ((n >> 16n) & 0xffffn).toString(16), (n & 0xffffn).toString(16)];
    }
    return arr;
  };
  const l = v4(left);
  const r = v4(right);
  if (!l || !r) return null;
  left = l;
  right = r;
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right];
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

interface Cidr {
  v6: boolean;
  base: bigint;
  bits: number;
}

export function parseCidr(value: unknown): Cidr | null {
  if (typeof value !== 'string') return null;
  const [addr, len] = value.trim().split('/');
  if (!addr) return null;
  if (addr.includes(':')) {
    const base = ipv6ToBigInt(addr);
    const bits = len === undefined ? 128 : Number(len);
    if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 128) return null;
    return { v6: true, base, bits };
  }
  const base = ipv4ToBigInt(addr);
  const bits = len === undefined ? 32 : Number(len);
  if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  return { v6: false, base, bits };
}

/** Is this client address inside one of the ranges? IPv4-mapped IPv6 addresses count as IPv4. */
export function addressInRanges(address: string | undefined, ranges: string[]): boolean {
  if (!address) return false;
  let ip = address.trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1];
  const v6 = ip.includes(':');
  const n = v6 ? ipv6ToBigInt(ip) : ipv4ToBigInt(ip);
  if (n === null) return false;
  const width = v6 ? 128 : 32;
  for (const raw of ranges) {
    const c = parseCidr(raw);
    if (!c || c.v6 !== v6) continue;
    const shift = BigInt(width - c.bits);
    if (n >> shift === c.base >> shift) return true;
  }
  return false;
}

/** «2026/11-19/name.ext»: one folder per month, then per day, so the folder stays browsable. */
export function datedFolder(at = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  return `${y}/${m}-${d}`;
}

/** File name safe on Windows shares and Dropbox (keeps Arabic). */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 150);
  return cleaned && !/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(cleaned) ? cleaned : 'file';
}
