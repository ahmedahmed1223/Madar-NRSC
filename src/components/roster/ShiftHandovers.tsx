import { createDepartmentLabeler } from '../../services/departmentLabels';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus, Save, Send, Check, RefreshCw, Bell, ExternalLink, Trash2, Square } from 'lucide-react';
import type { User } from '../../types';
import { apiService } from '../../services/api';
import { ApiError } from '../../services/http';
import { HandoverUnknownOutcome, matchingHandoverDraft } from '../../services/handoverTransport';
import { RbacService } from '../../services/rbacService';
import { confirmDialog } from '../../services/dialogs';
import { newId } from '../../shared/ids';
import { DEPARTMENTS, departmentName, isDepartmentId } from '../../shared/departments';
import { SHIFTS, shiftName } from '../../shared/roster';
import { stationWorkDay } from '../../shared/myWork';
import { handoverDraftError, personalHandoverReceiptState, type HandoverDraftInput, type HandoverRow, type HandoverReference } from '../../shared/shiftHandovers';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useFormDraft } from '../../hooks/useFormDraft';
import { Modal } from '../common/Modal';
import { copyTextToClipboard } from '../../services/clipboard';

const control = 'min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
const button = 'min-h-11 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50';
const blank = (user: User): HandoverDraftInput => {
  const day = stationWorkDay(new Date(), apiService.getSettings().defaultTimezone);
  return { id: newId('handover'), schemaVersion: 1, departmentId: isDepartmentId(user.departmentId) ? user.departmentId : 'newsroom', sourceDate: day, sourceShift: 'MORNING', recipientDate: day, recipientShift: 'EVENING', title: '', note: '', references: [] };
};
const editable = (row: HandoverRow): HandoverDraftInput => {
  const { id, schemaVersion, departmentId, sourceDate, sourceShift, recipientDate, recipientShift, title, note, supersedesId } = row.d;
  return { id, schemaVersion, departmentId, sourceDate, sourceShift, recipientDate, recipientShift, title, note, recipientUserId: row.d.recipientUserId, ...(supersedesId ? { supersedesId } : {}), references: row.d.references.flatMap(ref => ref.available ? [{ collection: ref.collection, id: ref.id, note: ref.note }] : []) };
};
function referenceChoices(user: User): { reference: HandoverReference; title: string }[] {
  const can = (code: string) => RbacService.hasPermission(user, code);
  const sources = [
    ['news', can('news.view') ? apiService.getNews() : []],
    ['bulletins', can('rundown.view') || can('bulletins.edit') ? apiService.getBulletins() : []],
    ['bulletinStories', can('rundown.view') || can('bulletins.edit') ? apiService.getBulletinStories() : []],
    ['episodes', can('programs.view') ? apiService.getEpisodes() : []],
    ['tasks', can('tasks.view') ? apiService.getTasks() : []],
    ['productionCards', can('cards.view') ? apiService.getCards() : []],
    ['requests', can('tasks.view') ? apiService.getRequests() : []],
  ] as const;
  return sources.flatMap(([collection, rows]) => rows.filter((r: any) => !r.deletedAt).map((r: any) => ({ reference: { collection, id: r.id, note: '' }, title: String(r.title || r.slug || r.name || 'مرجع') })));
}

interface ShiftHandoversProps { currentUser: User; onNavigate: (url: string) => void; focusId?: string }

