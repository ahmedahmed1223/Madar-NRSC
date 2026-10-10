import { validZone } from './dateFormat';
import type { WorkSectionPreferences } from './workContext';

export function stationWorkDay(now: Date, timezone: string | undefined): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: validZone(timezone), calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function stationWorkTime(now: Date, timezone: string | undefined): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: validZone(timezone), numberingSystem: 'latn', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}
export function orderWorkSections(keys: string[], preferences: WorkSectionPreferences): string[] {
  return [...new Set([...preferences.order.filter(key => keys.includes(key)), ...keys])];
}
