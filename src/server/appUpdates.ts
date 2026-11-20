import { createHmac } from 'node:crypto';
import { stableVersion, type AppRelease } from '../shared/appUpdates';

const REPOSITORY = 'ahmedahmed1223/Madar-NRSC';
const GITHUB_API = `https://api.github.com/repos/${REPOSITORY}`;
const GITHUB_WEB = `https://github.com/${REPOSITORY}`;
const REQUEST_TIMEOUT = 5000;

export interface UpdateConfig {
  githubToken?: string;
  mode: 'manual' | 'github' | 'webhook';
  workflow?: string;
  webhookUrl?: string;
  webhookSecret?: string;
}

export function createAppUpdates(config: UpdateConfig) {
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
  let request: { version: string; expiresAt: number } | undefined;

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

  const requestedVersion = () => request && request.expiresAt > Date.now() ? request.version : null;

  const dispatch = async (version: string): Promise<'accepted' | 'pending' | 'failed'> => {
    if (pending || requestedVersion()) return 'pending';
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
      request = { version, expiresAt: Date.now() + 900_000 };
      return 'accepted';
    } catch {
      return 'failed';
    } finally {
      pending = false;
    }
  };

  return { deployment, latest, requestedVersion, dispatch };
}
