import { useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { isNewerVersion, type AppUpdateStatus } from '../../shared/appUpdates';
import { apiFetch } from '../../services/http';
import { dataStore } from '../../services/dataStore';
import { confirmDialog } from '../../services/dialogs';

const checkStatus = () => apiFetch<{ data: AppUpdateStatus }>('/api/v1/updates', { cache: 'no-store' });
const button = 'min-h-11 inline-flex items-center gap-2 px-3 rounded-lg border border-slate-300 bg-white text-sm font-bold text-slate-800 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-600';

export function AppUpdatesPanel() {
  const localVersion = __APP_VERSION__;
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذر فحص الإصدارات'); }
    finally { setBusy(false); }
  };

  const verifiedStatus = async () => {
    const { data } = await checkStatus();
    setStatus(data);
    return data;
  };

  const canReload = !!status && isNewerVersion(status.deployedVersion, localVersion);
  const newer = status?.latest && isNewerVersion(status.latest.version, status.deployedVersion) ? status.latest : null;
  const requested = status?.requestedVersion;

  const applyBrowser = () => run(async () => {
    const current = await verifiedStatus();
    if (current.broadcastActive) throw new Error('توجد جلسة بث نشطة. أعد التحقق بعد انتهائها.');
    if (dataStore.pendingCount()) throw new Error('انتظر تأكيد المزامنة قبل إعادة تحميل الواجهة.');
    if (isNewerVersion(current.deployedVersion, localVersion)) window.location.reload();
  });

  const deploy = () => run(async () => {
    if (!newer || dataStore.pendingCount()) throw new Error('انتظر تأكيد المزامنة قبل طلب النشر.');
    const confirmed = await confirmDialog({
      title: `طلب نشر مدار v${newer.version}`,
      message: 'أكد انتهاء جلسات البث، بما فيها الجلسات المحلية غير المتصلة، وحفظ عمل الفريق قبل إعادة تشغيل الخادم.',
      confirmLabel: 'أؤكد انتهاء البث وأطلب النشر',
      cancelLabel: 'تراجع',
      danger: true,
    });
    if (!confirmed) return;
    await apiFetch('/api/v1/updates/deploy', { method: 'POST', json: { version: newer.version, localAirEnded: true } });
    setStatus((current) => current ? { ...current, requestedVersion: newer.version } : current);
  });

  return (
    <section aria-label="تحديثات مدار" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900">تحديثات مدار</h2>
          <p className="text-sm text-slate-600">إصدار الواجهة <b dir="ltr">v{localVersion}</b>{status && <> · إصدار الخادم <b dir="ltr">v{status.deployedVersion}</b></>}</p>
        </div>
        <button type="button" className={button} disabled={busy} onClick={() => void run(async () => { await verifiedStatus(); })}>
          <RefreshCw size={16} aria-hidden="true" /> {busy ? 'جارٍ التحقق…' : 'فحص الإصدارات'}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {status && <div role="status" className="text-sm text-slate-700">
        {!status.latest ? 'تعذر الوصول إلى أحدث إصدار منشور.' : newer
          ? <>أحدث إصدار منشور <b dir="ltr">v{newer.version}</b>.</>
          : 'الخادم يشغّل أحدث إصدار منشور أو إصدارًا أحدث.'}
        {status.broadcastActive && <p className="mt-1">يتاح التحديث بعد انتهاء البث النشط.</p>}
        {requested && <p className="mt-1">استلم نظام النشر الطلب للإصدار <b dir="ltr">v{requested}</b>. افحص الإصدار مجددًا بعد اكتمال النشر.</p>}
      </div>}
      <div className="flex flex-wrap items-center gap-2">
        {canReload && <button type="button" className={button} disabled={busy || status?.broadcastActive} onClick={() => void applyBrowser()}>
          <Download size={16} aria-hidden="true" /> تحميل الواجهة الجديدة
        </button>}
        {newer && status?.deployment && <button type="button" className={button} disabled={busy || status.broadcastActive || !!requested} onClick={() => void deploy()}>طلب نشر الإصدار على الخادم</button>}
        {newer && <a href={newer.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center px-2 text-sm font-bold text-blue-700 hover:underline">ملاحظات الإصدار على GitHub</a>}
      </div>
    </section>
  );
}
