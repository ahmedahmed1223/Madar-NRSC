import type { OfflineAirPacket } from './offlineAir';
export function offlineClockJump(previousWall: number, previousMonotonic: number, wall: number, monotonic: number): boolean {
  return Math.abs((wall - previousWall) - (monotonic - previousMonotonic)) > 120000;
}
export type OfflineAirAction = 'START' | 'NEXT' | 'PREVIOUS' | 'PAUSE' | 'RESUME' | 'END';
export interface OfflineAirEvent { id: string; sequence: number; action: OfflineAirAction; at: number; segmentId: string; }
export interface OfflineAirSession {
  version: 1; sessionId: string; packetId: string; canOperate: boolean;
  segments: { id: string; durationSeconds: number }[];
  status: 'READY' | 'RUNNING' | 'PAUSED' | 'ENDED'; index: number;
  checkpointAt: number; segmentElapsedMs: number; showElapsedMs: number;
  events: OfflineAirEvent[];
}
export function createLocalSession(packet: OfflineAirPacket, now: number): OfflineAirSession {
  return {
    version: 1, sessionId: crypto.randomUUID(), packetId: packet.packetId, canOperate: packet.canOperate,
    segments: packet.show.segments.map(segment => ({ id: segment.id, durationSeconds: segment.durationSeconds })),
    status: 'READY', index: 0, checkpointAt: now, segmentElapsedMs: 0, showElapsedMs: 0, events: [],
  };
}
export function localTiming(session: OfflineAirSession, now: number) {
  const clockReview = !Number.isFinite(now) || now < session.checkpointAt;
  const delta = session.status === 'RUNNING' && !clockReview ? now - session.checkpointAt : 0;
  const elapsed = (session.segmentElapsedMs + delta) / 1000;
  return {
    current: session.segments[session.index] || null, index: session.index, elapsed,
    remaining: (session.segments[session.index]?.durationSeconds || 0) - elapsed,
    onAirSeconds: (session.showElapsedMs + delta) / 1000, clockReview,
  };
}
export function reduceLocalSession(session: OfflineAirSession, action: OfflineAirAction, now: number): OfflineAirSession {
  if (!session.canOperate || !session.segments.length || session.status === 'ENDED' || session.events.length >= 2000 || localTiming(session, now).clockReview) return session;
  if (action === 'START' && session.status !== 'READY') return session;
  if (action !== 'START' && session.status === 'READY') return session;
  if (action === 'PAUSE' && session.status !== 'RUNNING') return session;
  if (action === 'RESUME' && session.status !== 'PAUSED') return session;
  if (action === 'NEXT' && session.index >= session.segments.length - 1) return session;
  if (action === 'PREVIOUS' && session.index <= 0) return session;
  const delta = session.status === 'RUNNING' ? now - session.checkpointAt : 0;
  const index = session.index + (action === 'NEXT' ? 1 : action === 'PREVIOUS' ? -1 : 0);
  const status = action === 'END' ? 'ENDED' : action === 'PAUSE' ? 'PAUSED' : action === 'START' || action === 'RESUME' ? 'RUNNING' : session.status;
  return {
    ...session, index, status, checkpointAt: now,
    segmentElapsedMs: ['START', 'NEXT', 'PREVIOUS'].includes(action) ? 0 : session.segmentElapsedMs + delta,
    showElapsedMs: session.showElapsedMs + delta,
    events: [...session.events, { id: crypto.randomUUID(), sequence: session.events.length + 1, action, at: now, segmentId: session.segments[index].id }],
  };
}
