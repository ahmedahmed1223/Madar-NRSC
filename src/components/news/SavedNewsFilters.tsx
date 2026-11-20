import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bookmark, Pencil, Save, Settings2, Trash2, RefreshCw } from 'lucide-react';
import { Modal } from '../common/Modal';
import { apiService } from '../../services/api';
import { confirmDialog } from '../../services/dialogs';
import { notify } from '../../services/notify';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { newId } from '../../shared/ids';
import { SavedFilterUnknownOutcome } from '../../services/savedNewsFilterTransport';
import { savedNewsFilterError, type SavedNewsFilterDefinition, type SavedNewsFilterInput, type SavedNewsFilterRow } from '../../shared/savedNewsFilters';

interface Props {
  userId: string;
  definition: SavedNewsFilterDefinition;
  onApply: (definition: SavedNewsFilterDefinition) => void;
}

const control = 'min-h-11 px-3 border border-slate-300 rounded-lg bg-white text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50';
// Confirmed definitions only, for navigation during this tab's offline visit.
let confirmedCache: { userId: string; rows: SavedNewsFilterRow[] } | null = null;
const validRows = (rows: SavedNewsFilterRow[], userId: string) => rows.filter(row => row.d?.ownerId === userId && row.id === row.d.id && Number.isInteger(row.v) && row.v > 0 && !savedNewsFilterError(row.d)).slice(0, 30);

