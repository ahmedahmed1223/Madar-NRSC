import { appLocale, zoneOptions } from '../shared/dateFormat';
import { ENTITY_ID_PATTERN } from '../shared/collections';
import { confirmDialog, promptDialog } from '../services/dialogs';
import { navigateTo } from '../services/uiEvents';
import { FilterTabs } from '../components/common/FilterTabs';
import { matchesQuery } from '../shared/search';
import { REQUEST_TYPES } from '../shared/production';
import { isMediaDeliveryRequest, mediaDeliveryQueue } from '../shared/productionWorkQueues';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, CheckCircle2, Edit2, Link2, Plus, Trash2, X } from 'lucide-react';
import type { User } from '../types';
import { apiService } from '../services/api';
import { dataStore } from '../services/dataStore';
import { RbacService } from '../services/rbacService';
import { DEPARTMENTS, departmentIdOf, departmentName } from '../shared/departments';
import { DeptRequest, isRequestClosed, isVideoReady, requestStatusName, requestTypeOf } from '../shared/production';
import { RequestFormPage } from '../components/requests/RequestFormPage';
import { MediaPicker } from '../components/media/MediaPicker';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { fromLocalInputValue } from '../shared/dates';

interface RequestsViewProps {
  focusId?: string | null;
  currentUser: User;
  onOpenNews: (newsId: string) => void;
  onOpenEpisode: (episodeId: string, segmentId?: string) => void;
  focusSegmentId?: string;
  onClearFocus?: () => void;
}

