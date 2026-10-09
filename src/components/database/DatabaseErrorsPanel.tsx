import { useEffect, useState } from 'react';
import { Download, RefreshCw, Search } from 'lucide-react';
import { apiService } from '../../services/api';
import type { RecentServerErrors } from '../../shared/databaseDiagnostics';
import { appLocale, zoneOptions } from '../../shared/dateFormat';

export function DatabaseErrorsPanel() {
  const [data, setData] = useState<RecentServerErrors | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [query, setQuery] = useState('');
  async function refresh() {
    setBusy(true); setError('');
    try { setData(await apiService.getServerErrors()); }
    catch { setError('تعذر تحميل السجل؛ تحقق من الاتصال والصلاحيات'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, []);
  async function download() {
    setExporting(true); setError('');
    try {
      const report = await apiService.getDatabaseDiagnostics();
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `madar-diagnostics-${report.generatedAt.slice(0, 10)}.json`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('تعذر تنزيل تقرير التشخيص'); }
    finally { setExporting(false); }
  }
  const entries = data?.entries.filter(entry => `${entry.id} ${entry.message} ${entry.at}`.toLowerCase().includes(query.trim().toLowerCase())) || [];
  return <section role="tabpanel" id="database-errors" aria-labelledby="database-tab-errors" className="space-y-4 min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-base font-bold">آخر أخطاء الخادم</h2>{data && <p className="text-xs text-slate-600 mt-1">بداية السجل المتاح: {new Date(data.since).toLocaleString(appLocale(), zoneOptions())} · {data.entries.length} / 100</p>}</div>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-label="تحديث سجل الأخطاء" title="تحديث سجل الأخطاء" disabled={busy} onClick={() => void refresh()} className="p-3 border rounded-md disabled:opacity-50"><RefreshCw size={18} className={busy ? 'animate-spin' : ''}/></button>
        <button type="button" disabled={exporting} onClick={() => void download()} className="flex items-center gap-2 border rounded-md px-3 min-h-11 text-sm disabled:opacity-50"><Download size={18}/>تنزيل تقرير التشخيص</button>
      </div>
    </div>
    <label className="flex items-center gap-2 max-w-md text-sm"><Search size={18}/><span className="sr-only">بحث سجل الأخطاء</span><input aria-label="بحث سجل الأخطاء" type="search" value={query} onChange={event => setQuery(event.target.value)} className="border rounded-md px-3 min-h-11 w-full min-w-0"/></label>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {data?.journalHealth === 'degraded' && <p role="alert" className="text-sm text-amber-900">تعذر حفظ بعض الأخطاء على القرص؛ راجع مساحة التخزين وصلاحيات مجلد السجل.</p>}
    {data?.journalHealth === 'memory' && <p className="text-xs text-slate-600">السجل مؤقت في الذاكرة في هذه البيئة.</p>}
    {busy && <p role="status" className="text-sm">جار تحميل السجل...</p>}
    {!busy && data && !entries.length && <p className="text-sm text-slate-600">{query ? 'لا توجد أخطاء مطابقة للبحث' : 'لا توجد أخطاء في السجل المتاح'}</p>}
    <ol className="divide-y border-t border-slate-200">{entries.map((entry, index) => <li key={`${entry.id}-${index}`} className="py-3 flex flex-wrap items-start gap-3 text-sm"><time dateTime={entry.at} className="text-slate-600">{new Date(entry.at).toLocaleString(appLocale(), zoneOptions())}</time><span dir="auto" className="break-words min-w-0">{entry.message}</span><code dir="ltr" className="text-xs text-slate-600 break-all">{entry.id}</code></li>)}</ol>
  </section>;
}
