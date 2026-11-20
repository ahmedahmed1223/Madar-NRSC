import fs from 'fs';

/**
 * Minimal Google Drive API v3 client (no SDK): OAuth refresh tokens, resumable uploads into dated
 * folders, streamed downloads with byte ranges, search and folder listing. Works with "My Drive"
 * and shared drives. Hosts can be overridden (GDRIVE_OAUTH_URL / GDRIVE_API_URL / GDRIVE_UPLOAD_URL)
 * so the tests can talk to a local fake.
 */

export interface DriveCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface DriveEntry {
  id: string;
  name: string;
  size: number;
  modifiedAt?: string;
  mimeType?: string;
  isFolder: boolean;
}

export class DriveError extends Error {
  constructor(public status: number, message: string, public detail?: string) {
    super(message);
  }
}

const FOLDER = 'application/vnd.google-apps.folder';
/** Resumable chunks must be multiples of 256 KiB. */
const CHUNK = 32 * 256 * 1024;
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export function driveHosts(env: NodeJS.ProcessEnv = process.env) {
  return {
    oauth: (env.GDRIVE_OAUTH_URL || 'https://oauth2.googleapis.com').replace(/\/+$/, ''),
    api: (env.GDRIVE_API_URL || 'https://www.googleapis.com/drive/v3').replace(/\/+$/, ''),
    upload: (env.GDRIVE_UPLOAD_URL || 'https://www.googleapis.com/upload/drive/v3').replace(/\/+$/, ''),
  };
}

export function driveAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${GOOGLE_AUTHORIZE_URL}?${q}`;
}

export async function exchangeDriveCode(clientId: string, clientSecret: string, code: string, redirectUri: string, hosts = driveHosts()) {
  const res = await fetch(`${hosts.oauth}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body.refresh_token) {
    throw new DriveError(res.status || 400, 'رفض Google الرمز أو لم يمنح صلاحية دائمة: أعد الربط واقبل جميع الأذونات', body.error_description || body.error);
  }
  return { refreshToken: String(body.refresh_token) };
}

/** Drive query strings quote with single quotes; backslashes and quotes are escaped. */
const q = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function toEntry(f: any): DriveEntry {
  return {
    id: String(f.id || ''),
    name: String(f.name || ''),
    size: Number(f.size || 0),
    modifiedAt: f.modifiedTime,
    mimeType: f.mimeType,
    isFolder: f.mimeType === FOLDER,
  };
}

export class DriveClient {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private folderCache = new Map<string, string>();

