import { StationClock } from '../common/StationClock';
import { configureDateFormat } from '../../shared/dateFormat';
import { APP_ICON_URL, APP_NAME, APP_TAGLINE } from '../../shared/brand';
import { APP_VERSION } from '../../shared/releaseVersion';
import type { LoginSetupMode } from '../../shared/setup';
import { apiFetch } from '../../services/http';
import { applyColorPalette } from '../../services/theme';
import { ThemeToggle } from '../common/ThemeToggle';
import { FirstAdministratorForm } from './FirstAdministratorForm';
import { LoginSetupPanel } from './LoginSetupPanel';
import React, { useEffect, useRef, useState } from 'react';
import { Mail, Lock, LogIn, AlertCircle, Loader2, Users, ChevronDown } from 'lucide-react';
import { PasswordVisibilityButton } from './PasswordFields';

interface LoginViewProps {
  onLogin: (email: string, password: string, totp?: string, rememberMe?: boolean) => Promise<void>;
  notice?: string | null;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLogin, notice }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState('');
  const [setupMode, setSetupMode] = useState<LoginSetupMode>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupError, setSetupError] = useState(false);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [savingAdministrator, setSavingAdministrator] = useState(false);
  const [administratorCreated, setAdministratorCreated] = useState(false);
  const submitting = useRef(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const creatingAdministrator = setupOpen && setupMode === 'browser';

  useEffect(() => {
    if (needsCode) codeInput.current?.focus();
  }, [needsCode]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Setup check timed out', 'TimeoutError')), 8000);
    apiFetch<{ data?: { mode: LoginSetupMode } }>('/api/v1/auth/setup', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setSetupMode(result?.data?.mode ?? null);
      })
      .catch(() => {
        if (!controller.signal.aborted || controller.signal.reason?.name === 'TimeoutError') setSetupError(true);
      })
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [setupAttempt]);

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
      .then((j) => {
        if (!j?.data) return;
        configureDateFormat(j.data);
        applyColorPalette(j.data.colorPalette);
      })
      .catch(() => undefined);
  }, []);

  const submit = async (mail: string, pass: string, totp?: string, keepSession = false) => {
    if (submitting.current) return;
    submitting.current = true;
    setError(null);
    setIsSubmitting(true);
    try {
      await onLogin(mail.trim(), pass, totp, keepSession);
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
        if (totp !== undefined) {
          setCode('');
          codeInput.current?.focus();
        } else if (!['TimeoutError', 'AbortError', 'TypeError'].includes(err?.name)) {
          setPassword('');
          passwordInput.current?.focus();
        }
      }
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit(email, password, needsCode ? code.trim() : undefined, rememberMe);
  };

  return (
    <div className="relative isolate min-h-dvh flex items-center justify-center px-4 py-16 sm:py-12 font-sans" dir="rtl">
      <div aria-hidden className="theme-fixed absolute inset-0 -z-10 bg-[var(--madar-login-backdrop)]" />
      {/* Appearance before sign-in, in the top corner (the end side), clear of the card. */}
      <div className="absolute top-3 left-3">
        <ThemeToggle />
      </div>
      <section className="w-full max-w-md flex flex-col gap-5" aria-label="الدخول إلى مدار">
      <StationClock variant="hero" onDark />
      <div className="w-full bg-white border border-slate-200 rounded-2xl p-5 sm:p-8">
        <div className="flex items-center gap-3 mb-6">
          <img src={APP_ICON_URL} alt="" width={48} height={48} className="size-12 shrink-0 rounded-xl" />
          <div>
            <h1 className="font-sans text-3xl font-bold text-slate-900 leading-tight">{APP_NAME}</h1>
            <p className="text-sm text-slate-600">{APP_TAGLINE}</p>
            <p className="mt-1 text-xs text-slate-600">الإصدار <bdi dir="ltr" className="tabular-nums">{APP_VERSION}</bdi></p>
          </div>
        </div>

        {notice && (
          <div role="status" className="mb-4 p-3 rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-800 font-semibold">{notice}</div>
        )}

        {setupError && <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 rounded-lg border border-slate-200 px-3 py-1 text-sm text-slate-700">
          <span role="status">تعذّر التحقق من حالة التهيئة.</span>
          <button type="button" onClick={() => { setSetupError(false); setSetupAttempt(attempt => attempt + 1); }}
            className="min-h-11 font-semibold text-blue-700 hover:underline">إعادة فحص التهيئة</button>
        </div>}

        {setupMode && (
          <LoginSetupPanel mode={setupMode} open={setupOpen} disabled={isSubmitting || savingAdministrator}
            onToggle={() => { setSetupOpen(!setupOpen); if (setupMode === 'demo') setDemoOpen(true); }}>
            {creatingAdministrator && <FirstAdministratorForm saving={savingAdministrator} onSavingChange={setSavingAdministrator} onCreated={(mail, pass) => {
              setSetupMode(null);
              setSetupOpen(false);
              setSavingAdministrator(false);
              setAdministratorCreated(true);
              setEmail(mail);
              setPassword(pass);
              setNeedsCode(false);
              setCode('');
              setRememberMe(false);
              void submit(mail, pass);
            }} />}
          </LoginSetupPanel>
        )}

        {administratorCreated && (
          <p role="status" className="mb-4 rounded-lg bg-blue-50 p-3 text-xs font-semibold text-blue-800">أُنشئ حساب المسؤول. سجّل الدخول به لإكمال الإعداد.</p>
        )}
        {!creatingAdministrator && <form onSubmit={handleSubmit} aria-busy={isSubmitting} className="space-y-5">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900">{needsCode ? 'التحقق بخطوتين' : 'تسجيل الدخول'}</h2>
            <p className="text-sm text-slate-600">{needsCode ? 'أدخل الرمز المكوّن من ستة أرقام من تطبيق المصادقة.' : 'استخدم بريدك المؤسسي وكلمة المرور للمتابعة.'}</p>
          </div>
          <div>
            <label htmlFor="login-email" className="block text-xs font-bold text-slate-700 mb-1.5">
              البريد الإلكتروني
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute right-3 top-4" aria-hidden="true" />
              <input
                id="login-email"
                ref={emailInput}
                readOnly={isSubmitting || needsCode}
                autoCapitalize="none"
                spellCheck={false}
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full min-h-12 text-base pr-9 pl-3 py-2.5 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-left read-only:bg-slate-50"
                dir="ltr"
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-password" className="block text-xs font-bold text-slate-700 mb-1.5">
              كلمة المرور
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute right-3 top-4" aria-hidden="true" />
              <input
                id="login-password"
                ref={passwordInput}
                readOnly={isSubmitting || needsCode}
                aria-describedby={error ? 'login-error' : undefined}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="w-full min-h-12 text-base pr-9 pl-12 py-2.5 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-left read-only:bg-slate-50"
                dir="ltr"
              />
              <PasswordVisibilityButton visible={showPassword} onClick={() => setShowPassword(value => !value)} className="absolute left-1 top-0" />
            </div>
          </div>

          {!needsCode && <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-1 py-1 text-sm text-slate-800">
            <input type="checkbox" checked={rememberMe} disabled={isSubmitting}
              onChange={event => setRememberMe(event.target.checked)} aria-labelledby="remember-login-label" aria-describedby="remember-login-hint"
              className="mt-0.5 size-5 shrink-0 accent-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" />
            <span className="grid min-w-0 gap-0.5">
              <span id="remember-login-label" className="font-semibold">تذكّرني على هذا الجهاز</span>
              <span id="remember-login-hint" className="text-xs text-slate-600">للأجهزة الخاصة</span>
            </span>
          </label>}

          {needsCode && (
            <div>
              <label htmlFor="login-totp" className="block text-xs font-bold text-slate-700 mb-1.5">
                رمز التحقق من تطبيق المصادقة
              </label>
              <input
                id="login-totp"
                ref={codeInput}
                readOnly={isSubmitting}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) - (digit <= '٩' ? 0x660 : 0x6f0))).replace(/\D/g, ''))}
                className="w-full text-lg tracking-[0.5em] text-center px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-mono"
                dir="ltr"
              />
              <button type="button" disabled={isSubmitting} onClick={() => { setNeedsCode(false); setCode(''); setPassword(''); setEmail(''); setRememberMe(false); setError(null); emailInput.current?.focus(); }}
                className="mt-2 min-h-10 text-xs font-semibold text-blue-700 hover:underline">تبديل الحساب</button>
            </div>
          )}

          {error && (
            <div id="login-error" role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full min-h-12 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-base font-bold transition-colors disabled:opacity-60"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <LogIn className="w-4 h-4" aria-hidden="true" />}
            <span>{isSubmitting ? 'جارٍ الدخول…' : needsCode ? 'تحقق وسجّل الدخول' : 'تسجيل الدخول'}</span>
          </button>
          <details className="text-sm text-slate-600">
            <summary className="min-h-11 flex items-center cursor-pointer font-semibold text-blue-700">هل نسيت كلمة المرور؟</summary>
            <p className="leading-relaxed">اطلب من مدير النظام إصدار كلمة مرور مؤقتة من «المستخدمون والصلاحيات». ستختار كلمة جديدة عند أول دخول.</p>
          </details>
        </form>}

        {demo && demo.accounts.length > 0 && demo.password && (
          <div className="mt-5 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setDemoOpen((v) => !v)}
              aria-expanded={demoOpen}
              className="w-full min-h-11 flex items-center justify-between text-sm font-bold text-slate-700"
            >
              <span className="flex items-center gap-1.5">
                <Users className="w-4 h-4 text-blue-600" /> حسابات التجربة ({demo.accounts.length})
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${demoOpen ? 'rotate-180' : ''}`} />
            </button>
            {demoOpen && <p className="mb-2 text-xs text-slate-600">كلمة المرور التجريبية <code dir="ltr" className="font-semibold break-all">{demo.password}</code></p>}
            {demoOpen && (
              <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto" aria-label="حسابات التجربة">
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
                        setRememberMe(false);
                        void submit(a.email, demo.password!);
                      }}
                      aria-label={`الدخول بحساب ${a.fullName} — ${a.roleName}`}
                      className="min-h-11 w-full text-right p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-60"
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
      </section>
    </div>
  );
};
