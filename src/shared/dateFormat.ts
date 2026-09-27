/**
 * Station-wide date and time conventions (Settings → التاريخ والوقت, administrators only).
 * They live in the shared `settings` record on the server, so every colleague, screen and
 * printout uses the same digits, calendar, clock and, optionally, the station's time zone.
 * The app calls `configureDateFormat` whenever the settings load or change.
 */

export type Digits = 'latn' | 'arab';
export type Calendar = 'gregory' | 'islamic-umalqura';
export type HourCycle = 'h23' | 'h12';
export type DateStyle = 'long' | 'numeric';
/** 'station': times are shown and entered in the station's zone on every device. */
export type TimeBasis = 'station' | 'device';

export interface DateTimeSettings {
  digits: Digits;
  calendar: Calendar;
  hourCycle: HourCycle;
  /** «27 سبتمبر 2026» or «27/09/2026». */
  dateStyle: DateStyle;
  /** Seconds on the top-bar clock. */
  clockSeconds: boolean;
  timeBasis: TimeBasis;
}

export const DEFAULT_DATE_SETTINGS: DateTimeSettings = {
  digits: 'latn',
  calendar: 'gregory',
  hourCycle: 'h23',
  dateStyle: 'long',
  clockSeconds: true,
  timeBasis: 'device',
};

export const DATE_FORMAT_EVENT = 'nrcs-date-format';

export function sanitizeDateSettings(raw: any): DateTimeSettings {
  const p = { ...DEFAULT_DATE_SETTINGS };
  if (raw && typeof raw === 'object') {
    if (raw.digits === 'latn' || raw.digits === 'arab') p.digits = raw.digits;
    if (raw.calendar === 'gregory' || raw.calendar === 'islamic-umalqura') p.calendar = raw.calendar;
    if (raw.hourCycle === 'h23' || raw.hourCycle === 'h12') p.hourCycle = raw.hourCycle;
    if (raw.dateStyle === 'long' || raw.dateStyle === 'numeric') p.dateStyle = raw.dateStyle;
    if (typeof raw.clockSeconds === 'boolean') p.clockSeconds = raw.clockSeconds;
    if (raw.timeBasis === 'station' || raw.timeBasis === 'device') p.timeBasis = raw.timeBasis;
  }
  return p;
}

/** A valid IANA zone from the station setting ("Asia/Riyadh (GMT+3)" → "Asia/Riyadh"). */
export function validZone(setting: string | undefined): string | undefined {
  const tz = String(setting || '').split(/[\s(]/)[0];
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

let current: DateTimeSettings = { ...DEFAULT_DATE_SETTINGS };
let stationZone: string | undefined;
let signature = '';

/** Applies the station settings; tells the interface to redraw when something changed. */
export function configureDateFormat(settings: { dateTime?: unknown; defaultTimezone?: string } | null | undefined) {
  const next = sanitizeDateSettings(settings?.dateTime);
  const zone = validZone(settings?.defaultTimezone);
  const sig = JSON.stringify([next, zone]);
  if (sig === signature) return;
  signature = sig;
  current = next;
  stationZone = zone;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(DATE_FORMAT_EVENT));
}

export function getDateSettings(): DateTimeSettings {
  return current;
}

export function onDateFormat(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(DATE_FORMAT_EVENT, listener);
  return () => window.removeEventListener(DATE_FORMAT_EVENT, listener);
}

/** The zone times are shown and entered in: the station's (unified time) or undefined (device). */
export function basisZone(settings: DateTimeSettings = current): string | undefined {
  return settings.timeBasis === 'station' ? stationZone : undefined;
}

/** Locale for every Intl/toLocale* call: Arabic with the station's digits, calendar and clock. */
export function appLocale(settings: DateTimeSettings = current): string {
  return `ar-EG-u-ca-${settings.calendar}-hc-${settings.hourCycle}-nu-${settings.digits}`;
}

/** Options to spread into toLocale* calls so instants are shown in the basis zone. */
export function zoneOptions(settings: DateTimeSettings = current): { timeZone?: string } {
  const tz = basisZone(settings);
  return tz ? { timeZone: tz } : {};
}

/** A calendar day ("2026-09-27", no time) in the station's style and calendar. */
export function formatDay(isoDay: string | Date, settings: DateTimeSettings = current): string {
  let d: Date;
  if (isoDay instanceof Date) {
    // An instant: the day it is in the basis zone.
    return isoDay.toLocaleDateString(appLocale(settings), { ...zoneOptions(settings), ...dayOptions(settings) });
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay || '');
  if (!m) return isoDay || '';
  // A plain day: format noon UTC in UTC so no zone can move it to the day before or after.
  d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return d.toLocaleDateString(appLocale(settings), { timeZone: 'UTC', ...dayOptions(settings) });
}

function dayOptions(settings: DateTimeSettings): Intl.DateTimeFormatOptions {
  return settings.dateStyle === 'numeric' ? { day: '2-digit', month: '2-digit', year: 'numeric' } : { day: 'numeric', month: 'long', year: 'numeric' };
}
