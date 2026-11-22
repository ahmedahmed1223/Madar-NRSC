import { useState, type FormEvent } from 'react';
import { apiFetch } from '../../services/http';
import { MIN_PASSWORD_LENGTH, validatePasswordStrength } from '../../shared/passwords';

const input = 'block mt-1 w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-900 focus:outline-none focus:border-blue-500';

export function FirstAdministratorForm({ saving, onSavingChange, onCreated }: {
  saving: boolean;
  onSavingChange: (saving: boolean) => void;
  onCreated: (email: string, password: string) => void;
}) {
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email')).trim();
    const password = String(form.get('password'));
    const weak = validatePasswordStrength(password);
    if (weak || form.get('confirmation') !== password) {
      setError(weak || 'تأكيد كلمة المرور غير مطابق');
      return;
    }
    onSavingChange(true);
    setError('');
    try {
      await apiFetch('/api/v1/auth/setup/administrator', {
        method: 'POST',
        signal: AbortSignal.timeout(20_000),
        json: { fullName: form.get('fullName'), email, token: form.get('token'), password },
      });
    } catch (err) {
      onSavingChange(false);
      setError(err instanceof Error && !['AbortError', 'TimeoutError', 'TypeError'].includes(err.name)
        ? err.message
        : 'تعذر التحقق من إنشاء الحساب. تحقّق من الاتصال ثم جرّب تسجيل الدخول بالبريد وكلمة المرور اللذين اخترتهما.');
      return;
    }
    onCreated(email, password);
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-sm">
      <label className="block font-semibold">اسم المسؤول<input name="fullName" required maxLength={120} autoComplete="name" className={input} /></label>
      <label className="block font-semibold">بريد المسؤول<input name="email" type="email" required maxLength={254} autoComplete="username" dir="ltr" className={input} /></label>
      <label className="block font-semibold">رمز إعداد الخادم<input name="token" type="password" required maxLength={200} autoComplete="off" dir="ltr" className={input} /></label>
      <label className="block font-semibold">كلمة المرور<input name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} maxLength={200} autoComplete="new-password" aria-describedby="first-admin-password-hint" dir="ltr" className={input} /></label>
      <p id="first-admin-password-hint" className="text-xs text-slate-600">استخدم 10 أحرف على الأقل، على أن تتضمن حروفاً وأرقاماً.</p>
      <label className="block font-semibold">تأكيد كلمة المرور<input name="confirmation" type="password" required maxLength={200} autoComplete="new-password" dir="ltr" className={input} /></label>
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800">{error}</p>}
      <button type="submit" disabled={saving} className="w-full min-h-11 rounded-xl bg-blue-600 px-3 font-bold text-white hover:bg-blue-700 disabled:opacity-60">
        {saving ? 'جارٍ إنشاء الحساب…' : 'إنشاء الحساب والمتابعة'}
      </button>
    </form>
  );
}
