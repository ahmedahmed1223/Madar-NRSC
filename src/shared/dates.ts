/**
 * Calendar date (YYYY-MM-DD) in the browser's local time zone.
 * `toISOString().slice(0, 10)` is UTC and lands on the previous day for
 * early-morning hours east of Greenwich (e.g. 00:00–03:00 in Riyadh).
 */
export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Value for an <input type="datetime-local"> in the user's local time ("YYYY-MM-DDTHH:mm"). */
export function toLocalInputValue(value: string | Date = new Date()): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${localDateString(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Converts a datetime-local value (local time) to an ISO timestamp; returns '' when invalid. */
export function fromLocalInputValue(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * "2026-09-27" → "27 سبتمبر 2026". ISO dates read backwards inside Arabic text, so titles
 * and printed documents use this form (with Western digits, as newsrooms do).
 */
export function arabicDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
  if (!m) return date || '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "Asia/Riyadh (GMT+3)" → "Asia/Riyadh" when the runtime knows the zone; otherwise undefined. */
export function stationTimeZone(setting: string | undefined): string | undefined {
  const tz = String(setting || '').split(/[\s(]/)[0];
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
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
