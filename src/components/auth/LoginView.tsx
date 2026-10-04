import { StationClock } from '../common/StationClock';
import { configureDateFormat } from '../../shared/dateFormat';
import { APP_NAME, APP_TAGLINE } from '../../shared/brand';
import { ThemeToggle } from '../common/ThemeToggle';
import React, { useEffect, useState } from 'react';
import { Radio, Mail, Lock, LogIn, AlertCircle, Loader2, Users, ChevronDown } from 'lucide-react';

interface LoginViewProps {
  onLogin: (email: string, password: string, totp?: string) => Promise<void>;
  notice?: string | null;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLogin, notice }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState('');

  // Demo installations list their real accounts (name, e-mail and role as they are now).
  const [demo, setDemo] = useState<{ password?: string; accounts: { email: string; fullName: string; jobTitle?: string; roleName: string; department?: string }[] } | null>(null);
  const [demoOpen, setDemoOpen] = useState(true);
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    fetch('/api/v1/auth/demo-accounts', { signal: ctrl.signal, headers: { 'X-NRCS-Client': 'web' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.data && setDemo(j.data))
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));
    return () => ctrl.abort();
  }, []);

  // The station's clock and date (its zone and conventions) before anyone signs in.
  useEffect(() => {
    fetch('/api/v1/auth/station', { headers: { 'X-NRCS-Client': 'web' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.data && configureDateFormat(j.data))
      .catch(() => undefined);
  }, []);

  const submit = async (mail: string, pass: string) => {
    setError(null);
    setIsSubmitting(true);
    try {
      await onLogin(mail.trim(), pass, needsCode ? code.trim() : undefined);
    } catch (err: any) {
      if (err?.code === 'TOTP_REQUIRED') {
        setNeedsCode(true);
        setError(null);
      } else {
        setError(
          err?.name === 'TimeoutError' || err?.name === 'AbortError'
            ? 'لم يستجب الخادم في الوقت المناسب؛ تحقق من الاتصال ثم أعد المحاولة'
            : err?.name === 'TypeError'
              ? 'تعذر الاتصال بالخادم؛ تحقق من الشبكة ثم أعد المحاولة'
              : err?.message || 'تعذر تسجيل الدخول'
        );
        if (needsCode) setCode('');
        else setPassword('');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await onLogin(email.trim(), password, needsCode ? code.trim() : undefined);
    } catch (err: any) {
      if (err?.code === 'TOTP_REQUIRED') {
        setNeedsCode(true);
        setError(null);
      } else {
        setError(
          err?.name === 'TimeoutError' || err?.name === 'AbortError'
            ? 'لم يستجب الخادم في الوقت المناسب؛ تحقق من الاتصال ثم أعد المحاولة'
            : err?.name === 'TypeError'
              ? 'تعذر الاتصال بالخادم؛ تحقق من الشبكة ثم أعد المحاولة'
              : err?.message || 'تعذر تسجيل الدخول'
        );
        if (needsCode) setCode('');
        else setPassword('');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-[#0f172a] flex items-center justify-center p-4 font-sans" dir="rtl">
      <ThemeToggle className="absolute top-4 left-4 text-slate-500 hover:text-white hover:bg-white/10" />
      <div className="w-full max-w-sm flex flex-col gap-5">
      <StationClock variant="hero" onDark />
      <div className="w-full bg-white rounded-2xl shadow-xl p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-red-600 flex items-center justify-center">
            <Radio className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-slate-900 leading-tight">{APP_NAME} · {APP_TAGLINE}</h1>
            <p className="text-xs text-slate-500">سجّل الدخول بحسابك المؤسسي</p>
          </div>
        </div>

        {notice && (
          <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 font-semibold">{notice}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-xs font-bold text-slate-700 mb-1.5">
              البريد الإلكتروني
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute right-3 top-3" />
              <input
                id="login-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full text-sm pr-9 pl-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 text-left"
                dir="ltr"
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-password" className="block text-xs font-bold text-slate-700 mb-1.5">
              كلمة المرور
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute right-3 top-3" />
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full text-sm pr-9 pl-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 text-left"
                dir="ltr"
              />
            </div>
          </div>

          {needsCode && (
            <div>
              <label htmlFor="login-totp" className="block text-xs font-bold text-slate-700 mb-1.5">
                رمز التحقق من تطبيق المصادقة
              </label>
              <input
                id="login-totp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="w-full text-lg tracking-[0.5em] text-center px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-mono"
                dir="ltr"
              />
            </div>
          )}

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
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            <span>{isSubmitting ? 'جارٍ الدخول…' : 'تسجيل الدخول'}</span>
          </button>
        </form>

        {demo && demo.accounts.length > 0 && demo.password && (
          <div className="mt-5 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setDemoOpen((v) => !v)}
              aria-expanded={demoOpen}
              className="w-full flex items-center justify-between text-xs font-bold text-slate-700"
            >
              <span className="flex items-center gap-1.5">
                <Users className="w-4 h-4 text-blue-600" /> حسابات التجربة ({demo.accounts.length})
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${demoOpen ? 'rotate-180' : ''}`} />
            </button>
            {demoOpen && (
              <ul className="mt-2 space-y-1 max-h-72 overflow-y-auto" aria-label="حسابات التجربة">
                {demo.accounts.map((a) => (
                  <li key={a.email}>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => {
                        setEmail(a.email);
                        setPassword(demo.password!);
                        void submit(a.email, demo.password!);
                      }}
                      aria-label={`الدخول بحساب ${a.fullName} — ${a.roleName}`}
                      className="w-full text-right p-2 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-60"
                    >
                      <span className="block text-xs font-bold text-slate-800">
                        {a.fullName} <span className="font-normal text-blue-700">— {a.roleName}</span>
                      </span>
                      <span className="block text-[10px] text-slate-500" dir="ltr">
                        {a.email}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[10px] text-slate-500">بيئة تجريبية: تختفي هذه القائمة بعد حذف البيانات التجريبية من الإعدادات.</p>
          </div>
        )}
      </div>
      </div>
    </div>
  );
};
