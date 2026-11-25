import { Eye, EyeOff } from 'lucide-react';
import { MIN_PASSWORD_LENGTH, validatePasswordStrength } from '../../shared/passwords';

export function PasswordVisibilityButton({ visible, onClick, className = '' }: {
  visible: boolean; onClick: () => void; className?: string;
}) {
  const label = visible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور';
  return <button type="button" onClick={onClick} aria-label={label} aria-pressed={visible}
    className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 ${className}`}>
    {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
  </button>;
}

export function PasswordFeedback({ password, confirmation }: { password: string; confirmation?: string }) {
  const checks = [
    { label: `${MIN_PASSWORD_LENGTH} أحرف على الأقل`, ok: password.length >= MIN_PASSWORD_LENGTH },
    { label: 'تحتوي على حروف', ok: /[A-Za-z؀-ۿ]/.test(password) },
    { label: 'تحتوي على أرقام', ok: /\d/.test(password) },
  ];
  const issue = password ? validatePasswordStrength(password) : null;
  const score = checks.filter(item => item.ok).length;
  return <div role="status" aria-live="polite" className="space-y-1 text-xs">
    {password && <>
      <p className={issue ? 'font-semibold text-amber-800' : 'font-semibold text-emerald-800'}>
        {issue ? `قوة كلمة المرور: ${issue}` : 'كلمة المرور تستوفي متطلبات القوة.'}
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-slate-600">
        {checks.map(item => <span key={item.label} className={item.ok ? 'text-emerald-800' : ''}>{item.ok ? '✓' : '○'} {item.label}</span>)}
        <span className="sr-only" role="progressbar" aria-label="مؤشر قوة كلمة المرور" aria-valuemin={0} aria-valuemax={3} aria-valuenow={score}>{score}/3</span>
      </div>
    </>}
    {confirmation !== undefined && password && <p className={confirmation === password ? 'font-semibold text-emerald-800' : 'font-semibold text-rose-700'}>
      {confirmation === password ? 'تأكيد كلمة المرور مطابق.' : confirmation ? 'تأكيد كلمة المرور غير مطابق.' : 'أدخل تأكيد كلمة المرور.'}
    </p>}
  </div>;
}