export function SavedNewsFilters({ userId, definition, onApply }: Props) {
  const { isOnline } = useOnlineStatus();
  const [rows, setRows] = useState<SavedNewsFilterRow[]>(() => {
    if (confirmedCache?.userId === userId) return validRows(confirmedCache.rows, userId);
    confirmedCache = null;
    return [];
  });
  const [selected, setSelected] = useState('');
  const [manage, setManage] = useState(false);
  const [draft, setDraft] = useState<SavedNewsFilterInput | null>(null);
  const [baseV, setBaseV] = useState<number | undefined>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  const loadGeneration = useRef(0);
  const reloadButton = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const wasPending = useRef(false);
  const mutation = useRef<AbortController | null>(null);
  const unknown = useRef(new Set<string>());
  const rememberRows = (next: SavedNewsFilterRow[]) => {
    const safe = validRows(next, userId);
    confirmedCache = { userId, rows: safe };
    setRows(safe);
  };
  useLayoutEffect(() => {
    const finished = wasPending.current && !pending;
    wasPending.current = pending;
    if (finished) (draft ? nameInput.current : manage ? reloadButton.current : opener.current)?.focus();
  }, [pending, draft, manage]);
  const closeModal = () => {
    if (pending) { mutation.current?.abort(); return; }
    setManage(false); setDraft(null); setError('');
    requestAnimationFrame(() => opener.current?.isConnected && opener.current.focus());
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++loadGeneration.current; mutation.current?.abort(); }; }, []);

  const reload = async () => {
    if (mutation.current) return;
    const generation = ++loadGeneration.current;
    setLoading(true);
    try {
      const next = await apiService.getSavedNewsFilterRows();
      if (!mounted.current || generation !== loadGeneration.current) return;
      rememberRows(next);
      setError('');
    } catch (e) {
      if (mounted.current && generation === loadGeneration.current) setError(e instanceof Error ? e.message : 'تعذر تحميل الفلاتر');
    } finally {
      if (mounted.current && generation === loadGeneration.current) setLoading(false);
    }
  };
  useEffect(() => { if (isOnline) void reload(); else setLoading(false); }, [isOnline]);

  const openDraft = (row?: SavedNewsFilterRow) => {
    if (!manage) opener.current = document.activeElement as HTMLElement;
    setManage(false);
    setError('');
    setBaseV(row?.v);
    setDraft(row ? { id: row.id, schemaVersion: 1, name: row.d.name, definition: { ...row.d.definition }, pinned: row.d.pinned }
      : { id: newId('filter'), schemaVersion: 1, name: '', definition: { ...definition }, pinned: false });
  };
  const save = async () => {
    if (!draft || pending || !isOnline) return;
    const validation = savedNewsFilterError(draft);
    if (validation) { setError(validation); return; }
    setPending(true); setError('');
    ++loadGeneration.current;
    const controller = new AbortController(); mutation.current = controller;
    const key = `save:${draft.id}`;
    try {
      let row: SavedNewsFilterRow | undefined;
      if (unknown.current.has(key)) {
        const latest = (await apiService.getSavedNewsFilterRows(controller.signal)).find(item => item.id === draft.id);
        const sameDefinition = latest && Object.keys(draft.definition).every(field => field === 'selectedSource' || latest.d.definition[field] === draft.definition[field])
          && (latest.d.definition.selectedSource || 'ALL') === (draft.definition.selectedSource || 'ALL');
        if (latest && sameDefinition && latest.d.name === draft.name.trim() && latest.d.pinned === draft.pinned) row = latest;
        else if ((latest && latest.v !== baseV) || (!latest && baseV !== undefined)) throw new Error('تغيرت النسخة؛ أعد تحميل الفلاتر وراجعها قبل الحفظ');
      }
      row ??= await apiService.saveSavedNewsFilter(draft, baseV, controller.signal);
      if (!mounted.current) return;
      ++loadGeneration.current;
      rememberRows([...rows.filter(item => item.id !== row.id), row]);
      unknown.current.delete(key);
      setDraft(null);
      notify({ message: 'حُفظ الفلتر', type: 'success' });
    } catch (e) {
      if (e instanceof SavedFilterUnknownOutcome) unknown.current.add(key);
      if (mounted.current) setError(`${e instanceof Error ? e.message : 'تعذر الحفظ'}. احتفظنا بالتعديل؛ عند تعارض النسخ أغلق النافذة وأعد تحميل الفلاتر ثم راجع النسخة الحالية.`);
    } finally { mutation.current = null; if (mounted.current) { setPending(false); setLoading(false); } }
  };
  const remove = async (row: SavedNewsFilterRow) => {
    if (pending || !isOnline) return;
    if (!await confirmDialog({ title: 'حذف الفلتر', message: `حذف الفلتر «${row.d.name}»؟ لا يحذف الأخبار.`, confirmLabel: 'حذف', danger: true })) return;
    if (!mounted.current) return;
    setPending(true); setError(''); ++loadGeneration.current;
    const controller = new AbortController(); mutation.current = controller;
    const key = `delete:${row.id}`;
    try {
      let alreadyDeleted = false;
      if (unknown.current.has(key)) {
        const latest = (await apiService.getSavedNewsFilterRows(controller.signal)).find(item => item.id === row.id);
        alreadyDeleted = !latest;
        if (latest && latest.v !== row.v) throw new Error('تغيرت النسخة؛ أعد تحميل الفلاتر قبل الحذف');
      }
      if (!alreadyDeleted) await apiService.deleteSavedNewsFilter(row.id, row.v, controller.signal);
      if (!mounted.current) return;
      ++loadGeneration.current;
      rememberRows(rows.filter(item => item.id !== row.id));
      unknown.current.delete(key);
      if (selected === row.id) setSelected('');
      notify({ message: 'حُذف الفلتر', type: 'success' });
    } catch (e) { if (e instanceof SavedFilterUnknownOutcome) unknown.current.add(key); if (mounted.current) setError(e instanceof Error ? e.message : 'تعذر حذف الفلتر'); }
    finally { mutation.current = null; if (mounted.current) { setPending(false); setLoading(false); } }
  };
  const sorted = [...rows].sort((a, b) => Number(b.d.pinned) - Number(a.d.pinned) || a.d.name.localeCompare(b.d.name, 'ar'));
  const offlineReason = !isOnline ? 'اتصل بالخادم لحفظ الفلاتر أو حذفها' : '';
  return <section aria-label="فلاتر الأخبار الشخصية" className="space-y-2">
    <div className="grid grid-cols-2 gap-2 items-center sm:flex sm:flex-wrap">
      <div className="col-span-full flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
        <label htmlFor="saved-news-filter" className="text-xs text-slate-700">الفلاتر المحفوظة</label>
        <select id="saved-news-filter" value={selected} disabled={loading && !rows.length} className={`${control} min-w-0 w-full sm:w-auto sm:max-w-52`} onChange={e => {
          setSelected(e.target.value);
          const row = rows.find(item => item.id === e.target.value);
          if (row) onApply({ ...row.d.definition });
        }}>
          <option value="">{loading ? 'جارٍ التحميل…' : 'اختر فلترًا'}</option>
          {sorted.map(row => <option key={row.id} value={row.id}>{row.d.name}</option>)}
        </select>
      </div>
      <button type="button" className={control} disabled={!isOnline || pending || loading || rows.length >= 30} title={offlineReason || (rows.length >= 30 ? 'الحد الأقصى 30 فلترًا' : 'حفظ الفلتر الحالي')} onClick={() => openDraft()}><Save size={16} />حفظ الفلتر الحالي</button>
      <button type="button" className={control} onClick={() => { opener.current = document.activeElement as HTMLElement; setError(''); setManage(true); }}><Settings2 size={16} />إدارة الفلاتر</button>
    </div>
    {offlineReason && <p role="status" className="text-xs text-amber-700">{offlineReason}؛ يمكنك تطبيق الفلاتر المحمّلة على البيانات المتاحة.</p>}
    {rows.length >= 30 && <p className="text-xs text-slate-600">وصلت إلى الحد الأقصى: 30 فلترًا. احذف فلترًا لإضافة آخر.</p>}
    {error && !draft && !manage && <p role="alert" className="text-sm text-rose-700">{error} <button type="button" disabled={!isOnline || pending} className={control} onClick={() => void reload()}>إعادة التحميل</button></p>}
    <Modal isOpen={manage || !!draft} onClose={closeModal} title={draft ? baseV === undefined ? 'حفظ فلتر الأخبار' : 'تعديل الفلتر' : 'إدارة الفلاتر'} maxWidth="lg">
      {pending && <div className="mb-3 flex flex-wrap items-center gap-2"><p role="status" className="text-sm">بانتظار تأكيد الخادم؛ إيقاف الانتظار لا يلغي عملية وصلت إليه.</p><button type="button" className={control} onClick={() => mutation.current?.abort()}>إيقاف الانتظار</button></div>}
      {error && <p role="alert" className="text-sm text-rose-700 mb-3">{error}</p>}
      {offlineReason && <p role="status" className="text-xs text-amber-700 mb-3">{offlineReason}</p>}
      {draft ? <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save(); }}>
        <label className="block text-sm">اسم الفلتر<input ref={nameInput} autoFocus aria-label="اسم الفلتر" required maxLength={80} disabled={pending} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className="mt-2 w-full min-h-11 px-3 border border-slate-300 rounded-lg bg-white" /></label>
        <label className="flex items-center gap-2 text-sm min-h-11"><input type="checkbox" checked={draft.pinned} disabled={pending} onChange={e => setDraft({ ...draft, pinned: e.target.checked })} />تثبيت الفلتر</label>
        {baseV !== undefined && <button type="button" className={control} disabled={pending} onClick={() => setDraft({ ...draft, definition: { ...definition } })}>استخدام الفلاتر الحالية</button>}
        <div className="flex gap-2"><button type="submit" className="min-h-11 px-3 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50" disabled={!isOnline || pending}>{pending ? 'جارٍ الحفظ…' : 'حفظ'}</button><button type="button" className={control} disabled={pending} onClick={closeModal}>إلغاء</button></div>
      </form> : <div className="space-y-3">
        <button ref={reloadButton} type="button" className={control} disabled={!isOnline || loading || pending} onClick={() => void reload()}><RefreshCw size={16} />إعادة تحميل الفلاتر</button>
        {!rows.length && <p className="text-sm text-slate-600">لا توجد فلاتر محفوظة.</p>}
        <ul className="divide-y divide-slate-200">{sorted.map(row => <li key={row.id} className="flex items-center justify-between gap-2 py-2">
          <span className="min-w-0 break-words text-sm flex items-center gap-2">{row.d.pinned && <Bookmark size={16} aria-label="مثبت" className="shrink-0" />}{row.d.name}</span>
          <div className="flex shrink-0 gap-1"><button type="button" title="تعديل الفلتر" aria-label="تعديل الفلتر" className={control} disabled={!isOnline || pending} onClick={() => openDraft(row)}><Pencil size={16} /></button><button type="button" title="حذف الفلتر" aria-label="حذف الفلتر" className={control} disabled={!isOnline || pending} onClick={() => void remove(row)}><Trash2 size={16} /></button></div>
        </li>)}</ul>
      </div>}
    </Modal>
  </section>;
}
