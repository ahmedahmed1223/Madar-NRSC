import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronLeft, FileCheck, RefreshCw } from 'lucide-react';
import type { NewsItem } from '../../types';
import type { AdminOverview } from '../../shared/adminOverview';
import { appLocale, zoneOptions } from '../../shared/dateFormat';
import { approvedMaterialSummary, summarizeAdminExceptions } from '../../shared/dailyDashboardSummaries';
import { apiFetch } from '../../services/http';

const panelClass = 'space-y-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-5';
const actionClass = 'inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-xs font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline-2';

export function AdminExceptionSummary({ onOpenMonitor }: { onOpenMonitor: () => void }) {
  const [result, setResult] = useState<AdminOverview | 'unavailable' | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<{ data: AdminOverview }>('/api/v1/admin/overview', { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setResult(data); })
      .catch(() => { if (!controller.signal.aborted) setResult('unavailable'); });
    return () => controller.abort();
  }, [attempt]);

  const data = result && result !== 'unavailable' ? result : null;
  const summary = data ? summarizeAdminExceptions(data.alerts) : null;
  return (
    <section id="admin-exception-summary" className={panelClass} aria-labelledby="admin-exception-title">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <h2 id="admin-exception-title" className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <AlertTriangle className="size-4 text-amber-700" aria-hidden="true" />
          استثناءات النظام
        </h2>
        <button type="button" onClick={onOpenMonitor} className={actionClass}>فتح مراقبة النظام <ChevronLeft className="size-3" aria-hidden="true" /></button>
      </div>
      {result === null && <p role="status" className="text-xs text-slate-600">جارٍ قراءة حالة النظام…</p>}
      {result === 'unavailable' && (
        <div className="flex flex-wrap items-center gap-x-3">
          <p role="status" className="text-xs text-slate-700">تعذّر قراءة حالة النظام.</p>
          <button type="button" className={actionClass} onClick={() => { setResult(null); setAttempt((n) => n + 1); }}>
            <RefreshCw className="size-3" aria-hidden="true" /> إعادة المحاولة
          </button>
        </div>
      )}
      {data && summary && (
        <>
          <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {[
              { label: 'أخطاء النظام', count: summary.errors },
              { label: 'تنبيهات النظام', count: summary.warnings },
              { label: 'تكليفات متعطلة', count: data.content.blockedCards },
              { label: 'تكليفات متأخرة', count: data.content.lateCards },
            ].map(({ label, count }) => (
              <div key={label} className="rounded-lg bg-slate-50 p-2 text-slate-700">
                <dt>{label}</dt><dd className="mt-0.5 text-sm font-bold tabular-nums">{count}</dd>
              </div>
            ))}
          </dl>
          {summary.preview.length > 0 ? (
            <ul className="space-y-1.5 text-xs" aria-label="آخر استثناءات النظام">
              {summary.preview.map(({ level, text }) => <li key={`${level}:${text}`} className={`break-words ${level === 'error' ? 'text-rose-800' : 'text-amber-900'}`}>{level === 'error' ? 'خطأ' : 'تنبيه'} · {text}</li>)}
            </ul>
          ) : <p className="text-xs text-slate-600">لا توجد أخطاء أو تنبيهات للنظام في هذه القراءة.</p>}
          <p className="text-2xs text-slate-500">آخر قراءة · <time dateTime={data.generatedAt}>{new Date(data.generatedAt).toLocaleString(appLocale(), { ...zoneOptions(), day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></p>
        </>
      )}
    </section>
  );
}

export function ApprovedMaterialSummary({ items, now, onOpen }: { items: NewsItem[]; now: number; onOpen: (id: string) => boolean }) {
  const { approved, published, preview } = approvedMaterialSummary(items, now);
  const [unavailable, setUnavailable] = useState(false);
  return (
    <section id="approved-material-summary" className={panelClass} aria-labelledby="approved-material-title">
      <h2 id="approved-material-title" className="flex items-center gap-2 text-sm font-bold text-slate-900">
        <FileCheck className="size-4 text-emerald-700" aria-hidden="true" /> المواد المعتمدة والمنشورة
      </h2>
      <dl className="flex flex-wrap gap-2 text-xs text-slate-700">
        <div className="flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1"><dt>معتمدة للنشر</dt><dd className="font-bold tabular-nums">{approved}</dd></div>
        <div className="flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1"><dt>منشورة</dt><dd className="font-bold tabular-nums">{published}</dd></div>
      </dl>
      {unavailable && <p role="status" className="text-xs text-amber-800">المادة غير متاحة حالياً.</p>}
      {preview.length === 0 ? <p className="text-xs text-slate-600">لا توجد مواد معتمدة أو منشورة متاحة للقراءة.</p> : (
        <ul className="divide-y divide-slate-100">
          {preview.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 py-0.5">
              <button type="button" onClick={() => setUnavailable(!onOpen(item.id))} className={`${actionClass} min-w-0 px-0 text-start`}>
                <span className="min-w-0 break-words">{item.title}</span><ChevronLeft className="size-3 shrink-0" aria-hidden="true" />
              </button>
              <span className="shrink-0 text-2xs text-slate-600">{item.status === 'APPROVED' ? 'معتمدة' : 'منشورة'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
