import React, { useEffect, useState } from 'react';
import { WifiOff, Wifi, RefreshCw } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { dataStore } from '../../services/dataStore';

/**
 * Shows when this workstation cannot reach the server. Edits made meanwhile are kept
 * on this device and pushed automatically once the connection returns.
 */
export const NetworkStatusBanner: React.FC = () => {
  const { isOnline: browserOnline } = useOnlineStatus();
  const [serverOnline, setServerOnline] = useState(true);
  const [pending, setPending] = useState(dataStore.pendingCount());
  const [justRecovered, setJustRecovered] = useState(false);

  useEffect(
    () =>
      dataStore.subscribe((evt) => {
        if (evt.type !== 'sync-status') return;
        setPending(evt.pending);
        setServerOnline((prev) => {
          if (!prev && evt.online) {
            setJustRecovered(true);
            setTimeout(() => setJustRecovered(false), 4000);
          }
          return evt.online;
        });
      }),
    []
  );

  const online = browserOnline && serverOnline;

  if (online && !justRecovered) return null;

  if (online) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed top-0 inset-x-0 z-50 bg-emerald-700 text-white px-4 py-2 text-xs font-semibold flex items-center justify-center gap-2 shadow-md"
      >
        <Wifi className="w-4 h-4" />
        <span>{pending > 0 ? `عاد الاتصال بالخادم — جارٍ إرسال ${pending} تعديل` : 'عاد الاتصال بالخادم وتمت مزامنة كل التعديلات'}</span>
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-0 inset-x-0 z-50 bg-amber-700 text-white px-4 py-2 text-xs font-semibold flex items-center justify-between gap-3 shadow-lg"
    >
      <div className="flex items-center gap-2 mx-auto">
        <WifiOff className="w-4 h-4 text-amber-200" />
        <span>
          <strong>انقطع الاتصال بالخادم.</strong> تُحفظ تعديلاتك مؤقتاً على هذا الجهاز وتُرسل تلقائياً عند عودة الاتصال
          {pending > 0 && ` (${pending} بانتظار الإرسال)`}. قد يرفض الخادم ما يتعارض مع تعديلات زملائك في الأثناء.
        </span>
      </div>
      <button
        type="button"
        onClick={() => void dataStore.flush()}
        className="px-2.5 py-1 bg-amber-700 hover:bg-amber-800 rounded-lg text-[10px] font-bold flex items-center gap-1 shrink-0"
      >
        <RefreshCw className="w-3 h-3" />
        <span>إعادة المحاولة</span>
      </button>
    </div>
  );
};