export const ShiftHandovers: React.FC<ShiftHandoversProps> = props => <ShiftHandoversContent key={`${props.currentUser.id}:${props.focusId ?? ''}`} {...props} />;
function ShiftHandoversContent({ currentUser, onNavigate, focusId }: ShiftHandoversProps) {
  const { isOnline } = useOnlineStatus();
  const canView = RbacService.hasPermission(currentUser, 'handover.view');
  const canPublish = canView && RbacService.hasPermission(currentUser, 'handover.publish');
  const labelDepartment = createDepartmentLabeler();
  const [rows, setRows] = useState<HandoverRow[]>([]);
  const [listReady, setListReady] = useState(false);
  const [awaitingMe, setAwaitingMe] = useState(false);
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [opening, setOpening] = useState(false);
  const [selected, setSelected] = useState<HandoverRow | null>(null);
  const [draft, setDraft] = useState<HandoverDraftInput | null>(null);
  const [baseV, setBaseV] = useState<number | undefined>();
  const [reference, setReference] = useState('');
  const [receiptNote, setReceiptNote] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const readRef = useRef<AbortController | null>(null);
  const unknown = useRef<{ action: string; id: string; draft?: HandoverDraftInput; baseV?: number; lastReminderAt?: string } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const reloadRef = useRef<HTMLButtonElement>(null);
  const dialogWasOpen = useRef(false);
  const dialogOpen = !!selected || !!draft;
  const editingDraft = !!draft;
  const messageRef = useRef<HTMLParagraphElement>(null);
  const clearConfirmedDraft = useRef(false);
  const session = useFormDraft(`handover:${currentUser.id}:${selected?.id || 'new'}`, !!draft, { draft, baseV: baseV ?? null }, value => {
    if (value.draft && !handoverDraftError({ ...value.draft, title: value.draft.title || 'استعادة' })) {
      setDraft(value.draft); setBaseV(value.baseV ?? undefined);
    }
  });
  useEffect(() => {
    if (!canView || !isOnline) return;
    const controller = new AbortController();
    apiService.getShiftHandovers(controller.signal).then(rows => {
      if (!controller.signal.aborted) { setRows(rows); setListReady(true); }
    }).catch(error => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => { controller.abort(); abortRef.current?.abort(); readRef.current?.abort(); };
  }, [currentUser.id, canView, isOnline]);
  useLayoutEffect(() => {
    if (dialogOpen && dialogWasOpen.current && !pending) {
      (editingDraft ? titleRef.current : reloadRef.current)?.focus({ preventScroll: true });
    }
    dialogWasOpen.current = dialogOpen;
  }, [dialogOpen, editingDraft, pending]);
  useLayoutEffect(() => { if (message && !pending) messageRef.current?.scrollIntoView({ block: 'nearest' }); }, [message, pending]);
  useLayoutEffect(() => {
    if (!pending && clearConfirmedDraft.current) { clearConfirmedDraft.current = false; session.clearDraft(); }
  }, [pending, selected?.v, baseV, draft]);
  const reload = async () => {
    try {
      const values = await apiService.getShiftHandovers(); setRows(values); setListReady(true); setMessage('');
      if (selected && !draft) setSelected(values.find(r => r.id === selected.id) || null);
    } catch (error: any) { setMessage(error.message); }
  };
  const accept = (row: HandoverRow) => {
    clearConfirmedDraft.current = true;
    setRows(values => [row, ...values.filter(r => r.id !== row.id)]);
    setSelected(row);
    if (row.d.state === 'DRAFT') { setBaseV(row.v); session.clearDraft(); }
    else { session.clearDraft(); setDraft(null); }
  };
  const run = async (action: 'save' | 'publish' | 'ack' | 'delete' | 'remind') => {
    if (pending || !isOnline) return;
    const id = draft?.id || selected?.id;
    if (!id) return;
    setMessage(''); setPending(true); setConflict(false);
    const controller = new AbortController(); abortRef.current = controller;
    const snapshot = { action, id, draft: draft ? structuredClone(draft) : undefined, baseV: baseV ?? selected?.v, lastReminderAt: selected?.lastReminderAt };
    try {
      const uncertain = unknown.current;
      let row: HandoverRow | undefined;
      if (!uncertain && action === 'save' && draft && baseV === undefined) {
        // A restored create may have committed before refresh discarded the request state.
        try { row = await apiService.getShiftHandover(id, controller.signal); }
        catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
        if (row) {
          if (!matchingHandoverDraft(row, draft)) { setConflict(true); throw new Error('توجد نسخة مختلفة على الخادم؛ راجع النسخة الحالية'); }
          accept(row); setMessage('تأكدت نتيجة العملية السابقة من الخادم'); return;
        }
      }
      if (uncertain) {
        if (uncertain.id !== id || uncertain.action !== action) throw new Error('راجع نتيجة العملية السابقة قبل تنفيذ إجراء مختلف');
        try { row = await apiService.getShiftHandover(id, controller.signal); }
        catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
        let published = row?.d.state === 'PUBLISHED';
        if (!row && action === 'publish') {
          try { published = await apiService.isShiftHandoverPublished(id, controller.signal); }
          catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
        }
        const confirmed = action === 'save' ? row && uncertain.draft && matchingHandoverDraft(row, uncertain.draft)
          : action === 'publish' ? published
          : action === 'ack' ? row?.receipts.some(r => r.userId === currentUser.id)
          : action === 'delete' ? !row
          : row?.lastReminderAt && row.lastReminderAt !== uncertain.lastReminderAt;
        if (confirmed) {
          if (action === 'save' && uncertain.draft && JSON.stringify(uncertain.draft) !== JSON.stringify(draft)) {
            setConflict(true);
            throw new Error('تغيرت الحقول بعد العملية السابقة؛ راجع النسخة الحالية قبل تأكيد الحفظ');
          }
          unknown.current = null;
          if (row) accept(row); else { setSelected(null); setDraft(null); session.clearDraft(); setRows(values => values.filter(r => r.id !== id)); }
          setMessage('تأكدت نتيجة العملية السابقة من الخادم'); return;
        }
        if ((row && row.v !== uncertain.baseV) || (!row && uncertain.baseV !== undefined && action !== 'delete')) { setConflict(true); throw new Error('تغير التسليم؛ راجع النسخة الحالية قبل إعادة المحاولة'); }
        if (action === 'save' && uncertain.draft && JSON.stringify(uncertain.draft) !== JSON.stringify(draft)) throw new Error('تغيرت الحقول أثناء انتظار النتيجة؛ راجع النسخة الحالية أولاً');
        unknown.current = null;
      }
      if (action === 'save' && draft) { row = await apiService.saveShiftHandover(draft, baseV, controller.signal); setMessage('حُفظت المسودة على الخادم'); }
      else if (action === 'publish' && selected) {
        const recipient = selected.d.recipientUserId ? apiService.getUserById(selected.d.recipientUserId)?.fullName || 'الزميل المحدد' : 'أعضاء الوردية حسب الجدول';
        if (!await confirmDialog({ title: 'نشر تسليم الوردية', message: `يُطلب تأكيد الاستلام من ${recipient}. يظهر التسليم لقسم ${departmentName(selected.d.departmentId)}، ${selected.d.recipientDate}، الوردية ${shiftName(selected.d.recipientShift)}. عدد المراجع: ${selected.d.references.length}.`, confirmLabel: 'نشر التسليم' })) return;
        row = await apiService.publishShiftHandover(id, selected.v, controller.signal); setMessage('نُشر التسليم على الخادم');
      } else if (action === 'ack') { row = await apiService.acknowledgeShiftHandover(id, receiptNote, controller.signal); setMessage('تأكد استلام الوردية على الخادم'); }
      else if (action === 'remind') { row = await apiService.remindShiftHandover(id, controller.signal); setMessage('تأكد إرسال التذكير للمستلمين المؤهلين'); }
      else if (action === 'delete' && selected) {
        if (!await confirmDialog({ title: 'حذف المسودة', message: 'حذف مسودة تسليم الوردية؟', confirmLabel: 'حذف', danger: true })) return;
        await apiService.deleteShiftHandover(id, selected.v, controller.signal); session.clearDraft(); setSelected(null); setDraft(null); setRows(values => values.filter(r => r.id !== id)); setMessage('حُذفت المسودة');
      }
      if (row) accept(row);
      unknown.current = null;
    } catch (error: any) {
      if (error instanceof HandoverUnknownOutcome) unknown.current = snapshot;
      if (error instanceof ApiError && error.status === 409) setConflict(true);
      setMessage(error.message || 'تعذر تأكيد العملية');
    } finally { setPending(false); abortRef.current = null; }
  };
  const open = useCallback(async (id: string) => {
    readRef.current?.abort();
    const controller = new AbortController();
    readRef.current = controller;
    setOpening(true);
    setMessage(''); setConflict(false); unknown.current = null;
    try {
      const fresh = await apiService.getShiftHandover(id, controller.signal);
      if (controller.signal.aborted) return;
      setSelected(fresh); setBaseV(fresh.v); setReceiptNote('');
      setDraft(fresh.d.state === 'DRAFT' && fresh.d.references.every(r => r.available) ? editable(fresh) : null);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof ApiError && [403, 404].includes(error.status) ? 'تسليم الوردية المطلوب غير متاح.' : 'تعذر فتح تسليم الوردية. أعد المحاولة.');
    } finally {
      if (!controller.signal.aborted) setOpening(false);
    }
  }, []);
  useEffect(() => {
    if (!focusId || !canView || !isOnline) return;
    void open(focusId);
    return () => { readRef.current?.abort(); setOpening(false); };
  }, [focusId, canView, isOnline, open]);
  const create = () => { readRef.current?.abort(); setOpening(false); setMessage(''); setConflict(false); setSelected(null); setDraft(blank(currentUser)); setBaseV(undefined); unknown.current = null; };
  const close = () => {
    if (pending) { abortRef.current?.abort(); return; }
    void session.close(() => { setSelected(null); setDraft(null); if (focusId) onNavigate('/roster/handover'); });
  };
  const reviewCurrent = async () => {
    const id = selected?.id || draft?.id;
    if (!id) { await reload(); return; }
    if (draft && !await confirmDialog({ title: 'مراجعة النسخة الحالية', message: 'تحميل نسخة الخادم بدلاً من الحقول المحلية؟', confirmLabel: 'تحميل النسخة' })) return;
    try {
      const row = await apiService.getShiftHandover(id);
      session.clearDraft();
      try { localStorage.removeItem(`madar-form-draft:v1:handover:${currentUser.id}:${id}`); } catch { /* Keep confirmed read usable. */ }
      unknown.current = null; setConflict(false); clearConfirmedDraft.current = true;
      setSelected(row); setBaseV(row.v); setDraft(row.d.state === 'DRAFT' && row.d.references.every(r => r.available) ? editable(row) : null);
      setMessage('حُمّلت النسخة الحالية من الخادم');
    } catch (error: any) { setMessage(error.message); }
  };
  const choices = referenceChoices(currentUser);
  const pendingReceiptRows = rows.filter(row => personalHandoverReceiptState(row, currentUser.id) === 'pending');
  const visibleRows = (awaitingMe ? pendingReceiptRows : rows).filter(row => departmentFilter === 'ALL' || row.d.departmentId === departmentFilter);
  const copySummary = async (sources: HandoverRow[], trigger: HTMLButtonElement) => {
    const text = sources.map(row => [row.d.title, departmentName(row.d.departmentId), `${row.d.recipientDate} · ${shiftName(row.d.recipientShift)}`, row.d.note,
      ...row.d.references.flatMap(ref => ref.available ? [ref.title + (ref.note ? ` — ${ref.note}` : '')] : ['مرجع غير متاح'])].filter(Boolean).join('\n')).join('\n\n');
    setMessage(await copyTextToClipboard(text || 'لا توجد تسليمات معروضة.', trigger) ? 'نُسخ ملخص التسليم.' : 'تعذّر نسخ ملخص التسليم.');
  };
  const receiptState = selected ? personalHandoverReceiptState(selected, currentUser.id) : null;
  const update = (value: Partial<HandoverDraftInput>) => setDraft(previous => previous ? { ...previous, ...value } : previous);
  const status = <>{message && <p ref={messageRef} role="status" className="text-sm text-slate-700 break-words border-s-2 border-amber-500 ps-3 py-2">{message}</p>}{!isOnline && <p role="status" className="text-sm text-amber-800">غير متصل؛ الحفظ والنشر والاستلام تحتاج تأكيد الخادم.</p>}</>;
  if (!canView) return <p role="status" className="text-sm text-slate-600">{focusId ? 'تسليم الوردية المطلوب غير متاح.' : 'تحتاج صلاحية قراءة تسليم الوردية؛ النشر وحده لا يمنح حق القراءة.'}</p>;
  return <section className="space-y-3 min-w-0" aria-label="تسليم الوردية">
    <div className="flex flex-wrap justify-between gap-2"><h2 className="text-base font-bold text-slate-900">تسليم الوردية</h2><div className="flex gap-2"><button className={button} title="تحديث التسليمات" aria-label="تحديث التسليمات" disabled={pending || !isOnline} onClick={reload}><RefreshCw size={18} /></button><button className={button} disabled={!canPublish || pending || !isOnline} title={!canPublish ? 'تحتاج صلاحية النشر والقراءة' : undefined} onClick={create}><Plus size={18} />إنشاء تسليم</button></div></div>
    {!selected && !draft && status}
    <div className="flex flex-wrap gap-2">
      <select aria-label="تصفية تسليم الوردية بالقسم" value={departmentFilter} onChange={event => setDepartmentFilter(event.target.value)} className={`${control} sm:w-auto`}>
        <option value="ALL">كل الأقسام</option>
        {DEPARTMENTS.map(department => <option key={department.id} value={department.id}>{labelDepartment(department)}</option>)}
      </select>
      <button type="button" className={button} onClick={(event) => void copySummary(visibleRows, event.currentTarget)}>نسخ الملخص</button>
    </div>
    {opening && <p role="status" className="text-sm text-slate-600">جارٍ تحميل تسليم الوردية…</p>}
    {focusId && !opening && !dialogOpen && <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!isOnline} onClick={() => open(focusId)}>إعادة فتح التسليم المحدد</button><button type="button" className={button} onClick={() => onNavigate('/roster/handover')}>عرض قائمة التسليمات</button></div>}
    {listReady && <label className="min-h-11 inline-flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={awaitingMe} onChange={event => setAwaitingMe(event.target.checked)} />بانتظار استلامي ({pendingReceiptRows.length})</label>}
    {!listReady && isOnline && !opening && !message && <p role="status" className="text-sm text-slate-600">جارٍ تحميل التسليمات…</p>}
    {listReady && !visibleRows.length && <p className="text-sm text-slate-500 py-4">{awaitingMe ? 'لا توجد تسليمات تنتظر تأكيد استلامك.' : 'لا توجد تسليمات متاحة حالياً.'}</p>}
    <ul className="divide-y divide-slate-200">{visibleRows.map(row => {
      const personalState = personalHandoverReceiptState(row, currentUser.id);
      return <li key={row.id} className="py-3 flex flex-wrap items-center gap-3"><button className="min-h-11 flex-1 min-w-0 text-right text-sm font-bold text-blue-700 break-words disabled:opacity-60" disabled={opening || !isOnline} onClick={() => open(row.id)}>{row.d.title}</button><div className="text-xs text-slate-600 break-words">{departmentName(row.d.departmentId)} · {row.d.recipientDate} · {shiftName(row.d.recipientShift)}<br />{row.d.authorName} · {row.d.state === 'DRAFT' ? 'مسودة خاصة' : `منشور · ${row.receipts.length} استلام`}</div>{personalState && <span className={`text-xs font-semibold ${personalState === 'pending' ? 'text-amber-800' : 'text-emerald-700'}`}>{personalState === 'pending' ? 'ينتظر استلامك' : 'أكدتَ الاستلام'}</span>}</li>;
    })}</ul>
    <Modal isOpen={dialogOpen} initialFocusRef={editingDraft ? titleRef : reloadRef} title={draft ? 'مسودة تسليم الوردية' : selected?.d.title || 'تسليم الوردية'} onClose={close} maxWidth="2xl">
      <div className="space-y-4 min-w-0">{status}
        {session.recovered && <p role="status" className="text-sm text-amber-800">استُعيدت الحقول من هذا الجهاز؛ ليست تأكيداً للحفظ على الخادم.</p>}
        {session.error && draft && <p role="status" className="text-sm text-red-700">تعذر حفظ نسخة الاستعادة على الجهاز؛ أبقِ النافذة مفتوحة حتى تأكيد الحفظ.</p>}
        {draft ? <fieldset disabled={pending} className="space-y-3 min-w-0">
          <label className="block text-sm font-semibold">عنوان التسليم<input ref={titleRef} className={control} maxLength={120} value={draft.title} onChange={e => update({ title: e.target.value })} /></label>
          <label className="block text-sm font-semibold">القسم<select aria-label="القسم" className={control} value={draft.departmentId} onChange={e => update({ departmentId: e.target.value as any })}>{DEPARTMENTS.map(d => <option key={d.id} value={d.id}>{labelDepartment(d)}</option>)}</select></label>
          <label className="block text-sm font-semibold">مستلم التسليم
            <select className={control} value={draft.recipientUserId || ''} onChange={e => update({ recipientUserId: e.target.value || undefined })}>
              <option value="">أعضاء الوردية المستلمة حسب الجدول</option>
              {apiService.getUsers().filter(user => user.id !== currentUser.id && user.isActive && !user.deletedAt && RbacService.hasPermission(user, 'handover.view')).map(user =>
                <option key={user.id} value={user.id}>{user.fullName}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-sm font-semibold">تاريخ الوردية الصادرة<input className={control} type="date" value={draft.sourceDate} onChange={e => update({ sourceDate: e.target.value })} /></label>
            <label className="block text-sm font-semibold">الوردية الصادرة<select className={control} value={draft.sourceShift} onChange={e => update({ sourceShift: e.target.value as any })}>{SHIFTS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label className="block text-sm font-semibold">تاريخ الوردية المستلمة<input className={control} type="date" value={draft.recipientDate} onChange={e => update({ recipientDate: e.target.value })} /></label>
            <label className="block text-sm font-semibold">الوردية المستلمة<select aria-label="الوردية المستلمة" className={control} value={draft.recipientShift} onChange={e => update({ recipientShift: e.target.value as any })}>{SHIFTS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          </div>
          <label className="block text-sm font-semibold">ملاحظات القسم<textarea className={control} rows={4} maxLength={2000} value={draft.note} onChange={e => update({ note: e.target.value })} /></label>
          <label className="block text-sm font-semibold">اختيار مرجع<select className={control} value={reference} onChange={e => setReference(e.target.value)}><option value="">اختيار</option>{choices.filter(c => !draft.references.some(r => r.collection === c.reference.collection && r.id === c.reference.id)).map(c => <option key={`${c.reference.collection}:${c.reference.id}`} value={`${c.reference.collection}:${c.reference.id}`}>{c.title}</option>)}</select></label>
          <button type="button" className={button} disabled={!reference || draft.references.length >= 30} onClick={() => { const choice = choices.find(c => `${c.reference.collection}:${c.reference.id}` === reference); if (choice) update({ references: [...draft.references, choice.reference] }); setReference(''); }}><Plus size={18} />إضافة المرجع</button>
          {draft.references.map((ref, index) => <div key={`${ref.collection}:${ref.id}`} className="border-b border-slate-200 py-2 space-y-2"><div className="flex items-center gap-2"><span className="text-sm flex-1 min-w-0 break-words">{choices.find(c => c.reference.id === ref.id && c.reference.collection === ref.collection)?.title || 'مرجع غير متاح حالياً'}</span><button className={button} aria-label={`حذف المرجع ${index + 1}`} title="حذف المرجع" onClick={() => update({ references: draft.references.filter((_, i) => i !== index) })}><Trash2 size={18} /></button></div><label className="block text-sm">ملاحظة المرجع {index + 1}<textarea className={control} maxLength={500} value={ref.note} onChange={e => update({ references: draft.references.map((r, i) => i === index ? { ...r, note: e.target.value } : r) })} /></label></div>)}
        </fieldset> : selected && <div className="space-y-3"><p className="text-sm text-slate-600">{departmentName(selected.d.departmentId)} · {selected.d.recipientDate} · {shiftName(selected.d.recipientShift)} · {selected.d.authorName}{selected.d.publishedAt ? ` · ${new Date(selected.d.publishedAt).toLocaleString('ar')}` : ''}</p><p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{selected.d.note}</p><ul className="space-y-2">{selected.d.references.map((ref, i) => <li key={i} className="text-sm break-words">{ref.available ? <><button className={`${button} text-blue-700`} onClick={() => {
          if (ref.collection === 'bulletinStories') { const story = apiService.getBulletinStories().find(s => s.id === ref.id); if (!story) { setMessage('المرجع غير متاح حالياً'); return; } try { sessionStorage.setItem('madar-open-bulletin-story', ref.id); } catch { /* Navigation remains available. */ } onNavigate(`/bulletins/${encodeURIComponent(story.bulletinId)}`); }
          else onNavigate(`/${ref.collection === 'productionCards' ? 'cards' : ref.collection}/${encodeURIComponent(ref.id)}`);
        }}><ExternalLink size={16} />{ref.title}</button><p className="whitespace-pre-wrap">{ref.note}</p>
          {ref.work && <dl className="mt-1 grid gap-1 text-sm">
            <div><dt className="inline font-semibold">العمل المفتوح · </dt><dd className="inline">{ref.work.open ? `${ref.work.openSteps} مهام مفتوحة` : 'انتهى العمل على التكليف'}</dd></div>
            {ref.work.openWork.length > 0 && <div><dt className="sr-only">المهام المتبقية</dt><dd><ul className="list-disc space-y-0.5 ps-5">{ref.work.openWork.map((text, index) => <li key={index}>{text}</li>)}</ul></dd></div>}
            {ref.work.latestUpdate && <div><dt className="inline font-semibold">آخر إفادة · </dt><dd className="inline">{ref.work.latestUpdate}</dd></div>}
            {ref.work.nearestDueAt && <div><dt className="inline font-semibold">أقرب موعد · </dt><dd className="inline">{new Date(ref.work.nearestDueAt).toLocaleString('ar')}</dd></div>}
            {ref.work.decision && <div><dt className="inline font-semibold">يحتاج قراراً · </dt><dd className="inline">{ref.work.decision}</dd></div>}
          </dl>}</> : <span className="text-slate-500">مرجع غير متاح</span>}</li>)}</ul>
          {selected.d.state === 'PUBLISHED' && <><h3 className="text-sm font-bold">الاستلام ({selected.receipts.length})</h3>{selected.recipients.map(r => <p key={r.userId} className="text-sm text-slate-600">{r.userName} · {r.received ? 'أكد الاستلام' : 'لم يؤكد الاستلام'}</p>)}{selected.receipts.map(r => <p key={r.id} className="text-sm text-slate-600 break-words">{r.userName} · {new Date(r.createdAt).toLocaleString('ar')} {r.note}</p>)}{receiptState === 'confirmed' && <p className="text-sm font-semibold text-emerald-700">تم تأكيد استلامك.</p>}{receiptState === 'pending' && <label className="block text-sm font-semibold">ملاحظة الاستلام<textarea className={control} maxLength={500} value={receiptNote} disabled={pending || !isOnline} onChange={e => setReceiptNote(e.target.value)} /></label>}</>}
        </div>}
        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">
          {pending ? <button className={button} onClick={() => abortRef.current?.abort()}><Square size={16} />إيقاف الانتظار</button> : <>
            {draft && <button className={button} disabled={!isOnline || !canPublish || !!handoverDraftError(draft) || conflict} onClick={() => run('save')}><Save size={18} />حفظ المسودة</button>}
            {selected?.d.state === 'DRAFT' && <><button className={button} disabled={!isOnline || !selected.canPublish || session.dirty || conflict} title={session.dirty ? 'احفظ التعديلات أولاً' : !selected.canPublish ? 'لا تتوفر صلاحية أو عضوية الوردية الصادرة' : undefined} onClick={() => run('publish')}><Send size={18} />نشر التسليم</button><button className={button} disabled={!isOnline || conflict} onClick={() => run('delete')}><Trash2 size={18} />حذف المسودة</button></>}
            {selected && <button type="button" className={button} onClick={(event) => void copySummary([selected], event.currentTarget)}>نسخ ملخص التسليم</button>}
            {selected?.d.state === 'PUBLISHED' && <><button className={receiptState === 'pending' ? 'min-h-11 inline-flex items-center justify-center gap-2 rounded-lg border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-800 disabled:opacity-50' : button} disabled={!isOnline || receiptState !== 'pending'} onClick={() => run('ack')}><Check size={18} />تأكيد الاستلام</button>{receiptState === null && <span className="text-xs text-slate-600 self-center">الاستلام متاح لأعضاء الوردية المستلمة المؤهلين.</span>}{selected.canRemind && <button className={button} disabled={!isOnline} onClick={() => run('remind')}><Bell size={18} />تذكير المستلمين</button>}{canPublish && (selected.canRemind || selected.d.authorId === currentUser.id) && <button className={button} onClick={async () => {
              if (selected.d.references.some(r => !r.available) && !await confirmDialog({ title: 'مراجع غير متاحة', message: 'إنشاء التصحيح دون نقل المراجع غير المتاحة؟', confirmLabel: 'إنشاء التصحيح' })) return;
              const next = { ...editable(selected), id: newId('handover'), supersedesId: selected.id, title: `تصحيح: ${selected.d.title}`.slice(0, 120) }; setSelected(null); setBaseV(undefined); setDraft(next); setMessage('');
            }}>إنشاء تصحيح</button>}</>}
            <button ref={reloadRef} className={button} disabled={!isOnline} onClick={reviewCurrent}><RefreshCw size={18} />مراجعة النسخة الحالية</button>
          </>}
        </div>
        {draft && handoverDraftError(draft) && <p className="text-xs text-slate-600">{handoverDraftError(draft)}</p>}
        {selected?.d.state === 'DRAFT' && !draft && <p className="text-sm text-amber-800">لا يمكن تعديل المسودة مع مراجع غير متاحة؛ لا تُحذف المراجع تلقائياً.</p>}
      </div>
    </Modal>
  </section>;
}

export function IncomingHandovers({ currentUser, onNavigate }: { currentUser: User; onNavigate: (url: string) => void }) {
  const [count, setCount] = useState(0);
  const canView = RbacService.hasPermission(currentUser, 'handover.view');
  useEffect(() => {
    setCount(0);
    if (!canView) return;
    const controller = new AbortController();
    apiService.getShiftHandovers(controller.signal).then(rows => { if (!controller.signal.aborted) setCount(rows.filter(row => personalHandoverReceiptState(row, currentUser.id) === 'pending').length); }).catch(() => {});
    return () => controller.abort();
  }, [currentUser.id, canView]);
  return canView && count ? <div className="border-y border-amber-200 py-2 flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-amber-800">{count} تسليم وردية ينتظر استلامك</span><button className={button} onClick={() => onNavigate('/roster/handover')}>مراجعة تسليم الوردية</button></div> : null;
}
