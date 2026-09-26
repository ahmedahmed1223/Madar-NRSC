import React, { useState } from 'react';
import { KeyRound, AlertCircle, Loader2, LogOut } from 'lucide-react';

interface ChangePasswordViewProps {
  forced?: boolean;
  onSubmit: (currentPassword: string, newPassword: string) => Promise<void>;
  onCancel?: () => void;
  onLogout?: () => void;
}

export const ChangePasswordView: React.FC<ChangePasswordViewProps> = ({ forced, onSubmit, onCancel, onLogout }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('تأكيد كلمة المرور غير مطابق');
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit(currentPassword, newPassword);
    } catch (err: any) {
      setError(err?.message || 'تعذر تغيير كلمة المرور');
    } finally {
      setIsSubmitting(false);
    }
  };

  const field = (id: string, label: string, value: string, setter: (v: string) => void, autoComplete: string) => (
    <div>
      <label htmlFor={id} className="block text-xs font-bold text-slate-700 mb-1.5">
        {label}
      </label>
      <input
        id={id}
        type="password"
        required
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => setter(e.target.value)}
        className="w-full text-sm px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 text-left"
        dir="ltr"
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4 font-sans" dir="rtl">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-xl bg-blue-600 flex items-center justify-center">
            <KeyRound className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-slate-900 leading-tight">تغيير كلمة المرور</h1>
            <p className="text-xs text-slate-500">
              {forced ? 'يجب تعيين كلمة مرور جديدة قبل المتابعة' : '10 أحرف على الأقل، تحتوي على حروف وأرقام'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {field('cp-current', 'كلمة المرور الحالية', currentPassword, setCurrentPassword, 'current-password')}
          {field('cp-new', 'كلمة المرور الجديدة', newPassword, setNewPassword, 'new-password')}
          {field('cp-confirm', 'تأكيد كلمة المرور الجديدة', confirmPassword, setConfirmPassword, 'new-password')}

          {error && (
            <div role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition-colors disabled:opacity-60"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>حفظ كلمة المرور</span>
          </button>

          {!forced && onCancel && (
            <button type="button" onClick={onCancel} className="w-full py-2 text-xs font-bold text-slate-500 hover:text-slate-800">
              إلغاء
            </button>
          )}
          {forced && onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-bold text-slate-500 hover:text-slate-800"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>تسجيل الخروج</span>
            </button>
          )}
        </form>
      </div>
    </div>
  );
};
