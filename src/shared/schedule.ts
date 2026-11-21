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

/** First opening in the same studio that fits the candidate's existing duration. */
export function suggestedStudioStart(candidate: SchedulableEpisode, all: readonly SchedulableEpisode[]): { date: string; startTime: string } | null {
  const window = isScheduled(candidate) ? episodeWindow(candidate) : null;
  if (!window) return null;
  const studio = normStudio(candidate.studioName);
  const otherWindows = all
    .filter(other => other.id !== candidate.id && isScheduled(other) && normStudio(other.studioName) === studio)
    .map(episodeWindow).filter(other => other !== null).sort((a, b) => a.start - b.start);
  const duration = window.end - window.start;
  let start = window.start;
  for (const other of otherWindows) {
    if (other.start >= start + duration) break;
    start = Math.max(start, other.end);
  }
  if (start === window.start) return null;
  const instant = new Date(start * 60_000).toISOString();
  return { date: instant.slice(0, 10), startTime: instant.slice(11, 16) };
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

// ---------------------------------------------------------------------------
// Bulletins on the broadcast calendar
// ---------------------------------------------------------------------------

/** What occupies a studio slot on the broadcast calendar. */
export type AirSlotKind = 'episode' | 'bulletin' | 'scheduled-bulletin';

export interface AirSlot extends SchedulableEpisode {
  /** Unique across kinds: the episode id, `bulletin:<id>` or `format:<formatId>:<date>`. */
  id: string;
  kind: AirSlotKind;
  /** The record to open: episode id, bulletin id, or format id (a scheduled bulletin not created yet). */
  refId: string;
  title: string;
  programName?: string;
  programId?: string;
  presenterName?: string;
}

interface BulletinLike {
  id: string;
  title: string;
  kind?: string;
  date: string;
  startTime: string;
  plannedSeconds?: number;
  studioName?: string;
  anchors?: string[];
  status?: string;
  deletedAt?: string | null;
}

interface FormatLike {
  id: string;
  name: string;
  startTime: string;
  plannedSeconds?: number;
  studioName?: string;
  anchors?: string[];
  deletedAt?: string | null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "20:00" + 1800 s → "20:30" (wraps past midnight). */
export function addSecondsToTime(hhmm: string, seconds: number): string {
  const start = toMinutes(hhmm);
  if (start === null) return '';
  const end = (start + Math.ceil(Math.max(0, seconds) / 60)) % (24 * 60);
  return `${pad2(Math.floor(end / 60))}:${pad2(end % 60)}`;
}

const slotMinutes = (plannedSeconds?: number) => Math.max(1, Math.ceil((Number(plannedSeconds) || 0) / 60));

export function episodeSlot(ep: SchedulableEpisode & { programId?: string; presenterName?: string }): AirSlot {
  return { ...ep, kind: 'episode', refId: ep.id, title: ep.title || '' };
}

/** A created bulletin; its slot runs from its start for its planned length. */
export function bulletinSlot(b: BulletinLike, kindName = 'نشرة'): AirSlot {
  const minutes = slotMinutes(b.plannedSeconds);
  return {
    id: `bulletin:${b.id}`,
    kind: 'bulletin',
    refId: b.id,
    title: b.title,
    programName: kindName,
    studioName: b.studioName,
    broadcastDate: b.date,
    startTime: b.startTime,
    endTime: addSecondsToTime(b.startTime, minutes * 60),
    durationMinutes: minutes,
    presenterName: (b.anchors || []).join('، '),
    status: b.status,
    deletedAt: b.deletedAt || undefined,
  };
}

/** A bulletin the schedule plans for `date` that nobody has created yet (it will use the format's studio). */
export function scheduledBulletinSlot(f: FormatLike, date: string): AirSlot {
  const minutes = slotMinutes(f.plannedSeconds);
  return {
    id: `format:${f.id}:${date}`,
    kind: 'scheduled-bulletin',
    refId: f.id,
    title: f.name,
    programName: 'نشرة مجدولة',
    studioName: f.studioName,
    broadcastDate: date,
    startTime: f.startTime,
    endTime: addSecondsToTime(f.startTime, minutes * 60),
    durationMinutes: minutes,
    presenterName: (f.anchors || []).join('، '),
    deletedAt: f.deletedAt || undefined,
  };
}

export interface StudioClash {
  studioName: string;
  a: AirSlot;
  b: AirSlot;
  /** Minutes both bookings hold the studio. */
  overlapMinutes: number;
}

/**
 * Every pair of slots booked in the same studio at overlapping times, earliest first.
 * Back-to-back slots do not clash; deleted and cancelled ones are ignored.
 */
export function findStudioClashes(slots: AirSlot[]): StudioClash[] {
  const byStudio = new Map<string, { slot: AirSlot; start: number; end: number }[]>();
  for (const slot of slots) {
    if (!isScheduled(slot)) continue;
    const w = episodeWindow(slot);
    if (!w) continue;
    const key = normStudio(slot.studioName);
    if (!byStudio.has(key)) byStudio.set(key, []);
    byStudio.get(key)!.push({ slot, ...w });
  }
  const clashes: (StudioClash & { at: number })[] = [];
  for (const list of byStudio.values()) {
    list.sort((x, y) => x.start - y.start || x.end - y.end);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j].start < list[i].end; j++) {
        const overlap = Math.min(list[i].end, list[j].end) - list[j].start;
        if (overlap <= 0) continue;
        clashes.push({ studioName: list[i].slot.studioName || '', a: list[i].slot, b: list[j].slot, overlapMinutes: overlap, at: list[j].start });
      }
    }
  }
  return clashes.sort((x, y) => x.at - y.at).map(({ at: _at, ...c }) => c);
}

/** Only the clashes between a bulletin (created or scheduled) and a programme episode. */
export function bulletinEpisodeClashes(slots: AirSlot[]): StudioClash[] {
  return findStudioClashes(slots).filter((c) => (c.a.kind === 'episode') !== (c.b.kind === 'episode'));
}
