import { countLabel } from './arabicPlural';

export type SaveState = 'idle' | 'saved' | 'failed';
export function saveFeedback(saving: boolean, state: SaveState, dirty: boolean): string {
  if (saving) return 'جارٍ الحفظ على الخادم...';
  if (state === 'failed') return 'تعذر الحفظ؛ تعديلاتك باقية في المحرر';
  if (dirty) return 'تغييرات غير محفوظة';
  return state === 'saved' ? 'تم الحفظ على الخادم' : 'لا توجد تغييرات غير محفوظة';
}
const CHANGES = { one: 'تغيير واحد', two: 'تغييران', few: 'تغييرات', many: 'تغييراً' };

/** «3 تغييرات», «تغيير واحد», «تغييران»… */
export function changesLabel(pending: number): string {
  return countLabel(pending, CHANGES);
}

/**
 * One calm line about the connection. Changes waiting to be sent are kept on this device and go
 * out automatically; it never claims every field on screen is stored.
 */
export function connectionFeedback(browserOnline: boolean, serverOnline: boolean, pending: number): string {
  if (!browserOnline) return pending > 0 ? `غير متصل — ${changesLabel(pending)} بانتظار الإرسال` : 'غير متصل — ما تحفظه يبقى على جهازك حتى يعود الاتصال';
  if (!serverOnline) return pending > 0 ? `تعذر الوصول إلى الخادم — ${changesLabel(pending)} بانتظار الإرسال` : 'تعذر الوصول إلى الخادم — نعيد المحاولة تلقائياً';
  return pending > 0 ? `جارٍ إرسال ${changesLabel(pending)}…` : 'متصل';
}
