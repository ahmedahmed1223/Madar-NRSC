import type { WireItem } from '../types/index';

/**
 * Rules for what the monitoring desk adds to «المصادر» besides the agency feeds:
 * manual observations («رصد يدوي»: a TV channel, a platform, a site) and the per-colleague
 * «تمت المتابعة» mark. Shared by the screen and the server policy.
 */
export const MANUAL_SOURCE_ID = 'manual';
export const MANUAL_WIRE_PREFIX = 'wire-manual-';

export const MONITOR_MEDIA: { id: NonNullable<WireItem['medium']>; label: string }[] = [
  { id: 'TV', label: 'قناة تلفزيونية' },
  { id: 'SOCIAL', label: 'منصة تواصل' },
  { id: 'WEB', label: 'موقع إلكتروني' },
  { id: 'OTHER', label: 'أخرى' },
];

const isHttpUrl = (value: string) => {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

/** Reason a manual observation is not acceptable, or null. */
export function manualWireError(w: Partial<WireItem> | null | undefined): string | null {
  if (!w || typeof w.id !== 'string' || !w.id.startsWith(MANUAL_WIRE_PREFIX)) return 'معرّف مادة الرصد غير صالح';
  if (w.manual !== true || w.sourceId !== MANUAL_SOURCE_ID) return 'مادة الرصد اليدوي غير صالحة';
  if (typeof w.sourceName !== 'string' || !w.sourceName.trim() || w.sourceName.length > 120) return 'اكتب اسم القناة أو المنصة (حتى 120 حرفاً)';
  if (typeof w.title !== 'string' || w.title.trim().length < 3 || w.title.length > 300) return 'اكتب ما رصدته في سطر (3 أحرف على الأقل)';
  if (typeof w.summary !== 'string' || w.summary.length > 4000) return 'نص الرصد أطول من المسموح';
  if (w.link !== undefined && w.link !== '' && (typeof w.link !== 'string' || w.link.length > 1000 || !isHttpUrl(w.link))) return 'الرابط يبدأ بـ http أو https';
  if (w.medium !== undefined && !MONITOR_MEDIA.some((m) => m.id === w.medium)) return 'نوع الوسيلة غير معروف';
  if (typeof w.publishedAt !== 'string' || !Number.isFinite(Date.parse(w.publishedAt))) return 'وقت الرصد غير صالح';
  if (Date.parse(w.publishedAt) > Date.now() + 5 * 60_000) return 'وقت الرصد في المستقبل';
  if (!Array.isArray(w.categories) || w.categories.length > 8 || w.categories.some((c) => typeof c !== 'string' || c.length > 60)) return 'التصنيفات غير صالحة';
  if (w.handled !== undefined && (!Array.isArray(w.handled) || w.handled.length)) return 'تبدأ مادة الرصد دون متابعة';
  return null;
}

const strip = (w: any) => {
  const { handled: _h, updatedAt: _u, ...rest } = w || {};
  return rest;
};

/**
 * A colleague may add or remove only their own «تمت المتابعة» mark; nothing else of the item
 * changes (agency text is the agency's).
 */
export function handledChangeError(before: Partial<WireItem> | null | undefined, after: Partial<WireItem> | null | undefined, userId: string): string | null {
  if (!before || !after) return 'المادة غير موجودة';
  if (JSON.stringify(strip(before)) !== JSON.stringify(strip(after))) return 'نص المادة لا يُعدّل؛ تُسجَّل المتابعة فقط';
  const prev = Array.isArray(before.handled) ? before.handled : [];
  const next = Array.isArray(after.handled) ? after.handled : null;
  if (!next || next.length > 500) return 'سجل المتابعة غير صالح';
  const key = (h: { userId: string; at: string }) => `${h.userId}|${h.at}`;
  const prevKeys = new Set(prev.map(key));
  const nextKeys = new Set(next.map(key));
  const added = next.filter((h) => !prevKeys.has(key(h)));
  const removed = prev.filter((h) => !nextKeys.has(key(h)));
  if ([...added, ...removed].some((h) => h.userId !== userId)) return 'تُسجِّل متابعتك أنت فقط';
  if (added.some((h) => typeof h.userName !== 'string' || !h.userName || !Number.isFinite(Date.parse(h.at)))) return 'سجل المتابعة غير صالح';
  if (next.filter((h) => h.userId === userId).length > 1) return 'سُجّلت متابعتك لهذه المادة من قبل';
  return null;
}

export const isHandledBy = (w: Pick<WireItem, 'handled'>, userId: string) => !!w.handled?.some((h) => h.userId === userId);

/** Toggles the user's «تمت المتابعة» mark. */
export function toggleHandled<T extends Pick<WireItem, 'handled'>>(w: T, user: { id: string; fullName: string }, at = new Date().toISOString()): T {
  const list = w.handled || [];
  return isHandledBy(w, user.id)
    ? { ...w, handled: list.filter((h) => h.userId !== user.id) }
    : { ...w, handled: [...list, { userId: user.id, userName: user.fullName, at }] };
}
