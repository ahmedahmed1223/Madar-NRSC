import { StationClock } from '../common/StationClock';
import { configureDateFormat } from '../../shared/dateFormat';
import { APP_NAME, APP_TAGLINE } from '../../shared/brand';
import type { LoginSetupMode } from '../../shared/setup';
import { apiFetch } from '../../services/http';
import { ThemeToggle } from '../common/ThemeToggle';
import { FirstAdministratorForm } from './FirstAdministratorForm';
import React, { useEffect, useState } from 'react';
import { Radio, Mail, Lock, LogIn, AlertCircle, Loader2, Users, ChevronDown, Settings2 } from 'lucide-react';
import { PasswordVisibilityButton } from './PasswordFields';

interface LoginViewProps {
  onLogin: (email: string, password: string, totp?: string) => Promise<void>;
  notice?: string | null;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLogin, notice }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState('');
  const [setupMode, setSetupMode] = useState<LoginSetupMode>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [savingAdministrator, setSavingAdministrator] = useState(false);
  const [administratorCreated, setAdministratorCreated] = useState(false);
  const creatingAdministrator = setupOpen && setupMode === 'browser';

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    apiFetch<{ data?: { mode: LoginSetupMode } }>('/api/v1/auth/setup', { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setSetupMode(result?.data?.mode ?? null); })
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, []);

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

  const submit = async (mail: string, pass: string, totp?: string) => {
    setError(null);
    setIsSubmitting(true);
    try {
      await onLogin(mail.trim(), pass, totp);
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
        if (totp !== undefined) setCode('');
        else setPassword('');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit(email, password, needsCode ? code.trim() : undefined);
  };

  return (
    <div className="relative min-h-screen bg-[#0f172a] flex items-center justify-center p-4 font-sans" dir="rtl">
      {/* Appearance before sign-in, in the top corner (the end side), clear of the card. */}
      <div className="absolute top-3 left-3">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm flex flex-col gap-5">
      <StationClock variant="hero" onDark />
      <div className="w-full bg-white border border-slate-200 rounded-2xl shadow-xl p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-red-600 flex items-center justify-center">
            <Radio className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">{APP_NAME} · {APP_TAGLINE}</h1>
            <p className="text-xs text-slate-500">{creatingAdministrator ? 'إنشاء حساب المسؤول الأول' : 'سجّل الدخول بحسابك المؤسسي'}</p>
          </div>
        </div>

        {notice && (
          <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 font-semibold">{notice}</div>
        )}

        {setupMode && (
          <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50/60 p-3">
            <button
              type="button"
              aria-expanded={setupOpen}
              aria-controls="login-setup"
              disabled={isSubmitting || savingAdministrator}
              onClick={() => { setSetupOpen(!setupOpen); if (setupMode === 'demo') setDemoOpen(true); }}
              className="flex min-h-9 w-full items-center gap-2 text-start text-sm font-bold text-blue-800 hover:text-blue-950 disabled:opacity-60"
            >
              <Settings2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{creatingAdministrator ? 'العودة إلى تسجيل الدخول' : 'بدء إعداد النظام'}</span>
            </button>
            <div id="login-setup" hidden={!setupOpen} className="mt-2 space-y-3">
              <p className="text-sm leading-relaxed text-slate-700">
                {setupMode === 'browser' && 'أدخل رمز إعداد الخادم وأنشئ حساب المسؤول. بعد الدخول يبدأ المعالج بمراجعة بيانات المؤسسة والمحطات الافتراضية.'}
                {setupMode === 'sign-in' && 'سجّل الدخول ببريد المسؤول وكلمة المرور الأولى التي عيّنها مشغّل الخادم أو ولّدها الخادم في سجل بدء التشغيل. بعد تغييرها، يفتح معالج إعداد المؤسسة.'}
                {setupMode === 'demo' && 'اختر حساب مدير النظام من حسابات التجربة أدناه لتجربة المعالج. يعرض النظام بيانات نموذجية يمكنك حذفها من الإعدادات بعد إنشاء حساب إدارة خاص بالمؤسسة.'}
              </p>
              {creatingAdministrator && <FirstAdministratorForm saving={savingAdministrator} onSavingChange={setSavingAdministrator} onCreated={(mail, pass) => {
                setSetupMode(null);
                setSetupOpen(false);
                setSavingAdministrator(false);
                setAdministratorCreated(true);
                setEmail(mail);
                setPassword(pass);
                setNeedsCode(false);
                setCode('');
                void submit(mail, pass);
              }} />}
            </div>
          </div>
        )}

        {administratorCreated && (
          <p role="status" className="mb-4 rounded-lg bg-blue-50 p-3 text-xs font-semibold text-blue-800">أُنشئ حساب المسؤول. سجّل الدخول به لإكمال الإعداد.</p>
        )}
        {!creatingAdministrator && <form onSubmit={handleSubmit} className="space-y-4">
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
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="w-full text-sm pr-9 pl-12 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 text-left"
                dir="ltr"
              />
              <PasswordVisibilityButton visible={showPassword} onClick={() => setShowPassword(value => !value)} className="absolute left-1 top-0" />
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
              <button type="button" onClick={() => { setNeedsCode(false); setCode(''); setPassword(''); setEmail(''); setError(null); }}
                className="mt-2 min-h-10 text-xs font-semibold text-blue-700 hover:underline">تبديل الحساب</button>
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
        </form>}

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
                        setNeedsCode(false);
                        setCode('');
                        void submit(a.email, demo.password!);
                      }}
                      aria-label={`الدخول بحساب ${a.fullName} — ${a.roleName}`}
                      className="w-full text-right p-2 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-60"
                    >
                      <span className="block text-xs font-bold text-slate-800">
                        {a.fullName} <span className="font-normal text-blue-700">— {a.roleName}</span>
                      </span>
                      <span className="block text-2xs text-slate-500" dir="ltr">
                        {a.email}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-2xs text-slate-500">بيئة تجريبية: تختفي هذه القائمة بعد حذف البيانات التجريبية من الإعدادات.</p>
          </div>
        )}
      </div>
      </div>
    </div>
  );
};
