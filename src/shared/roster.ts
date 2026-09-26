import { isDepartmentId } from './departments';

export const SHIFTS = [
  { id: 'MORNING', name: 'الصباحية', start: '06:00', end: '14:00' },
  { id: 'EVENING', name: 'المسائية', start: '14:00', end: '22:00' },
  { id: 'NIGHT', name: 'الليلية', start: '22:00', end: '06:00' },
] as const;

export type ShiftId = (typeof SHIFTS)[number]['id'];

export interface RosterEntry {
  id: string;
  date: string; // YYYY-MM-DD (the day the shift starts)
  departmentId: string;
  shift: ShiftId;
  userId: string;
  userName: string;
  /** Shift lead / point of contact for the department. */
  isLead?: boolean;
  notes?: string;
  createdBy?: string;
}

export const rosterEntryId = (e: Pick<RosterEntry, 'date' | 'departmentId' | 'shift' | 'userId'>) =>
  `${e.date}:${e.departmentId}:${e.shift}:${e.userId}`;

export const shiftName = (id: string) => SHIFTS.find((s) => s.id === id)?.name || id;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validation shared by the browser and the server; returns an error message or null. */
export function rosterEntryError(e: any): string | null {
  if (!e || typeof e !== 'object') return 'بيانات المناوبة غير صالحة';
  if (!DATE_RE.test(e.date || '')) return 'تاريخ المناوبة غير صالح';
  if (!isDepartmentId(e.departmentId)) return 'القسم غير معروف';
  if (!SHIFTS.some((s) => s.id === e.shift)) return 'الوردية غير معروفة';
  if (typeof e.userId !== 'string' || !e.userId) return 'يجب اختيار الموظف';
  if (e.id !== rosterEntryId(e)) return 'معرّف المناوبة غير متطابق';
  return null;
}

const toLocal = (date: string, hhmm: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, h, min).getTime();
};

/** Start and end of a roster entry's shift in local time (night shifts end the next morning). */
export function shiftWindow(date: string, shift: string): { start: number; end: number } | null {
  const def = SHIFTS.find((s) => s.id === shift);
  if (!def || !DATE_RE.test(date)) return null;
  const start = toLocal(date, def.start);
  let end = toLocal(date, def.end);
  if (end <= start) end += 24 * 60 * 60 * 1000;
  return { start, end };
}

/** Entries on duty at `now`, optionally for one department (leads first). */
export function onDutyAt<T extends RosterEntry>(entries: T[], now = Date.now(), departmentId?: string): T[] {
  return entries
    .filter((e) => (!departmentId || e.departmentId === departmentId) && !(e as any).deletedAt)
    .filter((e) => {
      const w = shiftWindow(e.date, e.shift);
      return !!w && now >= w.start && now < w.end;
    })
    .sort((a, b) => Number(!!b.isLead) - Number(!!a.isLead));
}

/** The shift running at `now` and the calendar day it belongs to. */
export function currentShift(now = new Date()): { date: string; shift: ShiftId } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const h = now.getHours();
  if (h >= 6 && h < 14) return { date: day(now), shift: 'MORNING' };
  if (h >= 14 && h < 22) return { date: day(now), shift: 'EVENING' };
  const start = new Date(now);
  if (h < 6) start.setDate(start.getDate() - 1);
  return { date: day(start), shift: 'NIGHT' };
}
