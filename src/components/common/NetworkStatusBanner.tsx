import React, { useEffect, useRef, useState } from 'react';
import { WifiOff, Wifi, RefreshCw } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { dataStore } from '../../services/dataStore';
import { connectionFeedback } from '../../shared/saveFeedback';

export const NetworkStatusBanner: React.FC = () => {
  const { isOnline: browserOnline } = useOnlineStatus();
  const [serverOnline, setServerOnline] = useState(dataStore.isServerOnline());
  const [pending, setPending] = useState(dataStore.pendingCount());
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(false);
  const busy = useRef(false);
  useEffect(() => dataStore.subscribe(evt => {
    if (evt.type !== 'sync-status') return;
    setPending(evt.pending);
    setServerOnline(evt.online);
  }), []);
  const online = browserOnline && serverOnline;
  const retry = async () => {
    if (busy.current) return;
    busy.current = true;
    setRetrying(true);
    setRetryError(false);
    try { await dataStore.flush(); }
    catch { setRetryError(true); }
    finally { busy.current = false; setRetrying(false); }
  };
  return (
    <div className={`shrink-0 border-b px-3 sm:px-4 py-1 text-xs flex flex-wrap items-center gap-x-3 gap-y-1 ${online ? 'bg-slate-50 text-slate-700 border-slate-200' : 'bg-amber-50 text-amber-900 border-amber-200'}`}>
      <div role="status" aria-live="polite" className="flex items-center gap-2 min-w-0">
        {online ? <Wifi className="w-4 h-4 shrink-0" /> : <WifiOff className="w-4 h-4 shrink-0" />}
        <span>{connectionFeedback(browserOnline, serverOnline, pending)}</span>
      </div>
      {!online && <span>تحقق من حالة حفظ كل محرر قبل مغادرته.</span>}
      {pending > 0 && <button type="button" disabled={!browserOnline || retrying} onClick={() => void retry()}
        className="min-h-11 px-2 flex items-center gap-1 font-semibold rounded border border-slate-300 disabled:opacity-50"
        title="إعادة إرسال التعديلات المعلقة">
        <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
        {retrying ? 'جارٍ إعادة المحاولة...' : 'إعادة محاولة المزامنة'}
      </button>}
      {retryError && <span role="alert">تعذرت إعادة المحاولة؛ تحقق من الاتصال.</span>}
    </div>
  );
};
