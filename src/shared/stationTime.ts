/**
 * Station time for the on-air screens: the wall clock, today's date and countdowns to a
 * scheduled start follow the station's time zone (Settings → المنطقة الزمنية), not the clock
 * of the computer the screen runs on. Without a station zone the device's zone is used.
 */
import { zoneOffsetMinutes } from './dates';

const pad = (n: number) => String(n).padStart(2, '0');

export interface StationWall {
  /** YYYY-MM-DD in the station's zone. */
  date: string;
  hours: number;
  minutes: number;
  seconds: number;
  /** «21:04:09». */
  clock: string;
}

/** The station's wall clock at an instant. */
export function stationWall(now: Date | number = Date.now(), zone?: string): StationWall {
  const t = typeof now === 'number' ? now : now.getTime();
  const offset = zone ? zoneOffsetMinutes(zone, new Date(t)) : -new Date(t).getTimezoneOffset();
  const d = new Date(t + offset * 60_000);
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const seconds = d.getUTCSeconds();
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    hours,
    minutes,
    seconds,
    clock: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
  };
}

/**
 * Seconds from `now` until a show scheduled on `date` at `startTime` (station time); negative once
 * it is past. Null when the date or time is not usable.
 */
export function secondsUntilStart(date: string | undefined, startTime: string | undefined, now: Date | number = Date.now(), zone?: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  const s = /^(\d{1,2}):(\d{2})/.exec(startTime || '');
  if (!d || !s) return null;
  const wall = stationWall(now, zone);
  const [wy, wm, wd] = wall.date.split('-').map(Number);
  const nowAsUtc = Date.UTC(wy, wm - 1, wd, wall.hours, wall.minutes, wall.seconds);
  const startAsUtc = Date.UTC(+d[1], +d[2] - 1, +d[3], +s[1], +s[2]);
  return Math.round((startAsUtc - nowAsUtc) / 1000);
}

export type DriftLevel = 'ok' | 'warn' | 'alert';

export interface DriftStatus {
  kind: 'ON_TIME' | 'AHEAD' | 'BEHIND';
  /** ok = green, warn = amber, alert = red. */
  level: DriftLevel;
  /** «في الموعد» / «متقدم» / «متأخر». */
  label: string;
  /** Seconds ahead or behind (always positive; 0 when on time). */
  amount: number;
}

/**
 * Ahead/behind verdict for the director from the rundown drift (seconds, + = behind).
 * Within 10 s is on time. Behind is amber up to a minute, red beyond; ahead is green up to a
 * minute and amber beyond (the show will come up short).
 */
export function driftStatus(drift: number, toleranceSeconds = 10): DriftStatus {
  const d = Math.round(Number(drift) || 0);
  if (Math.abs(d) <= toleranceSeconds) return { kind: 'ON_TIME', level: 'ok', label: 'في الموعد', amount: 0 };
  if (d > 0) return { kind: 'BEHIND', level: d > 60 ? 'alert' : 'warn', label: 'متأخر', amount: d };
  return { kind: 'AHEAD', level: -d > 60 ? 'warn' : 'ok', label: 'متقدم', amount: -d };
}

/** Planned programme length in seconds: the slot when set, otherwise the rundown's total. */
export function programmeSeconds(show: { durationMinutes?: number; rundown?: { durationSeconds?: number }[] } | null | undefined): number {
  if (!show) return 0;
  const slot = (Number(show.durationMinutes) || 0) * 60;
  if (slot > 0) return slot;
  return (show.rundown || []).reduce((sum, s) => sum + (Number(s?.durationSeconds) || 0), 0);
}
