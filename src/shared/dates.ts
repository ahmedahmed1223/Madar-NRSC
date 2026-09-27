import { basisZone, formatDay, validZone } from './dateFormat';
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Wall-clock parts of an instant in a zone (the device's when no zone is given). */
function wallParts(d: Date, zone?: string) {
  if (!zone) return { y: d.getFullYear(), mo: d.getMonth() + 1, day: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
  const shifted = new Date(d.getTime() + zoneOffsetMinutes(zone, d) * 60_000);
  return { y: shifted.getUTCFullYear(), mo: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), h: shifted.getUTCHours(), mi: shifted.getUTCMinutes() };
}

/**
 * Today's date (YYYY-MM-DD), or the day of an instant: in the station's zone when the
 * station uses unified time, otherwise the device's. (`toISOString().slice(0, 10)` is UTC and
 * lands on the previous day for early-morning hours east of Greenwich.)
 */
export function localDateString(d: Date = new Date()): string {
  const p = wallParts(d, basisZone());
  return `${p.y}-${pad2(p.mo)}-${pad2(p.day)}`;
}

/** Calendar arithmetic on a plain day: "2026-09-30" + 2 → "2026-10-02" (no zone involved). */
export function addDaysIso(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** Value for an <input type="datetime-local"> ("YYYY-MM-DDTHH:mm") in the station's or device's time. */
export function toLocalInputValue(value: string | Date = new Date()): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  const p = wallParts(d, basisZone());
  return `${p.y}-${pad2(p.mo)}-${pad2(p.day)}T${pad2(p.h)}:${pad2(p.mi)}`;
}

/** Converts a datetime-local value (station's or device's time) to an ISO timestamp; '' when invalid. */
export function fromLocalInputValue(value: string): string {
  const zone = basisZone();
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  if (!zone || !m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // The zone's offset at that moment (checked twice for daylight-saving edges).
  let t = asUtc - zoneOffsetMinutes(zone, new Date(asUtc)) * 60_000;
  t = asUtc - zoneOffsetMinutes(zone, new Date(t)) * 60_000;
  return new Date(t).toISOString();
}

/**
 * "2026-09-27" → "27 سبتمبر 2026" (or the colleague's chosen style, digits and calendar).
 * ISO dates read backwards inside Arabic text, so titles and printed documents use this form.
 */
export function arabicDate(date: string): string {
  return formatDay(date);
}

/** "Asia/Riyadh (GMT+3)" → "Asia/Riyadh" when the runtime knows the zone; otherwise undefined. */
export function stationTimeZone(setting: string | undefined): string | undefined {
  return validZone(setting);
}

/** Minutes east of UTC for a time zone at an instant (e.g. 180 for Riyadh). */
export function zoneOffsetMinutes(timeZone: string, at = new Date()): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** Does this device's clock run in a different zone than the station (right now)? */
export function deviceDiffersFromStation(stationTz: string | undefined, at = new Date()): boolean {
  if (!stationTz) return false;
  return zoneOffsetMinutes(stationTz, at) !== -at.getTimezoneOffset();
}
