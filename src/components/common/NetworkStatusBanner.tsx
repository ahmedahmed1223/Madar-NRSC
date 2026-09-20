import React from 'react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useSystemHealth } from '../../hooks/useSystemHealth';
import { WifiOff, Wifi, ShieldCheck, RefreshCw } from 'lucide-react';

export const NetworkStatusBanner: React.FC = () => {
  const { isOnline, wasOffline } = useOnlineStatus();
  const { networkState, triggerNetworkDrain } = useSystemHealth();

  // If online and was not previously offline and no pending mutations, show nothing
  if (isOnline && !wasOffline && networkState.pendingMutationsCount === 0) {
    return null;
  }

  // If back online after being offline or has pending mutations to sync
  if (isOnline && (wasOffline || networkState.pendingMutationsCount > 0)) {
    return (
      <div
        id="network-restored-banner"
        role="status"
        aria-live="polite"
        className="fixed top-0 inset-x-0 z-50 bg-emerald-600 text-white px-4 py-2 text-xs font-semibold flex items-center justify-between shadow-md animate-fade-in"
      >
        <div className="flex items-center gap-2 mx-auto">
          <Wifi className="w-4 h-4 animate-bounce" />
          <span>
            {networkState.pendingMutationsCount > 0
              ? `تمت استعادة الاتصال — جاري مزامنة (${networkState.pendingMutationsCount}) عمليات معلقة تلقائياً مع السيرفر`
              : 'تمت استعادة الاتصال بالشبكة بنجاح — منظومة البث متصلة بالكامل'}
          </span>
          <ShieldCheck className="w-4 h-4 text-emerald-200" />
        </div>
        {networkState.pendingMutationsCount > 0 && (
          <button
            type="button"
            onClick={triggerNetworkDrain}
            className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
          >
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span>مزامنة فورية</span>
          </button>
        )}
      </div>
    );
  }

  // Offline state
  return (
    <div
      id="network-offline-banner"
      role="alert"
      aria-live="assertive"
      className="fixed top-0 inset-x-0 z-50 bg-amber-600 text-white px-4 py-2 text-xs font-semibold flex items-center justify-between shadow-lg"
    >
      <div className="flex items-center gap-2 mx-auto">
        <WifiOff className="w-4 h-4 animate-pulse text-amber-200" />
        <span>
          <strong>وضع العمل المحلي الآمن:</strong> تم فقدان الاتصال بالشبكة. تعمل المنظومة عبر التخزين المحلي المحمي ولن تفقد أي تغييرات
          {networkState.pendingMutationsCount > 0 && ` (${networkState.pendingMutationsCount} تعديل بانتظار المزامنة)`}.
        </span>
      </div>
      <span className="hidden md:inline text-[10px] bg-amber-700/60 px-2 py-0.5 rounded-md font-mono">
        24/7 OFFLINE RESILIENT
      </span>
    </div>
  );
};
