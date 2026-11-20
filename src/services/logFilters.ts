import { localDateString } from '../shared/dates';

export interface LogFilter {
  /** First day included (YYYY-MM-DD, station's or device's calendar); '' for no lower bound. */
  fromDay: string;
  /** Last day included; '' for no upper bound. */
  toDay: string;
  /** Only this colleague's rows; '' or 'ALL' for everyone. */
  userId: string;
}

/** Is an instant inside an inclusive day range (days compared in the zone times are shown in)? */
export function inDayRange(iso: string | undefined, fromDay: string, toDay: string): boolean {
  if (!fromDay && !toDay) return true;
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const day = localDateString(d);
  if (fromDay && day < fromDay) return false;
  if (toDay && day > toDay) return false;
  return true;
}

/** Rows matching the date range and user (newest first); `timeOf`/`userOf` read each row's fields. */
export function filterLogRows<T>(rows: T[], filter: LogFilter, timeOf: (row: T) => string | undefined, userOf: (row: T) => string | undefined): T[] {
  return rows
    .filter((row) => (!filter.userId || filter.userId === 'ALL' || userOf(row) === filter.userId) && inDayRange(timeOf(row), filter.fromDay, filter.toDay))
    .sort((a, b) => (Date.parse(timeOf(b) || '') || 0) - (Date.parse(timeOf(a) || '') || 0));
}

/** The people who appear in the rows, for a «المستخدم» filter (by name, Arabic order). */
export function logUsers<T>(rows: T[], userOf: (row: T) => string | undefined, nameOf: (row: T) => string | undefined): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  rows.forEach((row) => {
    const id = userOf(row);
    if (id && !seen.has(id)) seen.set(id, nameOf(row) || id);
  });
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}
