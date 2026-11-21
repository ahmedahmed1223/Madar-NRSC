import { useEffect, useState } from 'react';
import { Archive, ArrowUpLeft, RefreshCw } from 'lucide-react';
import type { BackupStatus } from '../../shared/databaseDiagnostics';
import { appLocale, zoneOptions } from '../../shared/dateFormat';
import { apiFetch } from '../../services/http';
import { navigateTo } from '../../services/uiEvents';

const action = 'inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-800 hover:bg-slate-50';
const when = (value: string) => new Date(value).toLocaleString(appLocale(), zoneOptions());

export function BackupReadinessEvidence({ data }: { data: BackupStatus }) {
  const verified = data.lastVerifiedExternal;
  const target = verified?.targets.map(item => item === 'directory' ? 'مجلد خارج مجلد البيانات' : 'وجهة سحابية').join(' و');
  return <dl className="grid gap-2 text-sm sm:grid-cols-3">
    <div className="rounded-lg bg-slate-50 p-3"><dt className="font-bold">آخر لقطة لقاعدة البيانات</dt>
      <dd className="mt-1 break-words">{data.lastSnapshotAt ? when(data.lastSnapshotAt) : 'لا توجد لقطة مسجلة'}</dd>
      {data.overdue && <dd className="mt-1 text-xs font-bold text-amber-800">تأخر النسخ الدوري</dd>}
    </div>
    <div className="rounded-lg bg-slate-50 p-3"><dt className="font-bold">آخر نسخة كاملة محققة خارج مجلد البيانات</dt>
      <dd className="mt-1 break-words">{verified ? `${when(verified.at)} · ${target}` : 'لا يوجد تسليم كامل موثّق إلى الوجهة الحالية'}</dd>
      {data.lastDelivery?.status === 'failed' && <dd className="mt-1 text-xs font-bold text-rose-800">فشلت آخر محاولة تسليم · {when(data.lastDelivery.at)}</dd>}
    </div>
    <div className="rounded-lg bg-slate-50 p-3"><dt className="font-bold">آخر تجربة لاستعادة القاعدة</dt>
      <dd className="mt-1 break-words">{data.lastRehearsal ? when(data.lastRehearsal.at) : 'لا توجد تجربة مسجلة'}</dd>
      <dd className="mt-1 text-xs text-slate-600">تتحقق التجربة من قاعدة البيانات في نسخة معزولة.</dd>
    </div>
  </dl>;
}

export function BackupReadinessSummary({ canOpenBackups }: { canOpenBackups: boolean }) {
  const [data, setData] = useState<BackupStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!canOpenBackups) return;
    const controller = new AbortController();
    void apiFetch<{ data: BackupStatus }>('/api/v1/db/backup-status', { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result.data); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attempt, canOpenBackups]);
  return <section id="backup-readiness" aria-label="حالة النسخ والاستعادة" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 font-bold"><Archive className="size-4 text-blue-700" aria-hidden="true" /> حالة النسخ والاستعادة</h2>
      {canOpenBackups && <button type="button" className={action} onClick={() => navigateTo.emit('/database')}>فتح النسخ والاستعادة <ArrowUpLeft className="size-4" aria-hidden="true" /></button>}
    </div>
    {!canOpenBackups ? <p className="text-sm text-slate-600">عرض النسخ وتجارب الاستعادة يتطلب صلاحية إدارة قاعدة البيانات.</p>
      : failed ? <div className="flex flex-wrap items-center gap-2"><p role="alert" className="text-sm text-rose-800">تعذر قراءة حالة النسخ والاستعادة.</p>
        <button type="button" className={action} onClick={() => { setData(null); setFailed(false); setAttempt(value => value + 1); }}><RefreshCw className="size-4" aria-hidden="true" /> إعادة المحاولة</button></div>
        : data ? <BackupReadinessEvidence data={data} /> : <p role="status" className="text-sm text-slate-600">جارٍ التحقق من النسخ والاستعادة…</p>}
  </section>;
}
