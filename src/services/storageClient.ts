import { apiFetch } from './http';
import type { CloudProviderId, DropboxCheck, DropboxVerification, StorageCopy, StorageLocations, StorageStatus } from '../shared/storage';

/** A file found in Dropbox, Google Drive or the shared folder. */
export interface ExternalFile {
  ref: string;
  name: string;
  path: string;
  size: number;
  modifiedAt?: string;
  isFolder?: boolean;
  supported: boolean;
}

export type ExternalSource = CloudProviderId | 'share';

export interface ImportedFile {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
}

export const storageClient = {
  async status(): Promise<StorageStatus> {
    return (await apiFetch<{ data: StorageStatus }>('/api/v1/storage/status')).data;
  },
  async locations(uploadId: string): Promise<StorageLocations> {
    return (await apiFetch<{ data: StorageLocations }>(`/api/v1/storage/locations/${encodeURIComponent(uploadId)}`)).data;
  },
  async copies(uploadIds: string[]): Promise<Record<string, StorageCopy[]>> {
    if (!uploadIds.length) return {};
    return (await apiFetch<{ data: Record<string, StorageCopy[]> }>('/api/v1/storage/copies', { method: 'POST', json: { ids: uploadIds } })).data;
  },
  async inventory(uploadIds: string[], signal?: AbortSignal): Promise<Record<string, StorageLocations>> {
    if (!uploadIds.length) return {};
    return (await apiFetch<{ locations: Record<string, StorageLocations> }>('/api/v1/storage/copies', {
      method: 'POST', json: { ids: uploadIds, inventory: true }, signal,
    })).locations;
  },
  async search(source: ExternalSource, q: string): Promise<ExternalFile[]> {
    return (await apiFetch<{ data: ExternalFile[] }>(`/api/v1/storage/${source}/search?q=${encodeURIComponent(q)}`)).data;
  },
  async list(source: CloudProviderId, at = ''): Promise<{ at: string; items: ExternalFile[]; hasMore?: boolean }> {
    return (await apiFetch<{ data: { at: string; items: ExternalFile[]; hasMore?: boolean } }>(`/api/v1/storage/${source}/list?at=${encodeURIComponent(at)}`)).data;
  },
  async importFile(source: ExternalSource, ref: string): Promise<ImportedFile> {
    return (await apiFetch<{ data: ImportedFile }>(`/api/v1/storage/${source}/import`, { method: 'POST', json: { ref } })).data;
  },
  // Administration
  async verifyDropbox(check: DropboxCheck): Promise<DropboxVerification> {
    return (await apiFetch<{ data: DropboxVerification }>('/api/v1/storage/dropbox/verify', { method: 'POST', json: { check } })).data;
  },
  async dropboxTeamMembers(credentials: { appKey: string; appSecret: string; refreshToken: string }, cursor?: string): Promise<{ members: DropboxTeamMember[]; cursor?: string }> {
    return (await apiFetch<{ data: { members: DropboxTeamMember[]; cursor?: string } }>('/api/v1/storage/dropbox/team-members', {
      method: 'POST', json: { ...credentials, cursor }, signal: AbortSignal.timeout(15_000),
    })).data;
  },
  async dropboxAuthorizeUrl(appKey: string): Promise<string> {
    return (await apiFetch<{ data: { url: string } }>('/api/v1/storage/dropbox/authorize-url', { method: 'POST', json: { appKey } })).data.url;
  },
  async connectDropbox(appKey: string, appSecret: string, credential: string | { refreshToken: string }, teamMemberId?: string): Promise<StorageStatus> {
    const authorization = typeof credential === 'string' ? { code: credential } : credential;
    const account = teamMemberId ? { accountMode: 'member', teamMemberId } : {};
    return (await apiFetch<{ data: StorageStatus }>('/api/v1/storage/dropbox/connect', { method: 'POST', json: { appKey, appSecret, ...authorization, ...account }, signal: AbortSignal.timeout(27_000) })).data;
  },
  async disconnect(provider: CloudProviderId): Promise<StorageStatus> {
    return (await apiFetch<{ data: StorageStatus }>(`/api/v1/storage/${provider}/disconnect`, { method: 'POST', json: {} })).data;
  },
  async driveAuthorizeUrl(clientId: string, clientSecret: string): Promise<{ url: string; redirectUri: string }> {
    return (await apiFetch<{ data: { url: string; redirectUri: string } }>('/api/v1/storage/gdrive/authorize-url', { method: 'POST', json: { clientId, clientSecret } })).data;
  },
  async newBridgeToken(): Promise<string> {
    return (await apiFetch<{ data: { token: string } }>('/api/v1/storage/bridge/token', { method: 'POST', json: {} })).data.token;
  },
  async revokeBridge(): Promise<void> {
    await apiFetch('/api/v1/storage/bridge/revoke', { method: 'POST', json: {} });
  },
  async queue(): Promise<{ pending: number; failed: number; done: number; lastErrors: { uploadId: string; target: string; error: string; updatedAt: string }[] }> {
    return (await apiFetch<{ data: any }>('/api/v1/storage/queue')).data;
  },
  async retryFailed(): Promise<number> {
    return (await apiFetch<{ data: { retried: number } }>('/api/v1/storage/queue/retry', { method: 'POST', json: {} })).data.retried;
  },
  async syncNow(): Promise<StorageStatus> {
    return (await apiFetch<{ data: { status: StorageStatus } }>('/api/v1/storage/sync-now', { method: 'POST', json: {} })).data.status;
  },
};
import type { DropboxTeamMember } from '../shared/dropboxAuthorization';
