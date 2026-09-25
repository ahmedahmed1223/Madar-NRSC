import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { authClient, SessionInfo } from './services/authClient';
import { dataStore } from './services/dataStore';
import { setUnauthorizedHandler } from './services/http';
import { LoginView } from './components/auth/LoginView';
import { ChangePasswordView } from './components/auth/ChangePasswordView';

const App = lazy(() => import('./App'));

type Phase = 'checking' | 'login' | 'change-password' | 'loading-data' | 'ready' | 'error';

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
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

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
      dataStore.stop();
      authClient.setSession(null);
      setNotice('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً');
      setPhase('login');
    });
    authClient.fetchSession().then((session) => (session ? enter(session) : setPhase('login')));
    return () => setUnauthorizedHandler(null);
  }, [enter]);

  const handleLogin = async (email: string, password: string) => {
    const session = await authClient.login(email, password);
    setNotice(null);
    await enter(session);
  };

  const handleLogout = useCallback(async () => {
    try {
      await dataStore.flush();
    } catch {
      // unsent edits stay queued in this browser for the next sign-in
    }
    await authClient.logout().catch(() => undefined);
    dataStore.stop();
    setIsChangingPassword(false);
    setNotice(null);
    setPhase('login');
  }, []);

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
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
        <span>{phase === 'checking' ? 'جارٍ التحقق من الجلسة...' : 'جارٍ تحميل بيانات غرفة الأخبار...'}</span>
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
        <AlertTriangle className="w-8 h-8 text-amber-400" />
        <span>{errorMessage}</span>
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
      <Suspense
        fallback={
          <FullScreenMessage>
            <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
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
