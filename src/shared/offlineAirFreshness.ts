import type { OfflineAirPacket } from './offlineAir';

type SourceCollection = OfflineAirPacket['baseRows'][number]['collection'];
export type OfflineAirSourceVersion = [collection: SourceCollection, id: string, version: number];

export function offlineAirStateMarker(state: Record<string, unknown> | null) {
  if (!state) return null;
  return [state.status, state.startedAt, state.endedAt, state.currentSegmentId, state.segmentStartedAt]
    .map(field => typeof field === 'string' ? field : null);
}

export function serializeOfflineAirSnapshot(sourceVersions: OfflineAirSourceVersion[], stateMarker: ReturnType<typeof offlineAirStateMarker>) {
  const rows = [...new Set(sourceVersions.map(row => JSON.stringify(row)))].sort();
  return JSON.stringify([rows, stateMarker]);
}

export async function fingerprintOfflineAirSnapshot(serialized: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export interface OfflineAirSnapshot {
  dbId: string;
  snapshotFingerprint?: string;
}

export function compareOfflineAirSnapshot(baseline: OfflineAirSnapshot, current: OfflineAirSnapshot | null) {
  if (!current || baseline.dbId !== current.dbId || !baseline.snapshotFingerprint || !current.snapshotFingerprint) return 'UNKNOWN';
  return baseline.snapshotFingerprint === current.snapshotFingerprint ? 'MATCHES' : 'CHANGED';
}
