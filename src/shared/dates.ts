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
