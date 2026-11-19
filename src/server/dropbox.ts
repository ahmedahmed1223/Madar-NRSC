import fs from 'fs';
import { logger } from './logger';

/**
 * Minimal Dropbox API v2 client (no SDK): offline refresh tokens, chunked uploads, streamed
 * downloads with byte ranges, search and folder listing. Both API hosts can be overridden
 * (DROPBOX_API_URL / DROPBOX_CONTENT_URL), which the tests use to talk to a local fake.
 */

export interface DropboxCredentials {
  appKey: string;
  appSecret: string;
  refreshToken: string;
}

export interface DropboxEntry {
  id: string;
  name: string;
  path: string;
  size: number;
  modifiedAt?: string;
  isFolder: boolean;
}

export class DropboxError extends Error {
  constructor(public status: number, message: string, public summary?: string) {
    super(message);
  }
}

const CHUNK = 8 * 1024 * 1024;
const SINGLE_UPLOAD_LIMIT = 16 * 1024 * 1024;

export const DROPBOX_AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';

export function dropboxHosts(env: NodeJS.ProcessEnv = process.env) {
  return {
    api: (env.DROPBOX_API_URL || 'https://api.dropboxapi.com').replace(/\/+$/, ''),
    content: (env.DROPBOX_CONTENT_URL || 'https://content.dropboxapi.com').replace(/\/+$/, ''),
  };
}

/** The page where an administrator approves access; it shows a code to paste back into «مدار». */
export function authorizeUrl(appKey: string): string {
  const q = new URLSearchParams({ client_id: appKey, response_type: 'code', token_access_type: 'offline' });
  return `${DROPBOX_AUTHORIZE_URL}?${q}`;
}

