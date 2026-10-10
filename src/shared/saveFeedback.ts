export type SaveState = 'idle' | 'saved' | 'failed';
export function saveFeedback(saving: boolean, state: SaveState, dirty: boolean): string {
  if (saving) return 'جارٍ الحفظ على الخادم...';
  if (state === 'failed') return 'تعذر الحفظ؛ تعديلاتك باقية في المحرر';
  if (dirty) return 'تغييرات غير محفوظة';
  return state === 'saved' ? 'تم الحفظ على الخادم' : 'لا توجد تغييرات غير محفوظة';
}
export function connectionFeedback(browserOnline: boolean, serverOnline: boolean, pending: number): string {
  if (!browserOnline) return `الجهاز دون اتصال${pending > 0 ? `؛ ${pending} تعديل بانتظار تأكيد الخادم` : ''}`;
  if (!serverOnline) return `تعذر الوصول إلى الخادم${pending > 0 ? `؛ ${pending} تعديل بانتظار التأكيد` : ''}`;
  return pending > 0 ? `متصل؛ ${pending} تعديل بانتظار تأكيد الخادم` : 'اتصال المزامنة متاح';
}
