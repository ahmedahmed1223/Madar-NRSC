/**
 * Forward planning: the news diary (agenda of upcoming events and coverage decisions) and
 * resource booking (studios, cameras, live units, edit suites, crews) with clash detection.
 * Shared by the server policies and the planning screens.
 */

// ---------- planning diary ----------

export const DIARY_KINDS = [
  { id: 'EVENT', name: 'حدث / فعالية' },
  { id: 'PRESSER', name: 'مؤتمر صحفي' },
  { id: 'SESSION', name: 'جلسة / اجتماع رسمي' },
  { id: 'VISIT', name: 'زيارة رسمية' },
  { id: 'VERDICT', name: 'جلسة محكمة / حكم' },
  { id: 'ELECTION', name: 'انتخابات / تصويت' },
  { id: 'SPORTS', name: 'حدث رياضي' },
  { id: 'ANNIVERSARY', name: 'ذكرى / مناسبة' },
  { id: 'RELEASE', name: 'صدور تقرير / بيانات' },
  { id: 'OTHER', name: 'أخرى' },
] as const;
export type DiaryKind = (typeof DIARY_KINDS)[number]['id'];

export const COVERAGE_DECISIONS = [
  { id: 'UNDECIDED', name: 'لم يُحسم', tone: 'bg-slate-100 text-slate-600 border-slate-200' },
  { id: 'COVER', name: 'تغطية ميدانية', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { id: 'LIVE', name: 'تغطية مباشرة (بث حي)', tone: 'bg-red-50 text-red-700 border-red-200' },
  { id: 'DESK', name: 'متابعة من الديسك', tone: 'bg-blue-50 text-blue-700 border-blue-200' },
  { id: 'SKIP', name: 'لا تغطية', tone: 'bg-slate-50 text-slate-400 border-slate-200 line-through' },
] as const;
export type CoverageDecision = (typeof COVERAGE_DECISIONS)[number]['id'];

export const diaryKindName = (id: string | undefined) => DIARY_KINDS.find((k) => k.id === id)?.name || 'حدث';
export const coverageOf = (id: string | undefined) => COVERAGE_DECISIONS.find((c) => c.id === id) || COVERAGE_DECISIONS[0];

export interface DiaryEntry {
  id: string;
  title: string;
  /** Local day YYYY-MM-DD. */
  date: string;
  /** Local HH:MM; empty for all-day entries. */
  startTime?: string;
  endTime?: string;
  kind: DiaryKind;
  coverage: CoverageDecision;
  priority: 'NORMAL' | 'HIGH';
  location?: string;
  categoryId?: string;
  notes?: string;
  /** Who covers it (editors, reporters, crew). */
  assigneeIds: string[];
  /** Linked coverage story and the news items produced from this entry. */
  storyId?: string;
  newsIds?: string[];
  createdById?: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function diaryError(e: any): string | null {
  if (!e || typeof e !== 'object') return 'حدث غير صالح';
  if (typeof e.title !== 'string' || !e.title.trim() || e.title.length > 300) return 'عنوان الحدث مطلوب (حتى 300 حرف)';
  if (typeof e.date !== 'string' || !DAY.test(e.date) || Number.isNaN(Date.parse(e.date))) return 'تاريخ الحدث غير صالح';
  for (const k of ['startTime', 'endTime']) if (e[k] && !HHMM.test(e[k])) return 'الوقت بصيغة HH:MM';
  if (e.startTime && e.endTime && e.endTime <= e.startTime) return 'ينتهي الحدث بعد بدايته';
  if (!DIARY_KINDS.some((k) => k.id === e.kind)) return 'نوع الحدث غير معروف';
  if (!COVERAGE_DECISIONS.some((c) => c.id === e.coverage)) return 'قرار التغطية غير معروف';
  if (e.priority !== 'NORMAL' && e.priority !== 'HIGH') return 'الأولوية غير صالحة';
  if (!Array.isArray(e.assigneeIds) || e.assigneeIds.length > 30 || e.assigneeIds.some((x: unknown) => typeof x !== 'string')) return 'قائمة المكلفين غير صالحة';
  if (e.notes && (typeof e.notes !== 'string' || e.notes.length > 5000)) return 'الملاحظات طويلة جداً';
  if (e.location && (typeof e.location !== 'string' || e.location.length > 200)) return 'المكان طويل جداً';
  if (e.newsIds && (!Array.isArray(e.newsIds) || e.newsIds.length > 50)) return 'روابط الأخبار غير صالحة';
  return null;
}

export const sortDiary = <T extends Pick<DiaryEntry, 'date' | 'startTime' | 'title'>>(list: T[]) =>
  [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || '') || a.title.localeCompare(b.title, 'ar'));

/** The seven local days (Saturday-first weeks are common in Arab newsrooms) that contain `day`. */
export function weekDays(day: string, weekStartsOn = 6): string[] {
  const [y, m, d] = day.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  const back = (base.getDay() - weekStartsOn + 7) % 7;
  return Array.from({ length: 7 }, (_, i) => {
    const t = new Date(y, m - 1, d - back + i);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  });
}

export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(y, m - 1, d + delta);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

// ---------- resources & bookings ----------

export const RESOURCE_KINDS = [
  { id: 'STUDIO', name: 'استوديو' },
  { id: 'CAMERA', name: 'كاميرا' },
  { id: 'LIVE_UNIT', name: 'وحدة بث (SNG / LiveU)' },
  { id: 'EDIT_SUITE', name: 'غرفة مونتاج' },
  { id: 'CREW', name: 'طاقم تصوير' },
  { id: 'VEHICLE', name: 'سيارة' },
  { id: 'OTHER', name: 'أخرى' },
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number]['id'];
export const resourceKindName = (id: string | undefined) => RESOURCE_KINDS.find((k) => k.id === id)?.name || 'مورد';

export interface Resource {
  id: string;
  name: string;
  kind: ResourceKind;
  location?: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export const BOOKING_STATUSES = [
  { id: 'TENTATIVE', name: 'مبدئي', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  { id: 'CONFIRMED', name: 'مؤكد', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { id: 'CANCELLED', name: 'ملغى', tone: 'bg-slate-50 text-slate-400 border-slate-200' },
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number]['id'];
export const bookingStatusOf = (id: string | undefined) => BOOKING_STATUSES.find((s) => s.id === id) || BOOKING_STATUSES[0];

export interface BookingLink {
  kind: 'episode' | 'diary' | 'bulletin' | 'news';
  id: string;
  title: string;
}

export interface Booking {
  id: string;
  resourceId: string;
  title: string;
  /** ISO instants. */
  start: string;
  end: string;
  status: BookingStatus;
  /** Who uses the resource (defaults to whoever booked it). */
  assigneeId?: string;
  link?: BookingLink;
  notes?: string;
  bookedById?: string;
  bookedByName?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export const MAX_BOOKING_HOURS = 24 * 7;

export function bookingError(b: any): string | null {
  if (!b || typeof b !== 'object') return 'حجز غير صالح';
  if (typeof b.resourceId !== 'string' || !b.resourceId) return 'اختر المورد المطلوب حجزه';
  if (typeof b.title !== 'string' || !b.title.trim() || b.title.length > 200) return 'اكتب الغرض من الحجز (حتى 200 حرف)';
  const start = Date.parse(b.start);
  const end = Date.parse(b.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'وقت البداية والنهاية مطلوبان';
  if (end <= start) return 'ينتهي الحجز بعد بدايته';
  if (end - start > MAX_BOOKING_HOURS * 3600_000) return 'مدة الحجز الواحد أسبوع كحد أقصى';
  if (!BOOKING_STATUSES.some((s) => s.id === b.status)) return 'حالة الحجز غير معروفة';
  if (b.link && (typeof b.link !== 'object' || !['episode', 'diary', 'bulletin', 'news'].includes(b.link.kind) || typeof b.link.id !== 'string')) return 'ربط الحجز غير صالح';
  if (b.notes && (typeof b.notes !== 'string' || b.notes.length > 2000)) return 'الملاحظات طويلة جداً';
  return null;
}

const isLive = (b: Pick<Booking, 'status' | 'deletedAt'>) => !b.deletedAt && b.status !== 'CANCELLED';

export const bookingsOverlap = (a: Pick<Booking, 'start' | 'end'>, b: Pick<Booking, 'start' | 'end'>) =>
  Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);

/** Other live bookings of the same resource that overlap this one. */
export function bookingConflicts<T extends Booking>(booking: Pick<Booking, 'id' | 'resourceId' | 'start' | 'end' | 'status' | 'deletedAt'>, all: T[]): T[] {
  if (!isLive(booking)) return [];
  return all.filter((o) => o.id !== booking.id && o.resourceId === booking.resourceId && isLive(o) && bookingsOverlap(booking, o));
}

/** Bookings that touch a local day (for the day timeline). */
export function bookingsOnDay<T extends Booking>(all: T[], day: string): T[] {
  const [y, m, d] = day.split('-').map(Number);
  const from = new Date(y, m - 1, d).getTime();
  const to = new Date(y, m - 1, d + 1).getTime();
  return all.filter((b) => !b.deletedAt && Date.parse(b.start) < to && Date.parse(b.end) > from);
}