const STATUS_STYLE: Record<string, string> = {
  OPEN: 'bg-blue-50 text-blue-700 border-blue-200',
  ACCEPTED: 'bg-amber-50 text-amber-800 border-amber-200',
  DONE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
  CANCELLED: 'bg-slate-100 text-slate-500 border-slate-200',
};

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(appLocale(), { ...zoneOptions(), day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
type RequestTab = 'INBOX' | 'SENT' | 'ALL' | 'DELIVERY';

/** Requests between departments: what my department has to do, and what I asked others for. */
export const RequestsView: React.FC<RequestsViewProps> = ({ currentUser, onOpenNews, onOpenEpisode, focusId, focusSegmentId, onClearFocus }) => {
  const canManage = RbacService.hasPermission(currentUser, 'requests.manage');
  const canCreate = RbacService.hasPermission(currentUser, 'requests.create');
  const canUpload = RbacService.hasPermission(currentUser, 'media.upload');
  const canSeeMedia = RbacService.hasPermission(currentUser, 'media.view') && RbacService.canOpenScreen(currentUser, 'media');
  const canSeeNews = RbacService.hasPermission(currentUser, 'news.view') && RbacService.canOpenScreen(currentUser, 'news');
  const canSeeEpisodes = RbacService.canOpenScreen(currentUser, 'episode-workspace') && (RbacService.hasPermission(currentUser, 'programs.view') || RbacService.hasPermission(currentUser, 'rundown.view'));
  const { isOnline } = useOnlineStatus();
  const myDept = departmentIdOf(currentUser);
  const [requests, setRequests] = useState<DeptRequest[]>(() => apiService.getRequests());
  const [tab, setTab] = useState<RequestTab>(focusSegmentId || focusId ? 'ALL' : 'INBOX');
  const [dept, setDept] = useState<string>(myDept);
  const [showClosed, setShowClosed] = useState(false);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DeptRequest | null>(null);
  const [doneFor, setDoneFor] = useState<DeptRequest | null>(null);
  const [proposalFor, setProposalFor] = useState<string | null>(null);
  const [proposalDate, setProposalDate] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const running = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const focusedRequest = focusId && ENTITY_ID_PATTERN.test(focusId) ? requests.find(request => request.id === focusId && !request.deletedAt) : undefined;
  useEffect(() => {
    if (focusId || focusSegmentId) { setTab('ALL'); setQuery(''); setTypeFilter('ALL'); setShowClosed(true); }
  }, [focusId, focusSegmentId]);

  useEffect(
    () =>
      dataStore.subscribe((evt) => {
        if (evt.type === 'sync-status' || (evt.type === 'data-changed' && evt.collections.some(collection => collection === 'requests' || collection === 'media'))) setRequests(apiService.getRequests());
      }),
    []
  );

  const assertCurrent = (request: DeptRequest) => {
    const current = apiService.getRequests().find(item => item.id === request.id);
    if (!current || current.status !== request.status || current.updatedAt !== request.updatedAt || dataStore.hasPendingWrite('requests', request.id)) {
      throw new Error('تغير الطلب. راجع النسخة الحالية قبل تنفيذ الإجراء.');
    }
  };

  const act = async (request: DeptRequest, fn: () => void | Promise<void>, ok: string) => {
    if (!isOnline || running.current.has(request.id) || dataStore.hasPendingWrite('requests', request.id)) return;
    running.current.add(request.id);
    setBusy(new Set(running.current));
    setMessage(null);
    try {
      assertCurrent(request);
      await fn();
      setMessage({ ok: true, text: ok });
      return true;
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'تعذر تنفيذ الإجراء' });
    } finally {
      running.current.delete(request.id);
      setBusy(new Set(running.current));
      setRequests(apiService.getRequests());
    }
  };

  const confirmRequestWrite = async (id: string) => {
    const outcome = await dataStore.awaitWrite('requests', id);
    if (!outcome.ok) throw new Error(outcome.message || 'لم يؤكد الخادم تحديث الطلب بعد.');
  };
  const changeStatus = (request: DeptRequest, changes: Partial<DeptRequest>, success: string) => act(request, async () => {
    apiService.updateRequest(request.id, changes);
    await confirmRequestWrite(request.id);
  }, success);

  const complete = async (request: DeptRequest, resultMediaId?: string) => {
    if (!await confirmDialog({ title: 'إنجاز الطلب', message: `تأكيد إنجاز «${request.title}»${resultMediaId ? ' وتسليم المادة المحددة' : ''}؟`, confirmLabel: 'تأكيد الإنجاز' })) return;
    await act(request, async () => {
      if (resultMediaId) {
        const media = apiService.getMedia().find(item => item.id === resultMediaId);
        if (!media) throw new Error('مادة التسليم غير متاحة.');
        if (request.type === 'MONTAGE' && media.mediaType !== 'VIDEO') throw new Error('اختر فيديو متاحاً لتسليم المونتاج.');
        if (request.type === 'MONTAGE' && !isVideoReady(media.videoStatus)) {
          if (!canUpload) throw new Error('يتطلب تسليم فيديو غير جاهز صلاحية تعديل الوسائط.');
          apiService.updateMedia(media.id, { videoStatus: 'READY', editorId: currentUser.id, editorName: currentUser.fullName });
        }
        const outcome = await dataStore.awaitWrite('media', media.id);
        if (!outcome.ok) throw new Error(outcome.message || 'لم يؤكد الخادم حفظ المادة بعد.');
        assertCurrent(request);
      }
      apiService.updateRequest(request.id, { status: 'DONE', ...(isMediaDeliveryRequest(request.type) ? { resultMediaId } : {}) });
      await confirmRequestWrite(request.id);
    }, resultMediaId ? 'أُنجز الطلب وسُلّمت المادة' : 'أُنجز الطلب');
  };

  const pendingIds = new Set(requests.filter(request => dataStore.hasPendingWrite('requests', request.id)).map(request => request.id));
  const delivery = mediaDeliveryQueue(requests, myDept, canManage, pendingIds);
  const canSeeDelivery = canManage || REQUEST_TYPES.some(type => type.departmentId === myDept && isMediaDeliveryRequest(type.id));
  const listTab = (tab === 'DELIVERY' && !canSeeDelivery) || (tab === 'ALL' && !canManage && !focusSegmentId) ? 'INBOX' : tab;
  const matchesFilters = (r: DeptRequest) => (typeFilter === 'ALL' || r.type === typeFilter)
    && matchesQuery(query, r.title, r.details, r.requesterName, r.assigneeName, r.addressedToName, r.link?.title, r.lines || []);
  const list = focusedRequest ? [focusedRequest] : listTab === 'DELIVERY' ? delivery.filter(matchesFilters) : requests
      .filter(r => !focusSegmentId || r.link?.segmentId === focusSegmentId)
      .filter(r => listTab === 'ALL' || (listTab === 'INBOX' ? r.departmentId === (canManage ? dept : myDept) : r.requesterId === currentUser.id))
      .filter((r) => showClosed || pendingIds.has(r.id) || !isRequestClosed(r.status))
      .filter(matchesFilters)
      .sort((a, b) => Number(b.priority === 'URGENT') - Number(a.priority === 'URGENT') || b.createdAt.localeCompare(a.createdAt));

  const newsById = new Map(canSeeNews && list.some(request => request.link?.kind === 'news') ? apiService.getNews().map(item => [item.id, item] as const) : []);
  const episodesById = new Map(canSeeEpisodes && list.some(request => request.link?.episodeId) ? apiService.getEpisodes().map(item => [item.id, item] as const) : []);
  const mediaById = new Map(canSeeMedia && list.some(request => request.resultMediaId) ? apiService.getMedia().map(item => [item.id, item] as const) : []);
  const inboxCount = requests.filter((r) => r.departmentId === myDept && (pendingIds.has(r.id) || !isRequestClosed(r.status))).length;

  return (
    <div className="space-y-5">
      {focusId && <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 py-2 text-sm text-slate-700"><span>{focusedRequest ? 'الطلب المحدد' : 'العنصر المطلوب غير متاح؛ يمكنك متابعة العمل من القائمة.'}</span><button type="button" onClick={onClearFocus} className="min-h-11 px-3 inline-flex items-center gap-2 text-blue-700"><X className="w-4 h-4" />عرض جميع الطلبات</button></div>}
      {focusSegmentId && <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 py-2 text-sm text-slate-700">
        <span>طلبات الفقرة: {requests.find(r => r.link?.segmentId === focusSegmentId)?.link?.title || 'الفقرة المحددة'}</span>
        <button type="button" onClick={onClearFocus} className="min-h-11 px-3 flex items-center gap-2 text-blue-700"><X className="w-4 h-4" />عرض جميع الطلبات</button>
      </div>}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5 text-blue-600" />
            طلبات الأقسام
          </h1>
          <p className="text-xs text-slate-500 mt-1">مونتاج، جرافيك، تجهيز استديو، صوت، إضاءة، أرشيف… كل طلب يصل للقسم المعني ويُتابَع حتى الإنجاز.</p>
        </div>
        {canCreate && (
          <button type="button" onClick={() => { setEditing(null); setFormOpen(true); }} className="inline-flex items-center gap-1.5 min-h-11 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold self-start">
            <Plus className="w-4 h-4" />
            طلب جديد
          </button>
        )}
      </div>

      {message && (
        <div role="status" className={`p-3 rounded-xl text-xs font-bold flex justify-between ${message.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} aria-label="إغلاق" className="-m-1 p-1 rounded-lg hover:bg-white/60">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
        <FilterTabs<RequestTab>
          label="الطلبات"
          className="col-span-full"
          active={listTab}
          onChange={next => {
            if (focusId || focusSegmentId) onClearFocus?.();
            setTab(next);
            setTypeFilter('ALL');
          }}
          tabs={[
            { id: 'INBOX' as const, label: 'الوارد لقسمي', count: inboxCount, tone: 'violet' as const },
            ...(canSeeDelivery ? [{ id: 'DELIVERY' as const, label: 'تسليم الوسائط', count: delivery.length, tone: 'amber' as const }] : []),
            ...(canCreate ? [{ id: 'SENT' as const, label: 'طلباتي', tone: 'blue' as const }] : []),
            ...(canManage ? [{ id: 'ALL' as const, label: 'كل الطلبات', tone: 'slate' as const }] : []),
          ]}
        />
        <input
          type="search"
          aria-label="بحث في الطلبات"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بحث بالعنوان أو الشخص أو الخبر…"
          className="col-span-full min-h-11 w-full min-w-0 px-3 border border-slate-300 rounded-lg text-sm bg-white sm:w-56"
        />
        {listTab === 'INBOX' && canManage && (
          <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="القسم" className="min-h-11 min-w-0 px-3 border border-slate-300 rounded-lg text-sm bg-white">
            {DEPARTMENTS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
        <select aria-label="نوع الطلب" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={`min-h-11 min-w-0 px-3 border border-slate-300 rounded-lg text-sm bg-white ${listTab === 'INBOX' && canManage ? '' : 'col-span-full'}`}>
          <option value="ALL">كل الأنواع</option>
          {REQUEST_TYPES.filter(type => listTab !== 'DELIVERY' || (isMediaDeliveryRequest(type.id) && (canManage || type.departmentId === myDept))).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {listTab !== 'DELIVERY' && <label className="col-span-full flex items-center gap-2 min-h-11 text-sm text-slate-700 sm:ms-auto cursor-pointer">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="w-4 h-4 accent-blue-600" />
          عرض المنجز والمغلق
        </label>}
      </div>

      {!isOnline && <p role="status" className="text-sm text-amber-800">لا اتصال بالخادم؛ يمكن مراجعة الطلبات وتحتاج إجراءاتها إلى الاتصال.</p>}

      <div className="space-y-2">
        {list.length === 0 && (
          <p className="text-center text-xs text-slate-500 py-10 bg-white border border-dashed border-slate-300 rounded-2xl">
            {listTab === 'DELIVERY' ? 'لا توجد طلبات وسائط مطابقة بانتظار التسليم.' : listTab === 'INBOX' ? `لا توجد طلبات مفتوحة لقسم ${departmentName(canManage ? dept : myDept)}.` : showClosed ? 'لا توجد طلبات.' : 'لا توجد طلبات مفتوحة. فعّل «عرض المنجز والمغلق» لرؤية ما سبق.'}
          </p>
        )}
        {list.map((r) => {
          const type = requestTypeOf(r.type);
          const isHandler = departmentIdOf(currentUser) === r.departmentId || canManage;
          const isRequester = r.requesterId === currentUser.id;
          const pendingWrite = pendingIds.has(r.id);
          const busyRow = busy.has(r.id) || pendingWrite;
          const dueAt = r.dueAt && Number.isFinite(Date.parse(r.dueAt)) ? r.dueAt : undefined;
          const overdue = dueAt && !isRequestClosed(r.status) && Date.parse(dueAt) < Date.now();
          const link = r.link;
          const linkedNews = link?.kind === 'news' && link.newsId && ENTITY_ID_PATTERN.test(link.newsId) ? newsById.get(link.newsId) : undefined;
          const linkedEpisode = link?.episodeId && ENTITY_ID_PATTERN.test(link.episodeId) ? episodesById.get(link.episodeId) : undefined;
          const canOpenEpisode = linkedEpisode && (link?.kind !== 'segment' || linkedEpisode.rundown?.some(segment => segment.id === link.segmentId));
          const resultMedia = !pendingWrite && r.resultMediaId ? mediaById.get(r.resultMediaId) : undefined;
          return (
            <article key={r.id} className={`bg-white border rounded-2xl p-4 space-y-2 ${r.priority === 'URGENT' && !isRequestClosed(r.status) ? 'border-red-300' : 'border-slate-200'}`}>
              <div className="flex flex-wrap items-center gap-2 text-2xs">
                <span className="px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 font-bold">{type?.name}</span>
                <span className="text-slate-500">إلى: {departmentName(r.departmentId)}</span>
                {r.priority === 'URGENT' && <span className="px-2 py-0.5 rounded-md bg-red-600 text-white font-bold">عاجل</span>}
                <span className={`px-2 py-0.5 rounded-md border font-bold ${pendingWrite ? STATUS_STYLE.ACCEPTED : STATUS_STYLE[r.status]}`}>{pendingWrite ? 'بانتظار تأكيد الخادم' : requestStatusName(r.status)}</span>
                {overdue && <span className="px-2 py-0.5 rounded-md border border-amber-200 bg-amber-50 text-amber-800 font-bold">متأخر</span>}
                <span className="text-slate-500 mr-auto">{when(r.createdAt)}</span>
              </div>
              <h2 className="text-sm font-bold text-slate-900 break-words">{r.title}</h2>
              {r.details && <p className="text-xs text-slate-600 whitespace-pre-line break-words">{r.details}</p>}
              {r.lines && r.lines.length > 0 && (
                <ul className="text-xs bg-slate-50 border border-slate-200 rounded-xl p-2 pr-6 space-y-0.5 font-bold text-slate-700 list-disc marker:text-slate-400">
                  {r.lines.map((l, i) => (
                    <li key={i} dir="auto">{l}</li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-slate-500">
                <span>
                  من: {r.requesterName}
                  {r.requesterDepartmentId ? ` (${departmentName(r.requesterDepartmentId)})` : ''}
                </span>
                {r.status === 'OPEN' && !pendingWrite && <span>لدى قسم {departmentName(r.departmentId)} · بانتظار الاستلام</span>}
                {r.addressedToName && !r.assigneeName && <span className="font-bold text-violet-700">موجّه إلى: {r.addressedToName}</span>}
                {r.assigneeName && !pendingWrite && <span>{r.status === 'OPEN' ? 'آخر مستلم' : 'تولّى الطلب'}: {r.assigneeName}</span>}
                {dueAt ? <span>مطلوب قبل: <time dateTime={dueAt}>{when(dueAt)}</time></span> : !isRequestClosed(r.status) && <span>موعد التسليم غير محدد</span>}
                {link && (linkedNews || canOpenEpisode ? (
                  <button
                    type="button"
                    onClick={() => { if (linkedNews) onOpenNews(linkedNews.id); else if (linkedEpisode) onOpenEpisode(linkedEpisode.id, link.kind === 'segment' ? link.segmentId : undefined); }}
                    className="min-h-11 inline-flex items-center gap-1 min-w-0 text-blue-700 hover:underline"
                  >
                    <Link2 className="w-3 h-3 shrink-0" />
                    <span className="break-words min-w-0">{link.title}</span>
                  </button>
                ) : <span>المصدر المرتبط غير متاح</span>)}
                {resultMedia && <button type="button" onClick={() => navigateTo.emit(`/media/${encodeURIComponent(resultMedia.id)}`)} className="min-h-11 text-blue-700 hover:underline break-words min-w-0">المادة المسلّمة: {resultMedia.title || resultMedia.fileName}</button>}
              </div>
              {r.resolution && <p className="text-2xs text-rose-700">السبب: {r.resolution}</p>}

              <fieldset disabled={busyRow || !isOnline} className="flex flex-wrap gap-2 pt-1 min-w-0 disabled:opacity-60">
                {r.proposedDueAt && !isRequestClosed(r.status) && <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="الموعد البديل">
                  <span>موعد مقترح <time dateTime={r.proposedDueAt}>{when(r.proposedDueAt)}</time></span>
                  {isRequester && <>
                    <button type="button" className="min-h-11 px-2 font-semibold text-blue-700" onClick={() => changeStatus(r, { dueAt: r.proposedDueAt!, proposedDueAt: null }, 'اعتُمد الموعد البديل')}>اعتماد الموعد</button>
                    <button type="button" className="min-h-11 px-2 font-semibold text-slate-700" onClick={() => changeStatus(r, { proposedDueAt: null }, 'رُفض الموعد البديل')}>رفض الموعد</button>
                  </>}
                </div>}
                {isHandler && !isRequester && !isRequestClosed(r.status) && (proposalFor === r.id ? <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
                  event.preventDefault();
                  const date = fromLocalInputValue(proposalDate);
                  if (date) void changeStatus(r, { proposedDueAt: date }, 'أُرسل الموعد البديل').then(saved => { if (saved) setProposalFor(null); });
                }}>
                  <label className="grid gap-1 text-xs font-semibold">موعد التسليم المقترح
                    <input required type="datetime-local" value={proposalDate} onChange={event => setProposalDate(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-2" />
                  </label>
                  <button type="submit" className="min-h-11 px-2 font-semibold text-blue-700">إرسال الاقتراح</button>
                  <button type="button" className="min-h-11 px-2 text-slate-700" onClick={() => setProposalFor(null)}>إلغاء</button>
                </form> : <button type="button" className="min-h-11 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700" onClick={() => { setProposalFor(r.id); setProposalDate(''); }}>اقتراح موعد بديل</button>)}
                {isHandler && r.status === 'OPEN' && (!r.addressedToId || r.addressedToId === currentUser.id || canManage) && (
                  <button type="button" onClick={() => changeStatus(r, { status: 'ACCEPTED' }, 'استلمت الطلب')} className="min-h-11 sm:min-h-9 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold">
                    استلام الطلب
                  </button>
                )}
                {isHandler && (r.status === 'OPEN' || r.status === 'ACCEPTED') && (
                  <button
                    type="button"
                    onClick={() => complete(r)}
                    className="inline-flex items-center gap-1 min-h-11 sm:min-h-9 px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-bold"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    تم الإنجاز
                  </button>
                )}
                {isHandler && !isRequestClosed(r.status) && isMediaDeliveryRequest(r.type) && (canSeeMedia ? (
                  <button type="button" onClick={() => setDoneFor(r)} className="min-h-11 sm:min-h-9 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-blue-700">إرفاق مادة وتسليمها</button>
                ) : <span className="self-center text-xs text-slate-600">إرفاق النتيجة يحتاج صلاحية مكتبة الوسائط.</span>)}
                {isHandler && r.status === 'ACCEPTED' && (
                  <button type="button" onClick={() => changeStatus(r, { status: 'OPEN' }, 'أُعيد الطلب للقائمة')} className="min-h-11 sm:min-h-9 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600">
                    إعادته للقائمة
                  </button>
                )}
                {isHandler && !isRequestClosed(r.status) && (
                  <button
                    type="button"
                    onClick={async () => {
                      const reason = await promptDialog({ title: 'رفض الطلب', label: 'سبب الرفض', required: true, multiline: true });
                      if (reason && reason.trim()) void changeStatus(r, { status: 'REJECTED', resolution: reason.trim() }, 'رُفض الطلب');
                    }}
                    className="min-h-11 sm:min-h-9 px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 text-xs font-bold"
                  >
                    رفض
                  </button>
                )}
                {(isRequester || canManage) && !isRequestClosed(r.status) && (
                  <button type="button" onClick={async () => (await confirmDialog('إلغاء هذا الطلب؟')) && changeStatus(r, { status: 'CANCELLED' }, 'أُلغي الطلب')} className="min-h-11 sm:min-h-9 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600">
                    إلغاء الطلب
                  </button>
                )}
                {isRequester && r.status === 'OPEN' && (
                  <button type="button" onClick={() => { setEditing(r); setFormOpen(true); }} className="inline-flex items-center gap-1 min-h-11 sm:min-h-9 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50">
                    <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
                    تعديل
                  </button>
                )}
                {isRequester && r.status === 'OPEN' && (
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirmDialog({ title: 'حذف الطلب', message: `حذف الطلب «${r.title}» نهائياً؟ لن يظهر لقسم ${departmentName(r.departmentId)} بعد الآن.`, confirmLabel: 'حذف الطلب', danger: true });
                      if (ok) void act(r, async () => { apiService.deleteRequest(r.id); await confirmRequestWrite(r.id); }, 'حُذف الطلب');
                    }}
                    className="inline-flex items-center gap-1 min-h-11 sm:min-h-9 px-3 py-1.5 rounded-lg border border-red-200 text-red-700 text-xs font-bold hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    حذف
                  </button>
                )}
                {(isRequester || canManage) && r.status === 'DONE' && (
                  <button type="button" onClick={() => changeStatus(r, { status: 'ACCEPTED' }, 'أُعيد فتح الطلب')} className="min-h-11 sm:min-h-9 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600">
                    إعادة فتح
                  </button>
                )}
              </fieldset>
            </article>
          );
        })}
      </div>

      <RequestFormPage
        isOpen={formOpen}
        editing={editing}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onCreated={(text) => { setRequests(apiService.getRequests()); setMessage({ ok: true, text }); }}
      />

      {doneFor && (
        <MediaPicker
          isOpen
          onClose={() => setDoneFor(null)}
          selectedIds={doneFor.resultMediaId ? [doneFor.resultMediaId] : []}
          canUpload={canUpload}
          resultMode={doneFor.type === 'MONTAGE' ? 'video' : 'any'}
          onPick={(ids) => {
            if (ids[0]) void complete(doneFor, ids[0]);
          }}
        />
      )}
    </div>
  );
};
