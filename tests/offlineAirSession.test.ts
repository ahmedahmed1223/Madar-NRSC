import { expect, it } from 'vitest';
import { createLocalSession, reduceLocalSession, localTiming, offlineClockJump } from '../src/shared/offlineAirSession';
import type { OfflineAirPacket } from '../src/shared/offlineAir';
const packet = { packetId: 'packet', canOperate: true, show: { id: 'show', segments: [{ id: 'a', durationSeconds: 20 }, { id: 'b', durationSeconds: 0 }] } } as OfflineAirPacket;
it('distinguishes clock changes from ordinary elapsed time', () => {
  expect(offlineClockJump(1000, 100, 2000, 1100)).toBe(false);
  expect(offlineClockJump(1000, 100, 202000, 1100)).toBe(true);
  expect(offlineClockJump(201000, 100, 1000, 1100)).toBe(true);
});
it('recovers timing, pauses precisely, bounds navigation and preserves journal order', () => {
  let session = createLocalSession(packet, 1000);
  session = reduceLocalSession(session, 'START', 1000);
  expect(localTiming(session, 6000).elapsed).toBe(5);
  session = reduceLocalSession(session, 'PAUSE', 6000);
  expect(localTiming(session, 16000).elapsed).toBe(5);
  session = reduceLocalSession(session, 'RESUME', 16000);
  expect(localTiming(JSON.parse(JSON.stringify(session)), 18000).elapsed).toBe(7);
  session = reduceLocalSession(session, 'NEXT', 18000);
  expect(localTiming(session, 19000).remaining).toBe(-1);
  expect(reduceLocalSession(session, 'NEXT', 19000)).toBe(session);
  session = reduceLocalSession(session, 'END', 19000);
  expect(localTiming(session, 29000).elapsed).toBe(1);
  expect(session.events.map(event => event.sequence)).toEqual([1, 2, 3, 4, 5]);
  expect(new Set(session.events.map(event => event.id)).size).toBe(5);
  expect(reduceLocalSession(session, 'RESUME', 30000)).toBe(session);
});
it('holds backwards clock recovery and denies operation for read-only packets', () => {
  const session = reduceLocalSession(createLocalSession(packet, 1000), 'START', 2000);
  expect(localTiming(session, 1000).clockReview).toBe(true);
  expect(reduceLocalSession(session, 'NEXT', 1000)).toBe(session);
  const readOnly = createLocalSession({ ...packet, canOperate: false }, 1000);
  expect(reduceLocalSession(readOnly, 'START', 1000)).toBe(readOnly);
});
