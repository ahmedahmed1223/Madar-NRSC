import fs from 'fs';
import { logger } from './logger';
import { validDropboxTeamMemberId } from '../shared/dropboxAuthorization';

/**
 * Minimal Dropbox API v2 client (no SDK): offline refresh tokens, chunked uploads, streamed
 * downloads with byte ranges, search and folder listing. Both API hosts can be overridden
 * (DROPBOX_API_URL / DROPBOX_CONTENT_URL), which the tests use to talk to a local fake.
 */

export interface DropboxCredentials {
  appKey: string;
  appSecret: string;
  refreshToken: string;
  teamMemberId?: string;
  teamRootNamespaceId?: string;
  /** The member ID was resolved from the token's authorizing administrator. */
  automaticTeamMember?: boolean;
}

interface DropboxAccount {
  name: string;
  teamMemberId?: string;
  rootNamespaceId?: string;
}

type DropboxRequest = { headers?: Record<string, string>; body?: any; duplex?: 'half'; signal?: AbortSignal };
type TeamMemberPage = { members: { id: string; name: string; email?: string }[]; cursor?: string };

interface DropboxDirectoryResponse {
  members: { profile: {
    team_member_id: string;
    status?: { '.tag': string };
    name?: { display_name?: string };
    email?: string;
  } }[];
  has_more: boolean;
  cursor: string;
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

export function dropboxMissingScope(error: unknown): boolean {
  return error instanceof DropboxError && /^(invalid_scope|missing_scope)(\/|$)/.test(error.summary || '');
}

function teamTokenNeedsMember(error: unknown): boolean {
  return error instanceof DropboxError && /^(invalid_select_user|missing_select_user)(\/|$)|entire Dropbox Business team|Dropbox-API-Select-User header/i.test(error.summary || '');
}

const CHUNK = 8 * 1024 * 1024;
const SINGLE_UPLOAD_LIMIT = 16 * 1024 * 1024;

export { DROPBOX_AUTHORIZE_URL, dropboxAuthorizationUrl as authorizeUrl } from '../shared/dropboxAuthorization';

export function dropboxHosts(env: NodeJS.ProcessEnv = process.env) {
  return {
    api: (env.DROPBOX_API_URL || 'https://api.dropboxapi.com').replace(/\/+$/, ''),
    content: (env.DROPBOX_CONTENT_URL || 'https://content.dropboxapi.com').replace(/\/+$/, ''),
  };
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
    signal: AbortSignal.timeout(12_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: code.trim(), client_id: appKey, client_secret: appSecret }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 429 || res.status >= 500) throw new DropboxError(503, 'خدمة تفويض Dropbox غير متاحة الآن. أعد المحاولة لاحقاً.');
    if (body.error === 'invalid_client' || res.status === 401) throw new DropboxError(400, 'لم يقبل Dropbox بيانات التطبيق. انسخ App key وApp secret من التطبيق نفسه ثم أعد المحاولة.');
    if (body.error === 'invalid_grant') throw new DropboxError(400, 'رمز الموافقة غير صالح أو استُخدم سابقاً. افتح صفحة الموافقة للحصول على رمز جديد.');
    throw new DropboxError(400, 'رفض Dropbox طلب الربط. راجع أذونات التطبيق ثم افتح صفحة الموافقة مجدداً.');
  }
  if (typeof body.refresh_token !== 'string' || !body.refresh_token) {
    throw new DropboxError(400, 'لم يمنح Dropbox التفويض الدائم. افتح صفحة الموافقة من هنا وأدخل الرمز الجديد.');
  }
  return { refreshToken: String(body.refresh_token), accessToken: String(body.access_token), expiresIn: Number(body.expires_in || 14400) };
}

export class DropboxClient {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private selectedAccount?: DropboxAccount;

  constructor(private creds: DropboxCredentials, private hosts = dropboxHosts()) {}

