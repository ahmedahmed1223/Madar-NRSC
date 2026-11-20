import React, { useEffect, useRef, useState } from 'react';
import { WifiOff, Wifi, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { dataStore } from '../../services/dataStore';
import { connectionFeedback } from '../../shared/saveFeedback';

/** How long «تم الإرسال» stays after the queue empties. */
const SENT_MS = 4000;

/**
 * One calm line about the connection. Hidden while everything is sent (it keeps no line on
 * phones), shows what waits on this device while offline, and «تم الإرسال» once it is flushed.
 */
export const NetworkStatusBanner: React.FC = () => {
  const { isOnline: browserOnline } = useOnlineStatus();
  const [serverOnline, setServerOnline] = useState(dataStore.isServerOnline());
  const [pending, setPending] = useState(dataStore.pendingCount());
  const [sent, setSent] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(false);
  const busy = useRef(false);
  const hadPending = useRef(pending > 0);
  const sentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const off = dataStore.subscribe(evt => {
      if (evt.type !== 'sync-status') return;
      setPending(evt.pending);
      setServerOnline(evt.online);
      if (evt.pending > 0) {
        hadPending.current = true;
        setSent(false);
      } else if (hadPending.current && evt.online) {
        hadPending.current = false;
        setSent(true);
        setRetryError(false);
        if (sentTimer.current) clearTimeout(sentTimer.current);
        sentTimer.current = setTimeout(() => setSent(false), SENT_MS);
      }
    });
    return () => {
      off();
      if (sentTimer.current) clearTimeout(sentTimer.current);
    };
  }, []);

  const online = browserOnline && serverOnline;
  const retry = async () => {
    if (busy.current) return;
    busy.current = true;
    setRetrying(true);
    setRetryError(false);
    try {
      await dataStore.flush({ force: true });
      if (dataStore.pendingCount() > 0 && !dataStore.isServerOnline()) setRetryError(true);
    } catch { setRetryError(true); }
    finally { busy.current = false; setRetrying(false); }
  };

  const idle = online && pending === 0 && !sent;
  const text = sent && online && pending === 0 ? 'تم الإرسال' : connectionFeedback(browserOnline, serverOnline, pending);
  const tone = !online ? 'bg-amber-50 text-amber-900 border-amber-200' : sent ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-50 text-slate-700 border-slate-200';
  const Icon = !online ? WifiOff : sent ? CheckCircle2 : Wifi;

  return (
    <div className={idle ? 'sr-only' : `shrink-0 border-b px-3 sm:px-4 text-xs flex items-center gap-2 min-h-8 ${tone}`}>
      <div role="status" aria-live="polite" className="flex items-center gap-2 min-w-0 flex-1">
        {!idle && <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />}
        <span className="truncate">{idle ? '' : text}</span>
      </div>
      {!idle && pending > 0 && browserOnline && !serverOnline && (
        <button type="button" disabled={retrying} onClick={() => void retry()}
          className="min-h-11 -my-1.5 px-2 flex items-center gap-1 font-semibold rounded disabled:opacity-50 shrink-0"
          title="إرسال التغييرات المعلقة الآن">
          <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
          {retrying ? 'جارٍ الإرسال…' : 'أعد المحاولة'}
        </button>
      )}
      {retryError && !idle && <span role="alert" className="sr-only">لم يصل الخادم بعد؛ سنعيد المحاولة تلقائياً.</span>}
    </div>
  );
};
