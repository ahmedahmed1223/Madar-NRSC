import { bookingStatusOf } from './episodePlan';
export const technicalCheckStatuses = ['NOT_REQUIRED', 'PENDING', 'PASSED', 'FAILED'] as const;
export type TechnicalCheckStatus = typeof technicalCheckStatuses[number];
export function guestFollowUpError(guest: any, users: any[], previous?: any): string | null {
  if (guest.technicalCheckStatus !== undefined && !technicalCheckStatuses.includes(guest.technicalCheckStatus)) return 'حالة الاختبار الفني غير صالحة';
  if (guest.technicalCheckNote !== undefined && (typeof guest.technicalCheckNote !== 'string' || guest.technicalCheckNote.length > 1000)) return 'ملاحظة الاختبار الفني طويلة أو غير صالحة';
  if (guest.technicalCheckAt !== undefined && (typeof guest.technicalCheckAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(guest.technicalCheckAt) || !Number.isFinite(Date.parse(guest.technicalCheckAt)))) return 'موعد الاختبار الفني غير صالح';
  if (guest.technicalCheckAt && new Date(guest.technicalCheckAt).toISOString().slice(0, 19) !== guest.technicalCheckAt.slice(0, 19)) return 'موعد الاختبار الفني غير صالح';
  if (guest.contactOwnerId !== undefined && (typeof guest.contactOwnerId !== 'string' || guest.contactOwnerId.length > 200)) return 'مسؤول التواصل غير صالح';
  if (guest.contactOwnerId && guest.contactOwnerId !== previous?.contactOwnerId && !users.some(u => u.id === guest.contactOwnerId && u.isActive !== false && !u.deletedAt)) return 'مسؤول التواصل غير موجود أو موقوف';
  return null;
}
export function guestFollowUpWarnings(guest: any): string[] {
  const warnings: string[] = [];
  if (['CONTACTED', 'CONFIRMED', 'ARRIVED'].includes(bookingStatusOf(guest)) && !guest.contactOwnerId) warnings.push('لم يحدد مسؤول التواصل');
  if (guest.technicalCheckStatus === 'PENDING') warnings.push('الاختبار الفني بانتظار التنفيذ');
  if (guest.technicalCheckStatus === 'FAILED') warnings.push('الاختبار الفني يحتاج معالجة');
  return warnings;
}
