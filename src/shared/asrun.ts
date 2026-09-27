/**
 * As-Run: what actually went to air, against the plan. Built from the on-air log that the
 * server stamps (segment start/end times), so it reflects real timings, not the rundown.
 */
import type { OnAirState } from './onair';

export interface AsRunRow {
  segmentId: string;
  title: string;
  plannedSeconds: number | null;
  startedAt: string;
  endedAt?: string;
  actualSeconds: number | null;
  /** actual - planned (positive = overran). */
  diffSeconds: number | null;
}

export interface AsRunShow {
  id: string;
  title: string;
  programName: string;
  kind: 'episode' | 'bulletin';
  scheduledStart?: string;
  startedAt: string;
  endedAt?: string;
  /** Seconds between the scheduled and the actual start (positive = late). */
  startDelaySeconds: number | null;
  plannedSeconds: number;
  actualSeconds: number | null;
  status: 'LIVE' | 'ENDED';
  operatorName?: string;
  rows: AsRunRow[];
}

const secs = (a?: string, b?: string) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000)) : null);

/** Local date (YYYY-MM-DD) of an ISO time. */
export const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function asRunShow(state: OnAirState, show: any | undefined, now = Date.now()): AsRunShow {
  const planned = new Map<string, number>((show?.rundown || []).map((s: any) => [s.id, Number(s.durationSeconds) || 0]));
  const log = state.log || [];
  const rows: AsRunRow[] = log.map((l, i) => {
    const end = l.endedAt || (i === log.length - 1 && state.status === 'LIVE' ? new Date(now).toISOString() : log[i + 1]?.startedAt);
    const actual = secs(l.startedAt, end);
    const plan = planned.has(l.segmentId) ? planned.get(l.segmentId)! : null;
    return { segmentId: l.segmentId, title: l.title, plannedSeconds: plan, startedAt: l.startedAt, endedAt: l.endedAt, actualSeconds: actual, diffSeconds: actual !== null && plan !== null ? actual - plan : null };
  });
  const scheduledStart = show?.broadcastDate && show?.startTime ? new Date(`${String(show.broadcastDate).slice(0, 10)}T${show.startTime}:00`).toISOString() : undefined;
  return {
    id: state.episodeId,
    title: state.episodeTitle || show?.title || '',
    programName: state.programName || show?.programName || '',
    kind: show?.kind === 'bulletin' ? 'bulletin' : 'episode',
    scheduledStart,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    startDelaySeconds: scheduledStart ? Math.round((Date.parse(state.startedAt) - Date.parse(scheduledStart)) / 1000) : null,
    plannedSeconds: [...planned.values()].reduce((a, b) => a + b, 0),
    actualSeconds: secs(state.startedAt, state.endedAt || (state.status === 'LIVE' ? new Date(now).toISOString() : undefined)),
    status: state.status,
    operatorName: state.operatorName,
    rows,
  };
}

/** Every show that went on air on a given local day, in air order. */
export function asRunForDay(states: OnAirState[], shows: any[], day: string, now = Date.now()): AsRunShow[] {
  return states
    .filter((s) => s.startedAt && localDay(s.startedAt) === day)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((s) => asRunShow(s, shows.find((x) => x.id === s.episodeId), now));
}
