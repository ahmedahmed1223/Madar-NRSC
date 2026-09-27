/**
 * Notification categories and each colleague's delivery preferences (in-app bell, e-mail,
 * phone/desktop push), plus the rules that decide when an agency wire is worth an alert.
 * Shared by the server (writers + delivery worker) and the preferences page.
 */
import { normalizeArabic } from './search';

export const NOTIFICATION_CATEGORIES = [
  { id: 'assignment', name: 'التكليفات والمهام', hint: 'مهمة أو تغطية أو حجز مسند إليك' },
  { id: 'request', name: 'طلبات الأقسام', hint: 'طلب جديد لقسمك أو تغيّر حالة طلبك' },
  { id: 'mention', name: 'الإشارات والتعليقات', hint: 'أشار إليك زميل أو علّق على مادتك' },
  { id: 'news', name: 'سير عمل الأخبار', hint: 'إعادة خبرك للتعديل أو اعتماده' },
  { id: 'bulletin', name: 'النشرات', hint: 'قصة جاهزة للاعتماد أو أعيدت إليك' },
  { id: 'wire', name: 'البرقيات العاجلة وكلمات المتابعة', hint: 'برقية عاجلة أو تحوي كلمة تتابعها' },
  { id: 'booking', name: 'حجز الموارد', hint: 'حجز استوديو أو كاميرا أو طاقم باسمك' },
  { id: 'diary', name: 'أجندة التغطية', hint: 'حدث في الأجندة أسند إليك أو تغيّر موعده' },
  { id: 'system', name: 'تنبيهات عامة', hint: 'رسائل الإدارة والنظام' },
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]['id'];
export const NOTIFICATION_CATEGORY_IDS = NOTIFICATION_CATEGORIES.map((c) => c.id) as NotificationCategory[];
export const isNotificationCategory = (v: unknown): v is NotificationCategory => NOTIFICATION_CATEGORY_IDS.includes(v as NotificationCategory);
export const categoryName = (id: string | undefined) => NOTIFICATION_CATEGORIES.find((c) => c.id === id)?.name || 'تنبيه';

export type DeliveryChannel = 'email' | 'push';

export interface NotificationPrefs {
  /** Same as the user id: one row per colleague. */
  id: string;
  userId: string;
  channels: Partial<Record<NotificationCategory, { email?: boolean; push?: boolean }>>;
  /** Words or names to watch for in incoming agency wires. */
  watchWords: string[];
  /** Alert me when an agency sends an urgent/flash wire. */
  flashAlerts: boolean;
  /** Quiet hours (local HH:MM) when e-mail/push wait; urgent items still go through. */
  quietFrom?: string;
  quietTo?: string;
  updatedAt?: string;
}

/** Sensible defaults: push for what needs you now, e-mail only for assignments. */
export const DEFAULT_CHANNELS: Record<NotificationCategory, { email: boolean; push: boolean }> = {
  assignment: { email: true, push: true },
  request: { email: false, push: true },
  mention: { email: false, push: true },
  news: { email: false, push: true },
  bulletin: { email: false, push: true },
  wire: { email: false, push: true },
  booking: { email: true, push: true },
  diary: { email: true, push: true },
  system: { email: false, push: false },
};

export function defaultPrefs(userId: string): NotificationPrefs {
  return { id: userId, userId, channels: {}, watchWords: [], flashAlerts: false };
}

export function wantsDelivery(prefs: NotificationPrefs | undefined, category: string | undefined, channel: DeliveryChannel): boolean {
  const cat: NotificationCategory = isNotificationCategory(category) ? category : 'system';
  const own = prefs?.channels?.[cat]?.[channel];
  return typeof own === 'boolean' ? own : DEFAULT_CHANNELS[cat][channel];
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** True inside the colleague's quiet hours (the range may wrap past midnight). */
export function inQuietHours(prefs: NotificationPrefs | undefined, localMinutes: number): boolean {
  if (!prefs?.quietFrom || !prefs.quietTo || !HHMM.test(prefs.quietFrom) || !HHMM.test(prefs.quietTo)) return false;
  const from = minutesOf(prefs.quietFrom);
  const to = minutesOf(prefs.quietTo);
  if (from === to) return false;
  return from < to ? localMinutes >= from && localMinutes < to : localMinutes >= from || localMinutes < to;
}

export const MAX_WATCH_WORDS = 30;

export function prefsError(p: any, userId: string): string | null {
  if (!p || typeof p !== 'object') return 'إعدادات غير صالحة';
  if (p.id !== userId || p.userId !== userId) return 'يعدّل كل زميل إعدادات تنبيهاته فقط';
  if (p.channels && typeof p.channels !== 'object') return 'قنوات التنبيه غير صالحة';
  for (const [key, value] of Object.entries(p.channels || {})) {
    if (!isNotificationCategory(key)) return `نوع تنبيه غير معروف: ${key}`;
    const v = value as any;
    if (!v || typeof v !== 'object' || ['email', 'push'].some((c) => v[c] !== undefined && typeof v[c] !== 'boolean')) return 'قنوات التنبيه غير صالحة';
  }
  if (!Array.isArray(p.watchWords) || p.watchWords.length > MAX_WATCH_WORDS) return `كلمات المتابعة قائمة بحد أقصى ${MAX_WATCH_WORDS} كلمة`;
  if (p.watchWords.some((w: unknown) => typeof w !== 'string' || !w.trim() || w.length > 60)) return 'كل كلمة متابعة نص قصير (حتى 60 حرفاً)';
  if (typeof p.flashAlerts !== 'boolean') return 'خيار البرقيات العاجلة غير صالح';
  for (const k of ['quietFrom', 'quietTo']) if (p[k] !== undefined && p[k] !== '' && !HHMM.test(p[k])) return 'ساعات الهدوء بصيغة HH:MM';
  return null;
}

// ---------- agency wire alerts ----------

/** Agency markers for urgent copy (Arabic and English desks). */
const FLASH_PATTERN = /(^|[\s\-—:|(«"'])(عاجل|عــاجل|خبر عاجل|هام جداً|هام جدا|urgent|flash|breaking)(?=$|[\s\-—:|)»"'!.,،])/i;

export function isFlashWire(wire: { title?: string; categories?: string[] }): boolean {
  if (FLASH_PATTERN.test(` ${wire.title || ''} `)) return true;
  return (wire.categories || []).some((c) => /^(عاجل|urgent|flash|breaking)$/i.test(c.trim()));
}

/** The watch words that appear in the wire (Arabic-normalised, whole-phrase match). */
export function watchWordHits(text: string, words: string[]): string[] {
  const hay = ` ${normalizeArabic(text).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return words.filter((w) => {
    const needle = normalizeArabic(w).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (!needle) return false;
    // Arabic attaches prefixes: a conjunction (و/ف), a preposition (ب/ل/ك) and the article (ال/لل).
    const stem = needle.startsWith('ال') && needle.length > 3 ? needle.slice(2) : needle;
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return hay.includes(` ${needle} `) || new RegExp(` (?:[وف])?(?:[بلك])?(?:ال|ل)?${escaped} `).test(hay);
  });
}

/** Wires older than this when first seen are history, not alerts. */
export const WIRE_ALERT_MAX_AGE_MS = 30 * 60 * 1000;
