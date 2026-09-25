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