  private async refresh(scope?: string, signal?: AbortSignal) {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.creds.refreshToken,
      client_id: this.creds.appKey,
      client_secret: this.creds.appSecret,
    });
    if (scope) params.set('scope', scope);
    const res = await fetch(`${this.hosts.api}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params,
      signal,
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      if (res.ok || res.status === 429 || res.status >= 500) {
        throw new DropboxError(res.ok ? 502 : res.status, 'خدمة تفويض Dropbox غير متاحة الآن');
      }
      if (scope && body.error === 'invalid_scope') throw new DropboxError(400, `الإذن ${scope} غير ممنوح في Dropbox. فعّله ثم أعد الربط.`, 'invalid_scope');
      throw new DropboxError(res.status, 'تعذر تجديد تفويض Dropbox؛ تحقق من المفاتيح أو أعد الربط', typeof body.error === 'string' ? body.error : undefined);
    }
    if (scope && typeof body.scope === 'string' && !body.scope.split(/\s+/).includes(scope)) {
      throw new DropboxError(400, 'الإذن المطلوب غير ممنوح في Dropbox', 'invalid_scope');
    }
    return { token: String(body.access_token), expiresAt: Date.now() + Number(body.expires_in || 14400) * 1000 };
  }

  private async token(signal?: AbortSignal): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;
    const refreshed = await this.refresh(undefined, signal);
    this.accessToken = refreshed.token;
    this.expiresAt = refreshed.expiresAt;
    return this.accessToken;
  }

  /** On a fresh client, verifies the saved credentials by requesting a new access token. */
  async verifyCredentials(signal: AbortSignal): Promise<void> {
    await this.token(signal);
  }

  /** Verify the OAuth grant using a scoped token that is never used to access a file. */
  async verifyScope(scope: 'files.content.read' | 'files.content.write', signal: AbortSignal): Promise<void> {
    await this.refresh(scope, signal);
  }

  private async call(endpoint: string, args: unknown, signal?: AbortSignal): Promise<any> {
    const res = await this.storageRaw(`${this.hosts.api}/2/${endpoint}`, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(args), signal });
    return res.json();
  }

  private async storageRaw(url: string, init: DropboxRequest): Promise<Response> {
    const account = await this.account(init.signal);
    const headers = { ...init.headers };
    if (account.teamMemberId) headers['dropbox-api-select-user'] = account.teamMemberId;
    if (account.rootNamespaceId) headers['dropbox-api-path-root'] = headerJson({ '.tag': 'root', root: account.rootNamespaceId });
    return this.raw(url, { ...init, headers });
  }

  private async raw(url: string, init: DropboxRequest, retry = true): Promise<Response> {
    const res = await fetch(url, {
      method: 'POST',
      ...init,
      headers: { authorization: `Bearer ${await this.token(init.signal)}`, ...(init.headers || {}) },
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
        const body = JSON.parse(text);
        summary = typeof body.error_summary === 'string' ? body.error_summary : String(body.error?.['.tag'] || text);
      } catch {
        // plain-text error
      }
      if (/not_found/.test(summary)) throw new DropboxError(404, 'الملف غير موجود في Dropbox', summary);
      if (/insufficient_space/.test(summary)) throw new DropboxError(507, 'مساحة Dropbox ممتلئة', summary);
      if (/^invalid_root(\/|$)/.test(summary)) throw new DropboxError(409, 'تغيّر جذر مساحة Dropbox. تحقق من مسارات ملفات المكتبة ثم جدّد الربط.', 'invalid_root');
      throw new DropboxError(res.status, 'تعذر إكمال الطلب في Dropbox', summary);
    }
    return res;
  }

  private async currentAccount(signal: AbortSignal, teamMemberId?: string): Promise<DropboxAccount> {
    const headers = teamMemberId ? { 'dropbox-api-select-user': teamMemberId } : undefined;
    const res = await this.raw(`${this.hosts.api}/2/users/get_current_account`, { signal, headers });
    const body: any = await res.json();
    const name = String(body?.name?.display_name || body?.email || 'Dropbox');
    if (!teamMemberId) return { name };
    if (body?.disabled || (body?.team_member_id && body.team_member_id !== teamMemberId)) {
      throw new DropboxError(400, 'عضو Dropbox المحدد غير نشط أو غير متاح لهذا التفويض.', 'invalid_team_member');
    }
    const rootNamespaceId = body?.root_info?.root_namespace_id;
    if (typeof rootNamespaceId !== 'string' || !/^\d+$/.test(rootNamespaceId)) {
      throw new DropboxError(400, 'تعذر تحديد جذر مساحة Dropbox للعضو المختار.', 'invalid_root');
    }
    if (this.creds.teamRootNamespaceId && this.creds.teamRootNamespaceId !== rootNamespaceId) {
      throw new DropboxError(409, 'تغيّر جذر مساحة Dropbox. تحقق من مسارات ملفات المكتبة ثم جدّد الربط.', 'invalid_root');
    }
    return { name, teamMemberId, rootNamespaceId };
  }

  private async teamAccount(signal: AbortSignal, memberId?: string): Promise<DropboxAccount> {
    if (memberId && !validDropboxTeamMemberId(memberId)) {
      throw new DropboxError(400, 'معرّف عضو فريق Dropbox غير صالح.', 'invalid_team_member');
    }
    if (!memberId || !this.creds.automaticTeamMember) {
      const endpoint = memberId ? 'members/get_info_v2' : 'token/get_authenticated_admin';
      const scope = memberId ? 'members.read' : 'team_info.read';
      let profile: any;
      try {
        const request = memberId ? {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ members: [{ '.tag': 'team_member_id', team_member_id: memberId }] }),
        } : {};
        const result: any = await (await this.raw(`${this.hosts.api}/2/team/${endpoint}`, { ...request, signal })).json();
        profile = memberId ? result?.members?.[0]?.profile : result?.admin_profile;
      } catch (error) {
        if (dropboxMissingScope(error)) {
          throw new DropboxError(400, `فعّل إذن ${scope} في Dropbox ثم أعد الربط.`, 'missing_scope');
        }
        if (error instanceof DropboxError && /^(mapping_not_found|admin_not_active)(\/|$)/.test(error.summary || '')) {
          throw new DropboxError(400, 'تعذر تحديد المسؤول الذي فوّض ربط فريق Dropbox. جدّد تفويض الفريق أو اختر عضواً نشطاً.', 'invalid_team_member');
        }
        if (memberId && error instanceof DropboxError && /linked to a user|user access token|user-linked|team access token/i.test(error.summary || '')) {
          throw new DropboxError(400, 'اختيار عضو يتطلب تفويض Dropbox لفريق العمل.', 'invalid_team_member');
        }
        throw error;
      }
      if (profile?.status?.['.tag'] !== 'active' || !validDropboxTeamMemberId(profile?.team_member_id) || (memberId && profile.team_member_id !== memberId)) {
        throw new DropboxError(400, 'عضو Dropbox المحدد غير نشط أو غير متاح لهذا التفويض.', 'invalid_team_member');
      }
      memberId = profile.team_member_id;
    }
    try {
      return await this.currentAccount(signal, memberId);
    } catch (error) {
      if (dropboxMissingScope(error)) {
        throw new DropboxError(400, 'فعّل إذني team_data.member وaccount_info.read في Dropbox ثم أعد الربط.', 'missing_scope');
      }
      if (teamTokenNeedsMember(error) || (error instanceof DropboxError && /^user_suspended(\/|$)/.test(error.summary || ''))) {
        throw new DropboxError(400, 'تعذر استخدام Dropbox بصفة العضو المختار. تحقق من نشاط العضو وإذن team_data.member.', 'invalid_team_member');
      }
      throw error;
    }
  }

  private async selectAccount(signal: AbortSignal): Promise<DropboxAccount> {
    if (this.creds.teamMemberId) return this.teamAccount(signal, this.creds.teamMemberId);
    if (this.creds.teamRootNamespaceId) return this.teamAccount(signal);
    try {
      return await this.currentAccount(signal);
    } catch (error) {
      if (teamTokenNeedsMember(error)) return this.teamAccount(signal);
      if (!dropboxMissingScope(error)) throw error;
    }
    // Older user-linked grants may have file scopes without account_info.read.
    try {
      await this.raw(`${this.hosts.api}/2/files/list_folder`, {
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: '', limit: 1 }), signal,
      });
      return { name: 'Dropbox' };
    } catch (error) {
      if (teamTokenNeedsMember(error)) return this.teamAccount(signal);
      throw error;
    }
  }

  async account(signal = AbortSignal.timeout(10_000)): Promise<DropboxAccount> {
    if (this.selectedAccount) return this.selectedAccount;
    const account = await this.selectAccount(signal);
    return (this.selectedAccount ??= account);
  }

  async listActiveTeamMembers(cursor?: string): Promise<TeamMemberPage> {
    const endpoint = cursor ? 'members/list/continue_v2' : 'members/list_v2';
    const response = await this.raw(`${this.hosts.api}/2/team/${endpoint}`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cursor ? { cursor } : { limit: 100, include_removed: false }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json() as DropboxDirectoryResponse;
    if (!Array.isArray(data.members) || (data.has_more && (!data.cursor || data.cursor === cursor))) {
      throw new DropboxError(502, 'لم يُرجع Dropbox صفحة صالحة لأعضاء الفريق.');
    }
    return {
      members: data.members.flatMap(({ profile }) => {
        if (profile?.status?.['.tag'] !== 'active' || !validDropboxTeamMemberId(profile.team_member_id)) return [];
        return [{ id: profile.team_member_id, name: profile.name?.display_name || profile.email || profile.team_member_id, email: profile.email }];
      }),
      cursor: data.has_more ? data.cursor : undefined,
    };
  }

  async usage(): Promise<{ used: number; allocated?: number }> {
    const account = await this.account();
    const headers = account.teamMemberId ? { 'dropbox-api-select-user': account.teamMemberId } : undefined;
    const res = await this.raw(`${this.hosts.api}/2/users/get_space_usage`, { headers });
    const body: any = await res.json();
    return { used: Number(body?.used || 0), allocated: Number(body?.allocation?.allocated || 0) || undefined };
  }

  /** Uploads a local file; Dropbox renames on a clash. Returns the stored path. */
  async upload(localPath: string, remotePath: string, size: number): Promise<DropboxEntry> {
    const commit = { path: remotePath, mode: 'add', autorename: true, mute: true };
    if (size <= SINGLE_UPLOAD_LIMIT) {
      const res = await this.storageRaw(`${this.hosts.content}/2/files/upload`, {
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
      const started = await this.storageRaw(`${this.hosts.content}/2/files/upload_session/start`, { headers: octet({ close: false }), body: first });
      const sessionId = String((await started.json()).session_id);
      let offset = first.length;
      // Every chunk but the last is appended; the last one travels with the commit.
      while (true) {
        const chunk = offset < size ? await readAt(offset) : Buffer.alloc(0);
        if (offset + chunk.length >= size) {
          const res = await this.storageRaw(`${this.hosts.content}/2/files/upload_session/finish`, {
            headers: octet({ cursor: { session_id: sessionId, offset }, commit }),
            body: chunk,
          });
          return toEntry(await res.json());
        }
        await this.storageRaw(`${this.hosts.content}/2/files/upload_session/append_v2`, {
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
    return this.storageRaw(`${this.hosts.content}/2/files/download`, { headers });
  }

  async verifyFolderWriteAccess(path: string, signal: AbortSignal): Promise<void> {
    if (!path) return;
    const body = await this.call('files/get_metadata', { path }, signal);
    if (body?.sharing_info?.read_only === true) {
      throw new DropboxError(403, 'مجلد Dropbox للقراءة فقط بالنسبة للحساب المختار.', 'path/no_permission');
    }
  }

  async search(query: string, root: string, limit = 50): Promise<DropboxEntry[]> {
    const body = await this.call('files/search_v2', {
      query: query.slice(0, 200),
      options: { path: root || '', max_results: Math.min(limit, 100), file_status: 'active', filename_only: false },
    });
    return (body.matches || []).map((m: any) => toEntry(m?.metadata?.metadata || {})).filter((e: DropboxEntry) => e.path);
  }

  async list(path: string, limit = 200, signal?: AbortSignal): Promise<DropboxEntry[]> {
    let body = await this.call('files/list_folder', { path: path || '', limit: Math.min(limit, 2000), include_deleted: false }, signal);
    const entries: DropboxEntry[] = (body.entries || []).map(toEntry);
    const usedCursors = new Set<string>();
    while (body.has_more && entries.length < limit && typeof body.cursor === 'string' && !usedCursors.has(body.cursor)) {
      usedCursors.add(body.cursor);
      body = await this.call('files/list_folder/continue', { cursor: body.cursor }, signal);
      entries.push(...(body.entries || []).map(toEntry));
    }
    return entries.slice(0, limit);
  }

  async metadata(path: string, signal?: AbortSignal): Promise<DropboxEntry> {
    return toEntry(await this.call('files/get_metadata', { path }, signal));
  }

  async remove(path: string): Promise<void> {
    try {
      await this.call('files/delete_v2', { path });
    } catch (err) {
      if (!(err instanceof DropboxError && err.status === 404)) logger.warn('dropbox delete failed', { error: String(err) });
    }
  }
}
