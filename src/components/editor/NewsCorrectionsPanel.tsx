import React, { useEffect, useRef, useState } from 'react';
import { Save, RefreshCw } from 'lucide-react';
import { apiService } from '../../services/api';
import { ApiError } from '../../services/http';
import { newId } from '../../shared/ids';
import { useLiveData } from '../../hooks/useLiveData';
import type { NewsCorrection } from '../../shared/newsCorrections';
import { plainText } from '../../shared/bulletins';

export function NewsCorrectionsPanel({ newsId, canRegister, dirty }: { newsId: string; canRegister: boolean; dirty: boolean }) {
  const revision = useLiveData(['newsCorrections']);
  const [context, setContext] = useState<{ newsVersion: number; newsTitle: string; newsText: string; records: NewsCorrection[]; historyVersions: number[] } | null>(null);
  const [reason, setReason] = useState(''); const [summary, setSummary] = useState('');
  const [related, setRelated] = useState(''); const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false); const [busy, setBusy] = useState(false);
  const guard = useRef(false); const attempt = useRef<{ payload: string; id: string } | null>(null);
  const generation = useRef(0);
  const refresh = async () => {
    const token = ++generation.current;
    try { const next = await apiService.correctionContext(newsId); if (token === generation.current) { setContext(next); setConflict(false); setError(''); } }
    catch (err) { if (token === generation.current) { setContext(null); setError(err instanceof Error ? err.message : 'تعذر تحميل سجل التصحيحات'); } }
  };
  useEffect(() => { setContext(null); setReason(''); setSummary(''); setRelated(''); setConflict(false); attempt.current = null; void refresh(); return () => { generation.current++; }; }, [newsId]);
  useEffect(() => { if (!conflict && !guard.current) void refresh(); }, [revision]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (guard.current || dirty || conflict || !context) return;
    const payload = JSON.stringify([newsId, context.newsVersion, reason, summary, related]);
    if (attempt.current?.payload !== payload) attempt.current = { payload, id: newId('correction-request') };
    guard.current = true; setBusy(true); setError('');
    try {
      await apiService.registerNewsCorrection({ newsId, expectedVersion: context.newsVersion, reason, summary, requestId: attempt.current.id, ...(related ? { relatedCorrectionId: related } : {}) });
      setReason(''); setSummary(''); setRelated(''); attempt.current = null; await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر تسجيل التصحيح؛ المدخلات باقية'); if (err instanceof ApiError && err.status === 409) { generation.current++; setConflict(true); } }
    finally { guard.current = false; setBusy(false); }
  };
  return <section aria-label="سجل التصحيحات" className="border-t border-slate-200 py-4 space-y-3">
    <h2 className="text-base font-bold">سجل التصحيحات</h2>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {canRegister && <form onSubmit={save} className="space-y-3">
      {dirty && <p role="status" className="text-sm text-amber-800">احفظ تعديلات الخبر وراجع نسخته قبل تسجيل التصحيح.</p>}
      <button type="button" disabled={busy || dirty} onClick={() => void refresh()} className="min-h-11 px-3 inline-flex items-center gap-2 text-blue-700"><RefreshCw size={16} />مراجعة النسخة الحالية {context ? `(${context.newsVersion})` : ''}</button>
      {context && <details className="text-sm"><summary className="min-h-11 cursor-pointer">نص النسخة المحفوظة ({context.newsVersion})</summary><strong>{context.newsTitle}</strong><p className="whitespace-pre-wrap max-h-64 overflow-auto break-words">{plainText(context.newsText)}</p></details>}
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">سبب التصحيح<textarea required maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} className="block w-full border border-slate-300 rounded p-3 bg-white" /></label>
        <label className="block">ملخص التصحيح<textarea required maxLength={1000} value={summary} onChange={e => setSummary(e.target.value)} className="block w-full border border-slate-300 rounded p-3 bg-white" /></label>
        <label className="block">مرتبط بتصحيح سابق<select value={related} onChange={e => setRelated(e.target.value)} className="block w-full min-h-11 border border-slate-300 rounded px-3 bg-white"><option value="">لا يوجد</option>{context?.records.map(r => <option key={r.id} value={r.id}>{r.summary.slice(0, 80)}</option>)}</select></label>
      </fieldset>
      <button disabled={busy || dirty || conflict || !context} className="min-h-11 px-3 bg-blue-600 text-white rounded inline-flex gap-2 items-center"><Save size={16} />{busy ? 'جارٍ التسجيل...' : 'تسجيل التصحيح'}</button>
    </form>}
    <ol className="divide-y divide-slate-200">{context?.records.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(r => <li id={r.id} key={r.id} className="py-3 space-y-1 break-words"><strong>{r.summary}</strong><p>{r.reason}</p><p className="text-xs text-slate-600">{r.actorName} · {new Date(r.createdAt).toLocaleString('ar')} · نسخة {r.newsVersion}</p>{r.relatedCorrectionId && <a href={`#${r.relatedCorrectionId}`} className="text-sm text-blue-700 underline">التصحيح السابق</a>}{context.newsVersion !== r.newsVersion && !context.historyVersions.includes(r.newsVersion) && <p className="text-xs text-amber-800">النص التاريخي لهذه النسخة لم يعد متاحاً.</p>}</li>)}</ol>
    {context && !context.records.length && <p className="text-sm text-slate-500">لا توجد تصحيحات مسجلة.</p>}
  </section>;
}
