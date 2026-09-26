/** Studio scheduling helpers shared by the calendar, the episode forms and the tests. */

export interface SchedulableEpisode {
  id: string;
  title?: string;
  programName?: string;
  studioName?: string;
  broadcastDate?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  status?: string;
  deletedAt?: string;
}

const toMinutes = (hhmm?: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
};

/**
 * Absolute on-air window of an episode in minutes (UTC-free: dates are treated as calendar days).
 * An end time earlier than the start time means the show runs past midnight.
 */
export function episodeWindow(ep: SchedulableEpisode): { start: number; end: number } | null {
  if (!ep.broadcastDate || !/^\d{4}-\d{2}-\d{2}$/.test(ep.broadcastDate)) return null;
  const start = toMinutes(ep.startTime);
  if (start === null) return null;
  const day = Date.UTC(
    Number(ep.broadcastDate.slice(0, 4)),
    Number(ep.broadcastDate.slice(5, 7)) - 1,
    Number(ep.broadcastDate.slice(8, 10))
  ) / 60000;
  let end = toMinutes(ep.endTime);
  if (end === null || end === start) end = start + Math.max(1, Number(ep.durationMinutes) || 0);
  else if (end < start) end += 24 * 60;
  return { start: day + start, end: day + end };
}

const normStudio = (s?: string) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();

const isScheduled = (ep: SchedulableEpisode) => !ep.deletedAt && ep.status !== 'CANCELLED' && !!normStudio(ep.studioName);

/** Episodes of `all` whose studio booking overlaps `candidate` (excluding itself). */
export function studioConflictsFor<T extends SchedulableEpisode>(candidate: SchedulableEpisode, all: T[]): T[] {
  if (!isScheduled(candidate)) return [];
  const w = episodeWindow(candidate);
  if (!w) return [];
  const studio = normStudio(candidate.studioName);
  return all.filter((other) => {
    if (other.id === candidate.id || !isScheduled(other) || normStudio(other.studioName) !== studio) return false;
    const o = episodeWindow(other);
    return !!o && o.start < w.end && w.start < o.end;
  });
}

/** Ids of every episode that shares a studio with an overlapping booking. */
export function findStudioConflicts(all: SchedulableEpisode[]): Set<string> {
  const ids = new Set<string>();
  const byStudio = new Map<string, { id: string; start: number; end: number }[]>();
  for (const ep of all) {
    if (!isScheduled(ep)) continue;
    const w = episodeWindow(ep);
    if (!w) continue;
    const key = normStudio(ep.studioName);
    if (!byStudio.has(key)) byStudio.set(key, []);
    byStudio.get(key)!.push({ id: ep.id, ...w });
  }
  for (const slots of byStudio.values()) {
    slots.sort((a, b) => a.start - b.start);
    let reach = -Infinity;
    let reachId = '';
    for (const s of slots) {
      if (s.start < reach) {
        ids.add(s.id);
        ids.add(reachId);
      }
      if (s.end > reach) {
        reach = s.end;
        reachId = s.id;
      }
    }
  }
  return ids;
}
