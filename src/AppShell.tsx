import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { authClient, SessionInfo } from './services/authClient';
import { dataStore } from './services/dataStore';
import { setPasswordChangeHandler, setUnauthorizedHandler } from './services/http';
import { LoginView } from './components/auth/LoginView';
import { ChangePasswordView } from './components/auth/ChangePasswordView';

const App = lazy(() => import('./App'));

type Phase = 'checking' | 'login' | 'change-password' | 'loading-data' | 'ready' | 'error' | 'offline';

const FullScreenMessage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans text-white" dir="rtl">
    <div className="flex flex-col items-center gap-3 text-sm font-semibold text-center">{children}</div>
  </div>
);

/**
 * Authentication gate: resolves the session, forces a password change when required,
 * and loads the shared data from the server before the newsroom UI is rendered.
 */
export default function AppShell() {
  const [phase, setPhase] = useState<Phase>('checking');
  const phaseRef = useRef<Phase>('checking');
  phaseRef.current = phase;
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const logoutPending = useRef(false);

  const enter = useCallback(async (session: SessionInfo) => {
    if (session.mustChangePassword) {
      setPhase('change-password');
      return;
    }
    setPhase('loading-data');
    try {
      await dataStore.start(session.user.id);
      setPhase('ready');
    } catch (err: any) {
      setErrorMessage(err?.message || 'تعذر تحميل البيانات من الخادم');
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      // A 401 on the first session check just means nobody is signed in yet.
      const hadSession = !!authClient.getSession();
      dataStore.stop();
      authClient.setSession(null);
      if (hadSession) setNotice('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً');
      setPhase('login');
    });
    // The server holds every request back until a temporary password is replaced: show that screen.
    setPasswordChangeHandler(() => {
      if (!authClient.getSession()) return;
      authClient.requirePasswordChange();
      dataStore.stop();
      setPhase('change-password');
    });
    // Opened without a connection (the app itself comes from the offline cache): wait for it.
    const boot = () => {
      if (navigator.onLine === false) return setPhase('offline');
      setPhase('checking');
      authClient.fetchSession().then((session) => (session ? enter(session) : setPhase('login')));
    };
    const onOnline = () => {
      if (phaseRef.current === 'offline') boot();
    };
    window.addEventListener('online', onOnline);
    boot();
    return () => {
      setUnauthorizedHandler(null);
      setPasswordChangeHandler(null);
      window.removeEventListener('online', onOnline);
    };
  }, [enter]);

  const handleLogin = async (email: string, password: string, totp?: string) => {
    const session = await authClient.login(email, password, totp);
    setNotice(null);
    await enter(session);
  };

  const handleLogout = useCallback(async () => {
    if (logoutPending.current) return;
    logoutPending.current = true;
    setLoggingOut(true);
    setLogoutError(null);
    try {
      try {
        await dataStore.flush();
      } catch {
        // unsent edits stay queued in this browser for the next sign-in
      }
      try {
        if (!await authClient.logout(() => dataStore.stop())) return;
      } catch {
        const session = authClient.getSession();
        if (session) {
          try { await enter(session); } catch { /* the original logout error remains visible */ }
        }
        setLogoutError('تعذر إكمال تسجيل الخروج. تحقق من الاتصال ثم أعد المحاولة.');
        return;
      }
      dataStore.stop();
      setIsChangingPassword(false);
      setNotice('تم تسجيل الخروج بأمان. يمكنك الدخول بحساب آخر.');
      setPhase('login');
    } finally {
      logoutPending.current = false;
      setLoggingOut(false);
    }
  }, [enter]);

  const handleChangePassword = async (currentPassword: string, newPassword: string) => {
    await authClient.changePassword(currentPassword, newPassword);
    setIsChangingPassword(false);
    if (phase === 'change-password') {
      const session = authClient.getSession();
      if (session) await enter(session);
    }
  };

  if (phase === 'checking' || phase === 'loading-data') {
    return (
      <FullScreenMessage>
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" aria-hidden="true" />
        <span role="status">{phase === 'checking' ? 'جارٍ التحقق من الجلسة...' : 'جارٍ تحميل بيانات غرفة الأخبار...'}</span>
      </FullScreenMessage>
    );
  }

  if (phase === 'offline') {
    return (
      <FullScreenMessage>
        <AlertTriangle className="w-8 h-8 text-amber-400" aria-hidden="true" />
        <span role="status">غير متصل — سيفتح «مدار» تلقائياً عند عودة الاتصال. ما حفظته على هذا الجهاز باقٍ.</span>
      </FullScreenMessage>
    );
  }

  if (phase === 'login') return <LoginView onLogin={handleLogin} notice={notice} />;

  if (phase === 'change-password') {
    return <ChangePasswordView forced onSubmit={handleChangePassword} onLogout={handleLogout} />;
  }

  if (phase === 'error') {
    return (
      <FullScreenMessage>
        <AlertTriangle className="w-8 h-8 text-amber-400" aria-hidden="true" />
        <span role="alert">{errorMessage}</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
        >
          إعادة المحاولة
        </button>
      </FullScreenMessage>
    );
  }

  return (
    <>
      {(loggingOut || logoutError) && <div
        role={logoutError ? 'alert' : 'status'}
        className="fixed bottom-4 inset-x-4 z-[150] mx-auto max-w-xl rounded-lg border border-slate-300 bg-white p-4 text-sm text-slate-900 shadow-lg"
        dir="rtl"
      >
        {logoutError ? <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 min-w-0">{logoutError}</p>
          <button type="button" onClick={() => void handleLogout()} className="min-h-11 px-3 rounded-lg bg-blue-600 text-white font-semibold">إعادة المحاولة</button>
          <button type="button" onClick={() => setLogoutError(null)} className="min-h-11 px-3 rounded-lg border border-slate-300">إغلاق</button>
        </div> : <p className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> جارٍ إكمال الحفظ وتسجيل الخروج…</p>}
      </div>}
      <Suspense
        fallback={
          <FullScreenMessage>
            <Loader2 className="w-8 h-8 animate-spin text-blue-400" aria-hidden="true" />
            <span role="status">جارٍ فتح مساحة العمل...</span>
          </FullScreenMessage>
        }
      >
        <App onLogout={handleLogout} onChangePassword={() => setIsChangingPassword(true)} />
      </Suspense>
      {isChangingPassword && (
        <div className="fixed inset-0 z-[100]">
          <ChangePasswordView onSubmit={handleChangePassword} onCancel={() => setIsChangingPassword(false)} />
        </div>
      )}
    </>
  );
}
