/**
 * Arabic messages for the browser's built-in form validation ("Please fill out this field"
 * otherwise appears in the browser's language), plus aria-invalid on the offending field.
 */

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export function validationMessage(el: Field): string {
  const v = el.validity;
  const input = el as HTMLInputElement;
  if (v.valueMissing) {
    if (el instanceof HTMLSelectElement) return 'اختر قيمة من القائمة.';
    if (input.type === 'checkbox') return 'يلزم تحديد هذا الخيار للمتابعة.';
    if (input.type === 'radio') return 'اختر أحد الخيارات.';
    if (input.type === 'file') return 'اختر ملفاً.';
    return 'هذا الحقل مطلوب.';
  }
  if (v.typeMismatch) {
    if (input.type === 'email') return 'أدخل بريداً إلكترونياً صحيحاً، مثل name@example.com.';
    if (input.type === 'url') return 'أدخل رابطاً كاملاً يبدأ بـ https://';
    return 'القيمة المدخلة غير صحيحة.';
  }
  if (v.tooShort) return `أدخل ${input.minLength} أحرف على الأقل (الحالي ${input.value.length}).`;
  if (v.tooLong) return `الحد الأقصى ${input.maxLength} حرفاً.`;
  if (v.rangeUnderflow) return `القيمة يجب ألا تقل عن ${input.min}.`;
  if (v.rangeOverflow) return `القيمة يجب ألا تزيد عن ${input.max}.`;
  if (v.stepMismatch) return 'القيمة غير مسموح بها لهذا الحقل.';
  if (v.badInput) return input.type === 'number' ? 'أدخل رقماً صحيحاً.' : 'القيمة المدخلة غير مكتملة.';
  if (v.patternMismatch) return input.title || 'صيغة القيمة غير صحيحة.';
  return '';
}

const isField = (t: EventTarget | null): t is Field =>
  t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;

export function installArabicValidation(doc: Document = document) {
  doc.addEventListener(
    'invalid',
    (e) => {
      if (!isField(e.target)) return;
      const el = e.target;
      // Keep a message a component set on purpose; replace only the browser's own.
      if (el.validity.customError && el.dataset.arValidity !== '1') return;
      el.setCustomValidity('');
      const msg = validationMessage(el);
      if (msg) {
        el.setCustomValidity(msg);
        el.dataset.arValidity = '1';
      }
      el.setAttribute('aria-invalid', 'true');
    },
    true
  );
  const clear = (e: Event) => {
    if (!isField(e.target)) return;
    const el = e.target;
    if (el.dataset.arValidity === '1') {
      el.setCustomValidity('');
      delete el.dataset.arValidity;
    }
    if (el.getAttribute('aria-invalid') === 'true' && el.checkValidity()) el.removeAttribute('aria-invalid');
  };
  doc.addEventListener('input', clear, true);
  doc.addEventListener('change', clear, true);
}
