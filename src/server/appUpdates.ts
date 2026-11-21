import { createHmac } from 'node:crypto';
import { isNewerVersion, stableVersion, type AppRelease, type AppUpdateTracking } from '../shared/appUpdates';
import type { NewsroomDatabase } from './db';

const REPOSITORY = 'ahmedahmed1223/Madar-NRSC';
const GITHUB_API = `https://api.github.com/repos/${REPOSITORY}`;
const GITHUB_WEB = `https://github.com/${REPOSITORY}`;
const REQUEST_TIMEOUT = 5000;
const PENDING_MS = 900_000;
const UPDATE_REQUEST = 'app_update_last_request';

export interface UpdateConfig {
  githubToken?: string;
  mode: 'manual' | 'github' | 'webhook';
  workflow?: string;
  webhookUrl?: string;
  webhookSecret?: string;
}

export function createAppUpdates(config: UpdateConfig, store?: Pick<NewsroomDatabase, 'getMeta' | 'setMeta'>) {
  const githubHeaders = () => ({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10',
    ...(config.githubToken && { Authorization: `Bearer ${config.githubToken}` }),
  });
  let webhook: URL | undefined;
  if (config.mode === 'webhook' && config.webhookSecret && config.webhookSecret.length >= 32) {
    try {
      const url = new URL(config.webhookUrl || '');
      if (url.protocol === 'https:' && !url.username && !url.password && !url.hash) webhook = url;
    } catch {
      // Invalid deployment configuration leaves release checks available.
    }
  }
  const deployment: 'github' | 'webhook' | null = config.mode === 'github' && config.githubToken && /^[\w.-]+$/.test(config.workflow || '')
    ? 'github' : webhook ? 'webhook' : null;
  let latestJob: Promise<AppRelease | null> | undefined;
  let cache: { release: AppRelease | null; expiresAt: number } | undefined;
  let pending = false;
  let request: { version: string; requestedAt: string } | undefined;

  const read = async (): Promise<AppRelease | null> => {
    try {
      const response = await fetch(`${GITHUB_API}/releases/latest`, {
        headers: githubHeaders(), redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      if (!response.ok) return null;
      const body = await response.json();
      const version = stableVersion(body?.tag_name);
      if (!version || body.tag_name !== `v${version}` || body.draft !== false || body.prerelease !== false) return null;
      return { version, url: `${GITHUB_WEB}/releases/tag/${encodeURIComponent(body.tag_name)}` };
    } catch {
      return null;
    }
  };

  const latest = () => {
    if (cache && cache.expiresAt > Date.now()) return Promise.resolve(cache.release);
    latestJob ??= read().then((release) => {
      cache = { release, expiresAt: Date.now() + (release ? 300_000 : 30_000) };
      return release;
    }).finally(() => { latestJob = undefined; });
    return latestJob;
  };

  const lastRequest = () => {
    try {
      const stored = JSON.parse(store?.getMeta(UPDATE_REQUEST) || 'null');
      const version = stableVersion(stored?.version);
      const time = Date.parse(stored?.requestedAt);
      if (version && Number.isFinite(time) && (!request || time > Date.parse(request.requestedAt))) return { version, requestedAt: new Date(time).toISOString() };
    } catch {
      // Invalid legacy metadata cannot confirm an update.
    }
    return request;
  };

  const tracking = (deployedVersion?: string): AppUpdateTracking | null => {
    const item = lastRequest();
    if (!item) return null;
    const deployed = !!deployedVersion && (stableVersion(deployedVersion) === item.version || isNewerVersion(deployedVersion, item.version));
    const withinWindow = Date.now() - Date.parse(item.requestedAt) < PENDING_MS;
    return { ...item, state: deployed ? 'deployed' : withinWindow ? 'accepted' : 'unverified' };
  };

  const requestedVersion = (deployedVersion?: string) => {
    const item = tracking(deployedVersion);
    return item?.state === 'accepted' ? item.version : null;
  };

  const dispatch = async (version: string, deployedVersion?: string): Promise<'accepted' | 'pending' | 'failed'> => {
    if (pending || requestedVersion(deployedVersion)) return 'pending';
    if (!deployment || !stableVersion(version)) return 'failed';
    pending = true;
    try {
      const body = deployment === 'github'
        ? JSON.stringify({ ref: 'main', inputs: { version: `v${version}` } })
        : JSON.stringify({ version: `v${version}`, repository: REPOSITORY });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (deployment === 'github') Object.assign(headers, githubHeaders());
      else {
        headers['Idempotency-Key'] = `madar-release:v${version}`;
        headers['X-Madar-Timestamp'] = timestamp;
        headers['X-Madar-Signature'] = `sha256=${createHmac('sha256', config.webhookSecret!).update(`${timestamp}.${body}`).digest('hex')}`;
      }
      const target = deployment === 'github'
        ? `${GITHUB_API}/actions/workflows/${encodeURIComponent(config.workflow!)}/dispatches` : webhook!;
      const response = await fetch(target, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
      if (!response.ok) return 'failed';
      void response.body?.cancel().catch(() => undefined);
      request = { version, requestedAt: new Date().toISOString() };
      try { store?.setMeta(UPDATE_REQUEST, JSON.stringify(request)); } catch {
        // An accepted dispatch remains accepted. Its receipt is still available until restart.
      }
      return 'accepted';
    } catch {
      return 'failed';
    } finally {
      pending = false;
    }
  };

  return { deployment, latest, requestedVersion, dispatch, tracking };
}
