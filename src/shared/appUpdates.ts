export interface AppRelease {
  version: string;
  url: string;
}

export interface AppUpdateStatus {
  deployedVersion: string;
  latest: AppRelease | null;
  broadcastActive: boolean;
  deployment: 'github' | 'webhook' | null;
  requestedVersion: string | null;
  tracking?: AppUpdateTracking | null;
  backupRequired?: boolean;
}

export interface AppUpdateTracking {
  version: string;
  requestedAt: string;
  state: 'accepted' | 'deployed' | 'unverified';
}

const STABLE_VERSION = /^v?(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})$/;

export function stableVersion(value: unknown): string | null {
  return typeof value === 'string' && STABLE_VERSION.test(value) ? value.replace(/^v/, '') : null;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = stableVersion(candidate)?.split('.').map(Number);
  const installed = stableVersion(current)?.split('.').map(Number);
  if (!next || !installed) return false;
  const difference = next.findIndex((part, i) => part !== installed[i]);
  return difference !== -1 && next[difference] > installed[difference];
}