/** Dropbox-API-Arg travels in a header, which must be ASCII: Arabic names are escaped as \uXXXX. */
export function headerJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/** Normalises a Dropbox path: leading slash, forward slashes, no trailing slash, no dot segments. */
export function dropboxPath(...parts: string[]): string {
  const segments = parts
    .join('/')
    .split(/[\\/]+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..');
  return segments.length ? '/' + segments.join('/') : '';
}

function toEntry(m: any): DropboxEntry {
  return {
    id: String(m.id || m.path_lower || ''),
    name: String(m.name || ''),
    path: String(m.path_display || m.path_lower || ''),
    size: Number(m.size || 0),
    modifiedAt: m.server_modified || m.client_modified,
    isFolder: m['.tag'] === 'folder',
  };
}

export async function exchangeAuthorizationCode(appKey: string, appSecret: string, code: string, hosts = dropboxHosts()) {
  const res = await fetch(`${hosts.api}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: code.trim(), client_id: appKey, client_secret: appSecret }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body.refresh_token) {
    throw new DropboxError(res.status || 400, 'رفض Dropbox الرمز: تأكد من مفتاح التطبيق وسرّه ومن نسخ الرمز كاملاً وحديثاً', body.error_description || body.error);
  }
  return { refreshToken: String(body.refresh_token), accessToken: String(body.access_token), expiresIn: Number(body.expires_in || 14400) };
}

export class DropboxClient {
  private accessToken: string | null = null;
  private expiresAt = 0;

  constructor(private creds: DropboxCredentials, private hosts = dropboxHosts()) {}

  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;
    const res = await fetch(`${this.hosts.api}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.creds.refreshToken,
        client_id: this.creds.appKey,
        client_secret: this.creds.appSecret,
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      throw new DropboxError(401, 'انتهى تفويض Dropbox أو أُلغي؛ أعد الربط من الإعدادات', body.error_description || body.error);
    }
    this.accessToken = String(body.access_token);
    this.expiresAt = Date.now() + Number(body.expires_in || 14400) * 1000;
    return this.accessToken;
  }

  private async call(endpoint: string, args: unknown): Promise<any> {
    const res = await this.raw(`${this.hosts.api}/2/${endpoint}`, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
    return res.json();
  }

  private async raw(url: string, init: { headers?: Record<string, string>; body?: any; duplex?: 'half' }, retry = true): Promise<Response> {
    const res = await fetch(url, {
      method: 'POST',
      ...init,
      headers: { authorization: `Bearer ${await this.token()}`, ...(init.headers || {}) },
    } as RequestInit);
    if (res.status === 401 && retry) {
      this.accessToken = null;
      return this.raw(url, init, false);
    }
    if (res.status === 429 || res.status >= 500) {
      throw new DropboxError(res.status, 'خدمة Dropbox مشغولة أو غير متاحة الآن؛ سيُعاد المحاولة تلقائياً');
    }
    if (!res.ok && res.status !== 206) {
      const text = await res.text().catch(() => '');
      let summary = text;
      try {
        summary = JSON.parse(text).error_summary || text;
      } catch {
        // plain-text error
      }
      if (/not_found/.test(summary)) throw new DropboxError(404, 'الملف غير موجود في Dropbox', summary);
      if (/insufficient_space/.test(summary)) throw new DropboxError(507, 'مساحة Dropbox ممتلئة', summary);
      throw new DropboxError(res.status, 'تعذر إكمال الطلب في Dropbox', summary);
    }
    return res;
  }

  async account(): Promise<{ name: string; email?: string }> {
    const res = await this.raw(`${this.hosts.api}/2/users/get_current_account`, {});
    const body: any = await res.json();
    return { name: String(body?.name?.display_name || body?.email || 'Dropbox'), email: body?.email };
  }

  async usage(): Promise<{ used: number; allocated?: number }> {
    const res = await this.raw(`${this.hosts.api}/2/users/get_space_usage`, {});
    const body: any = await res.json();
    return { used: Number(body?.used || 0), allocated: Number(body?.allocation?.allocated || 0) || undefined };
  }

  /** Uploads a local file; Dropbox renames on a clash. Returns the stored path. */
  async upload(localPath: string, remotePath: string, size: number): Promise<DropboxEntry> {
    const commit = { path: remotePath, mode: 'add', autorename: true, mute: true };
    if (size <= SINGLE_UPLOAD_LIMIT) {
      const res = await this.raw(`${this.hosts.content}/2/files/upload`, {
        headers: { 'content-type': 'application/octet-stream', 'dropbox-api-arg': headerJson(commit) },
        body: await fs.promises.readFile(localPath),
      });
      return toEntry(await res.json());
    }
    const handle = await fs.promises.open(localPath, 'r');
    try {
      const buffer = Buffer.alloc(CHUNK);
      const readAt = async (offset: number) => {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(CHUNK, size - offset), offset);
        if (!bytesRead) throw new DropboxError(500, 'انتهى الملف قبل اكتمال الرفع');
        return Buffer.from(buffer.subarray(0, bytesRead));
      };
      const octet = (arg: unknown) => ({ 'content-type': 'application/octet-stream', 'dropbox-api-arg': headerJson(arg) });
      const first = await readAt(0);
      const started = await this.raw(`${this.hosts.content}/2/files/upload_session/start`, { headers: octet({ close: false }), body: first });
      const sessionId = String((await started.json()).session_id);
      let offset = first.length;
      // Every chunk but the last is appended; the last one travels with the commit.
      while (true) {
        const chunk = offset < size ? await readAt(offset) : Buffer.alloc(0);
        if (offset + chunk.length >= size) {
          const res = await this.raw(`${this.hosts.content}/2/files/upload_session/finish`, {
            headers: octet({ cursor: { session_id: sessionId, offset }, commit }),
            body: chunk,
          });
          return toEntry(await res.json());
        }
        await this.raw(`${this.hosts.content}/2/files/upload_session/append_v2`, {
          headers: octet({ cursor: { session_id: sessionId, offset }, close: false }),
          body: chunk,
        });
        offset += chunk.length;
      }
    } finally {
      await handle.close();
    }
  }

  /** Streams a file (or a byte range of it) from Dropbox. */
  async download(path: string, range?: string): Promise<Response> {
    const headers: Record<string, string> = { 'dropbox-api-arg': headerJson({ path }) };
    if (range) headers.range = range;
    return this.raw(`${this.hosts.content}/2/files/download`, { headers });
  }

  async search(query: string, root: string, limit = 50): Promise<DropboxEntry[]> {
    const body = await this.call('files/search_v2', {
      query: query.slice(0, 200),
      options: { path: root || '', max_results: Math.min(limit, 100), file_status: 'active', filename_only: false },
    });
    return (body.matches || []).map((m: any) => toEntry(m?.metadata?.metadata || {})).filter((e: DropboxEntry) => e.path);
  }

  async list(path: string, limit = 200): Promise<DropboxEntry[]> {
    const body = await this.call('files/list_folder', { path: path || '', limit: Math.min(limit, 2000), include_deleted: false });
    return (body.entries || []).map(toEntry);
  }

  async remove(path: string): Promise<void> {
    try {
      await this.call('files/delete_v2', { path });
    } catch (err) {
      if (!(err instanceof DropboxError && err.status === 404)) logger.warn('dropbox delete failed', { error: String(err) });
    }
  }
}
