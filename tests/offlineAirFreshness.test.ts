import { expect, it } from 'vitest';
import { compareOfflineAirSnapshot, fingerprintOfflineAirSnapshot, offlineAirStateMarker, serializeOfflineAirSnapshot, type OfflineAirSourceVersion } from '../src/shared/offlineAirFreshness';

const state = { status: 'LIVE', startedAt: '2026-10-10T12:00:00.000Z', currentSegmentId: 'first', segmentStartedAt: '2026-10-10T12:00:00.000Z' };
const rows: OfflineAirSourceVersion[] = [['bulletins', 'show', 2], ['bulletinStories', 'first', 3]];
const snapshot = async (versions = rows, airState: Record<string, unknown> | null = state) => ({
  dbId: 'db',
  snapshotFingerprint: await fingerprintOfflineAirSnapshot(serializeOfflineAirSnapshot(versions, offlineAirStateMarker(airState))),
});

it('recognizes an unchanged snapshot despite row ordering, repeated show rows and hidden operator metadata', async () => {
  expect(compareOfflineAirSnapshot(await snapshot(), await snapshot([rows[1], rows[0], rows[0]], { ...state, operatorName: 'ignored' }))).toBe('MATCHES');
});

it('flags row edits, removed rundown content and confirmed studio changes', async () => {
  const baseline = await snapshot();
  expect(compareOfflineAirSnapshot(baseline, await snapshot([['bulletins', 'show', 3], rows[1]]))).toBe('CHANGED');
  expect(compareOfflineAirSnapshot(baseline, await snapshot([rows[0]]))).toBe('CHANGED');
  expect(compareOfflineAirSnapshot(baseline, await snapshot(rows, { ...state, currentSegmentId: 'next' }))).toBe('CHANGED');
});

it('shows unknown for an old packet, unavailable data or another database', async () => {
  const baseline = await snapshot();
  expect(compareOfflineAirSnapshot({ dbId: 'db' }, baseline)).toBe('UNKNOWN');
  expect(compareOfflineAirSnapshot(baseline, null)).toBe('UNKNOWN');
  expect(compareOfflineAirSnapshot(baseline, { ...baseline, dbId: 'another' })).toBe('UNKNOWN');
});
