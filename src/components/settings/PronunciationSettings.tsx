import React, { useEffect, useRef, useState } from 'react';
import { Plus, Save, Pencil, Trash2, X } from 'lucide-react';
import { apiService } from '../../services/api';
import { confirmDialog } from '../../services/dialogs';
import { matchesQuery } from '../../shared/search';
import { pronunciationError, type PronunciationTerm } from '../../shared/pronunciation';
import { useLiveData } from '../../hooks/useLiveData';

export function PronunciationSettings() {
  useLiveData(['pronunciationTerms']);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Partial<PronunciationTerm> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const section = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const original = useRef<PronunciationTerm | null>(null);
  const editing = !!draft;
  useEffect(() => {
    if (editing) { original.current = draft?.id ? { ...draft } as PronunciationTerm : null; trigger.current = document.activeElement as HTMLElement; section.current?.querySelector<HTMLInputElement>('form input')?.focus(); }
    else if (trigger.current?.isConnected) trigger.current.focus();
    else if (trigger.current) section.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [editing]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (!draft || guard.current) return;
    const invalid = pronunciationError(draft); if (invalid) { setError(invalid); return; }
    guard.current = true; setBusy(true); setError('');
    try { await apiService.savePronunciationTerm(draft, original.current || undefined); setDraft(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذر الحفظ'); }
    finally { guard.current = false; setBusy(false); }
  };
  const remove = async (term: PronunciationTerm) => {
    if (guard.current || !(await confirmDialog(`حذف نطق «${term.term}»؟`))) return;
    guard.current = true; setBusy(true); setError('');
    try { await apiService.deletePronunciationTerm(term.id); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذر الحذف'); }
    finally { guard.current = false; setBusy(false); }
  };
  return <section ref={section} aria-label="قاموس النطق" className="border-t border-slate-200 pt-5 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-bold">قاموس النطق</h2><button type="button" disabled={busy} onClick={() => { setDraft({ term: '', pronunciation: '', note: '', enabled: true }); setError(''); }} className="min-h-11 px-3 inline-flex gap-2 items-center text-blue-700"><Plus size={16} />إضافة اسم للنطق</button></div>
    <input aria-label="البحث في قاموس النطق" type="search" value={query} onChange={e => setQuery(e.target.value)} className="w-full min-h-11 border border-slate-300 rounded px-3 bg-white" />
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {draft && <form onSubmit={save} className="space-y-3 border-b border-slate-200 pb-4"><fieldset disabled={busy} className="grid sm:grid-cols-2 gap-3">
      <label>الاسم<input required maxLength={200} value={draft.term || ''} onChange={e => setDraft({ ...draft, term: e.target.value })} className="block w-full min-h-11 border border-slate-300 rounded px-3 bg-white" /></label>
      <label>النطق المكتوب<input required maxLength={300} value={draft.pronunciation || ''} onChange={e => setDraft({ ...draft, pronunciation: e.target.value })} className="block w-full min-h-11 border border-slate-300 rounded px-3 bg-white" /></label>
      <label className="sm:col-span-2">ملاحظة النطق<textarea maxLength={1000} rows={2} value={draft.note || ''} onChange={e => setDraft({ ...draft, note: e.target.value })} className="block w-full border border-slate-300 rounded p-3 bg-white" /></label>
      <label className="flex gap-2 items-center"><input type="checkbox" checked={draft.enabled ?? true} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />مفعّل</label>
    </fieldset><div className="flex gap-2"><button disabled={busy} className="min-h-11 px-3 bg-blue-600 text-white rounded inline-flex items-center gap-2"><Save size={16} />{busy ? 'جارٍ الحفظ...' : 'حفظ النطق'}</button><button type="button" disabled={busy} onClick={() => setDraft(null)} className="min-h-11 px-3 inline-flex items-center gap-2"><X size={16} />إلغاء</button></div></form>}
    <ul className="divide-y divide-slate-200">{apiService.getPronunciationTerms().filter(t => matchesQuery(query, t.term, t.pronunciation, t.note)).map(t => <li key={t.id} className="py-3 flex items-start justify-between gap-2"><div className="min-w-0 break-words"><strong>{t.term}</strong><p>{t.pronunciation}</p><p className="text-sm text-slate-600">{t.note}</p><span className="text-xs text-slate-500">{t.enabled ? 'مفعّل' : 'معطّل'} · {t.updatedAt ? new Date(t.updatedAt).toLocaleDateString('ar') : ''}</span></div><div className="flex shrink-0"><button type="button" disabled={busy} aria-label={`تعديل نطق ${t.term}`} title="تعديل" onClick={() => { setDraft({ ...t }); setError(''); }} className="w-11 h-11 inline-flex justify-center items-center"><Pencil size={16} /></button><button type="button" disabled={busy} aria-label={`حذف نطق ${t.term}`} title="حذف" onClick={() => void remove(t)} className="w-11 h-11 inline-flex justify-center items-center text-rose-700"><Trash2 size={16} /></button></div></li>)}</ul>
  </section>;
}