  constructor(private creds: DriveCredentials, private hosts = driveHosts()) {}

  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;
    const res = await fetch(`${this.hosts.oauth}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.creds.refreshToken,
        client_id: this.creds.clientId,
        client_secret: this.creds.clientSecret,
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      throw new DriveError(401, 'انتهى تفويض Google Drive أو أُلغي؛ أعد الربط من الإعدادات', body.error_description || body.error);
    }
    this.accessToken = String(body.access_token);
    this.expiresAt = Date.now() + Number(body.expires_in || 3600) * 1000;
    return this.accessToken;
  }

  private async request(url: string, init: RequestInit & { okStatuses?: number[] } = {}, retry = true): Promise<Response> {
    const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${await this.token()}`, ...((init.headers as Record<string, string>) || {}) } });
    if (res.status === 401 && retry) {
      this.accessToken = null;
      return this.request(url, init, false);
    }
    if ((init.okStatuses || []).includes(res.status)) return res;
    if (res.status === 429 || res.status >= 500 || (res.status === 403 && /rateLimit/i.test(res.headers.get('content-type') || ''))) {
      throw new DriveError(res.status, 'خدمة Google Drive مشغولة أو غير متاحة الآن؛ سيُعاد المحاولة تلقائياً');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let detail = text;
      try {
        detail = JSON.parse(text)?.error?.message || text;
      } catch {
        // plain text
      }
      if (res.status === 404) throw new DriveError(404, 'الملف غير موجود في Google Drive', detail);
      if (/storageQuotaExceeded|quota/i.test(detail)) throw new DriveError(507, 'مساحة Google Drive ممتلئة', detail);
      throw new DriveError(res.status, 'تعذر إكمال الطلب في Google Drive', detail);
    }
    return res;
  }

  private async json(url: string, init: RequestInit = {}): Promise<any> {
    return (await this.request(url, init)).json();
  }

  private common = 'supportsAllDrives=true&includeItemsFromAllDrives=true';

  async account(): Promise<{ name: string; email?: string }> {
    const body = await this.json(`${this.hosts.api}/about?fields=user(displayName,emailAddress)`);
    return { name: String(body?.user?.displayName || body?.user?.emailAddress || 'Google Drive'), email: body?.user?.emailAddress };
  }

  /** Finds or creates a folder under a parent ('root' is «My Drive»). */
  async folder(name: string, parentId: string): Promise<string> {
    const key = `${parentId}/${name}`;
    const cached = this.folderCache.get(key);
    if (cached) return cached;
    const query = `name = ${q(name)} and ${q(parentId)} in parents and mimeType = '${FOLDER}' and trashed = false`;
    const found = await this.json(`${this.hosts.api}/files?${this.common}&fields=files(id)&pageSize=1&q=${encodeURIComponent(query)}`);
    let id = found?.files?.[0]?.id as string | undefined;
    if (!id) {
      const created = await this.json(`${this.hosts.api}/files?supportsAllDrives=true&fields=id`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
      });
      id = String(created.id);
    }
    this.folderCache.set(key, id);
    return id;
  }

  /** Folder chain such as ['2026', '11-19'] under the root; returns the last folder's id. */
  async folderPath(rootId: string, parts: string[]): Promise<string> {
    let parent = rootId;
    for (const part of parts) parent = await this.folder(part, parent);
    return parent;
  }

  /** Resumable upload (any size). Returns the new file. */
  async upload(localPath: string, parentId: string, name: string, size: number, mimeType: string): Promise<DriveEntry> {
    const start = await this.request(`${this.hosts.upload}/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,modifiedTime,mimeType`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': mimeType, 'x-upload-content-length': String(size) },
      body: JSON.stringify({ name, parents: [parentId] }),
    });
    const session = start.headers.get('location');
    if (!session) throw new DriveError(502, 'لم يبدأ Google Drive جلسة الرفع');
    const handle = await fs.promises.open(localPath, 'r');
    try {
      const buffer = Buffer.alloc(CHUNK);
      let offset = 0;
      while (offset < size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(CHUNK, size - offset), offset);
        if (!bytesRead) throw new DriveError(500, 'انتهى الملف قبل اكتمال الرفع');
        const end = offset + bytesRead - 1;
        const res = await this.request(session, {
          method: 'PUT',
          headers: { 'content-range': `bytes ${offset}-${end}/${size}`, 'content-type': mimeType },
          body: Buffer.from(buffer.subarray(0, bytesRead)),
          okStatuses: [308],
        });
        if (res.status === 308) {
          const range = res.headers.get('range');
          offset = range ? Number(range.split('-')[1]) + 1 : end + 1;
          continue;
        }
        return toEntry(await res.json());
      }
      throw new DriveError(502, 'لم يؤكد Google Drive اكتمال الرفع');
    } finally {
      await handle.close();
    }
  }

  async download(id: string, range?: string): Promise<Response> {
    const headers: Record<string, string> = {};
    if (range) headers.range = range;
    return this.request(`${this.hosts.api}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { headers });
  }

  async get(id: string): Promise<DriveEntry> {
    return toEntry(await this.json(`${this.hosts.api}/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,name,size,modifiedTime,mimeType`));
  }

  async search(text: string, limit = 50): Promise<DriveEntry[]> {
    const words = text.trim().split(/\s+/).filter(Boolean).slice(0, 5);
    if (!words.length) return [];
    const query = [...words.map((w) => `(name contains ${q(w)} or fullText contains ${q(w)})`), 'trashed = false', `mimeType != '${FOLDER}'`].join(' and ');
    const body = await this.json(
      `${this.hosts.api}/files?${this.common}&corpora=allDrives&pageSize=${Math.min(limit, 100)}&fields=files(id,name,size,modifiedTime,mimeType)&orderBy=modifiedTime desc&q=${encodeURIComponent(query)}`
    );
    return (body.files || []).map(toEntry);
  }

  async list(folderId: string, limit = 200): Promise<DriveEntry[]> {
    const query = `${q(folderId)} in parents and trashed = false`;
    const body = await this.json(
      `${this.hosts.api}/files?${this.common}&pageSize=${Math.min(limit, 1000)}&fields=files(id,name,size,modifiedTime,mimeType)&orderBy=folder,name&q=${encodeURIComponent(query)}`
    );
    return (body.files || []).map(toEntry);
  }
}
