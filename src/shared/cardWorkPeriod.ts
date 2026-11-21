import { addDaysIso } from './dates';

export const CARD_WORK_PERIODS = [
  { id: 'ALL', label: 'كل الفترات' },
  { id: 'TODAY', label: 'اليوم' },
  { id: 'WEEK', label: 'هذا الأسبوع' },
  { id: 'MONTH', label: 'هذا الشهر' },
  { id: 'UNDATED', label: 'بلا موعد' },
] as const;

export type CardWorkPeriod = (typeof CARD_WORK_PERIODS)[number]['id'];

/** Dates are the station's plain calendar dates. The roster week starts on Saturday. */
export function matchesCardWorkPeriod(period: CardWorkPeriod, today: string, dates: readonly string[]): boolean {
  if (period === 'ALL') return true;
  if (period === 'UNDATED') return dates.length === 0;
  if (period === 'TODAY') return dates.includes(today);
  if (period === 'MONTH') return dates.some(date => date.slice(0, 7) === today.slice(0, 7));
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (!Number.isFinite(weekday)) return false;
  const saturday = addDaysIso(today, -((weekday + 1) % 7));
  const nextSaturday = addDaysIso(saturday, 7);
  return dates.some(date => date >= saturday && date < nextSaturday);
}
