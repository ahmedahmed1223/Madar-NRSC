import { confirmDialog, promptDialog } from '../services/dialogs';
import { FilterTabs } from '../components/common/FilterTabs';
import { matchesQuery } from '../shared/search';
import { REQUEST_TYPES } from '../shared/production';
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, CheckCircle2, Inbox, Link2, Plus, Send, X } from 'lucide-react';
import type { User } from '../types';
import { apiService } from '../services/api';
import { dataStore } from '../services/dataStore';
import { RbacService } from '../services/rbacService';
import { DEPARTMENTS, departmentIdOf, departmentName } from '../shared/departments';
import { DeptRequest, isRequestClosed, requestStatusName, requestTypeOf } from '../shared/production';
import { RequestFormPage } from '../components/requests/RequestFormPage';
import { MediaPicker } from '../components/media/MediaPicker';

interface RequestsViewProps {
  currentUser: User;
  onOpenNews: (newsId: string) => void;
  onOpenEpisode: (episodeId: string) => void;
}

const STATUS_STYLE: Record<string, string> = {
  OPEN: 'bg-blue-50 text-blue-700 border-blue-200',
  ACCEPTED: 'bg-amber-50 text-amber-800 border-amber-200',
  DONE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
  CANCELLED: 'bg-slate-100 text-slate-500 border-slate-200',
};

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/** Requests between departments: what my department has to do, and what I asked others for. */
export const RequestsView: React.FC<RequestsViewProps> = ({ currentUser, onOpenNews, onOpenEpisode }) => {
  const canManage = RbacService.hasPermission(currentUser, 'requests.manage');
  const canCreate = RbacService.hasPermission(currentUser, 'requests.create');
  const myDept = departmentIdOf(currentUser);
  const [requests, setRequests] = useState<DeptRequest[]>(() => apiService.getRequests());
  const [tab, setTab] = useState<'INBOX' | 'SENT' | 'ALL'>('INBOX');
  const [dept, setDept] = useState<string>(myDept);
  const [showClosed, setShowClosed] = useState(false);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [formOpen, setFormOpen] = useState(false);
  const [doneFor, setDoneFor] = useState<DeptRequest | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(
    () =>
      dataStore.subscribe((evt) => {
        if (evt.type === 'data-changed' && evt.collections.includes('requests')) setRequests(apiService.getRequests());
      }),
    []
  );

  const act = (fn: () => void, ok: string) => {
    try {
      fn();
      setRequests(apiService.getRequests());
      setMessage({ ok: true, text: ok });
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message || 'تعذر تنفيذ الإجراء' });
    }
  };

  const list = useMemo(() => {
    return requests
      .filter((r) => (tab === 'INBOX' ? r.departmentId === dept : tab === 'SENT' ? r.requesterId === currentUser.id : true))
      .filter((r) => showClosed || !isRequestClosed(r.status))
      .filter((r) => typeFilter === 'ALL' || r.type === typeFilter)
      .filter((r) => matchesQuery(query, r.title, r.details, r.requesterName, r.assigneeName, r.addressedToName, r.link?.title, r.lines || []))
      .sort((a, b) => Number(b.priority === 'URGENT') - Number(a.priority === 'URGENT') || b.createdAt.localeCompare(a.createdAt));
  }, [requests, tab, dept, showClosed, currentUser.id, query, typeFilter]);

  const inboxCount = requests.filter((r) => r.departmentId === myDept && !isRequestClosed(r.status)).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5 text-blue-600" />
            طلبات الأقسام
          </h1>
          <p className="text-xs text-slate-500 mt-1">مونتاج، جرافيك، تجهيز استديو، صوت، إضاءة، أرشيف... كل طلب يصل للقسم المعني ويُتابَع حتى الإنجاز.</p>
        </div>
        {canCreate && (
          <button type="button" onClick={() => setFormOpen(true)} className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold self-start">
            <Plus className="w-4 h-4" />
            طلب جديد
          </button>
        )}
      </div>

      {message && (
        <div role="status" className={`p-3 rounded-xl text-xs font-bold flex justify-between ${message.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} aria-label="إغلاق">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <FilterTabs<"ALL" | "INBOX" | "SENT">
          label="الطلبات"
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'INBOX' as const, label: 'الوارد لقسمي', count: inboxCount, tone: 'violet' as const },
            ...(canCreate ? [{ id: 'SENT' as const, label: 'طلباتي', tone: 'blue' as const }] : []),
            ...(canManage ? [{ id: 'ALL' as const, label: 'كل الطلبات', tone: 'slate' as const }] : []),
          ]}
        />
        {tab === 'INBOX' && canManage && (
          <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="القسم" className="px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white">
            {DEPARTMENTS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
        <input
          type="search"
          aria-label="بحث في الطلبات"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بحث بالعنوان أو الشخص أو الخبر…"
          className="px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white w-56 max-w-full"
        />
        <select aria-label="نوع الطلب" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white">
          <option value="ALL">كل الأنواع</option>
          {REQUEST_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 mr-auto">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          عرض المنجز والمغلق
        </label>
      </div>

      <div className="space-y-2">
        {list.length === 0 && (
          <p className="text-center text-xs text-slate-500 py-10 bg-white border border-dashed border-slate-300 rounded-2xl">
            {tab === 'INBOX' ? `لا توجد طلبات مفتوحة لقسم ${departmentName(dept)}.` : 'لا توجد طلبات.'}
          </p>
        )}
        {list.map((r) => {
          const type = requestTypeOf(r.type);
          const isHandler = departmentIdOf(currentUser) === r.departmentId || canManage;
          const isRequester = r.requesterId === currentUser.id;
          const overdue = r.dueAt && !isRequestClosed(r.status) && new Date(r.dueAt).getTime() < Date.now();
          return (
            <article key={r.id} className={`bg-white border rounded-2xl p-4 space-y-2 ${r.priority === 'URGENT' && !isRequestClosed(r.status) ? 'border-red-300' : 'border-slate-200'}`}>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 font-bold">{type?.name}</span>
                <span className="text-slate-500">إلى: {departmentName(r.departmentId)}</span>
                {r.priority === 'URGENT' && <span className="px-2 py-0.5 rounded-md bg-red-600 text-white font-bold">عاجل</span>}
                <span className={`px-2 py-0.5 rounded-md border font-bold ${STATUS_STYLE[r.status]}`}>{requestStatusName(r.status)}</span>
                {overdue && <span className="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 font-bold">متأخر</span>}
                <span className="text-slate-400 mr-auto">{when(r.createdAt)}</span>
              </div>
              <h2 className="text-sm font-bold text-slate-900">{r.title}</h2>
              {r.details && <p className="text-xs text-slate-600 whitespace-pre-line">{r.details}</p>}
              {r.lines && r.lines.length > 0 && (
                <ul className="text-xs bg-slate-50 border border-slate-200 rounded-xl p-2 space-y-0.5 font-bold text-slate-700">
                  {r.lines.map((l, i) => (
                    <li key={i}>▸ {l}</li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                <span>
                  من: {r.requesterName}
                  {r.requesterDepartmentId ? ` (${departmentName(r.requesterDepartmentId)})` : ''}
                </span>
                {r.addressedToName && !r.assigneeName && <span className="font-bold text-purple-700">موجّه إلى: {r.addressedToName}</span>}
                {r.assigneeName && <span>المنفذ: {r.assigneeName}</span>}
                {r.dueAt && <span>مطلوب قبل: {when(r.dueAt)}</span>}
                {r.link && (
                  <button
                    type="button"
                    onClick={() => (r.link!.newsId ? onOpenNews(r.link!.newsId) : r.link!.episodeId && onOpenEpisode(r.link!.episodeId))}
                    className="inline-flex items-center gap-1 text-blue-700 hover:underline"
                  >
                    <Link2 className="w-3 h-3" />
                    {r.link.title}
                  </button>
                )}
              </div>
              {r.resolution && <p className="text-[11px] text-rose-700">السبب: {r.resolution}</p>}

              <div className="flex flex-wrap gap-2 pt-1">
                {isHandler && r.status === 'OPEN' && (!r.addressedToId || r.addressedToId === currentUser.id || canManage) && (
                  <button type="button" onClick={() => act(() => apiService.updateRequest(r.id, { status: 'ACCEPTED' }), 'استلمت الطلب')} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold">
                    استلام الطلب
                  </button>
                )}
                {isHandler && (r.status === 'OPEN' || r.status === 'ACCEPTED') && (
                  <button
                    type="button"
                    onClick={() => (r.type === 'MONTAGE' ? setDoneFor(r) : act(() => apiService.updateRequest(r.id, { status: 'DONE' }), 'أُنجز الطلب'))}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    تم الإنجاز
                  </button>
                )}
                {isHandler && r.status === 'ACCEPTED' && (
                  <button type="button" onClick={() => act(() => apiService.updateRequest(r.id, { status: 'OPEN' }), 'أُعيد الطلب للقائمة')} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600">
                    إعادته للقائمة
                  </button>
                )}
                {isHandler && !isRequestClosed(r.status) && (
                  <button
                    type="button"
                    onClick={async () => {
                      const reason = await promptDialog({ title: 'رفض الطلب', label: 'سبب الرفض', required: true, multiline: true });
                      if (reason && reason.trim()) act(() => apiService.updateRequest(r.id, { status: 'REJECTED', resolution: reason.trim() }), 'رُفض الطلب');
                    }}
                    className="px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 text-xs font-bold"
                  >
                    رفض
                  </button>
                )}
                {(isRequester || canManage) && !isRequestClosed(r.status) && (
                  <button type="button" onClick={async () => (await confirmDialog('إلغاء هذا الطلب؟')) && act(() => apiService.updateRequest(r.id, { status: 'CANCELLED' }), 'أُلغي الطلب')} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600">
                    إلغاء الطلب
                  </button>
                )}
                {(isRequester || canManage) && r.status === 'DONE' && (
                  <button type="button" onClick={() => act(() => apiService.updateRequest(r.id, { status: 'ACCEPTED' }), 'أُعيد فتح الطلب')} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600">
                    إعادة فتح
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <RequestFormPage isOpen={formOpen} onClose={() => setFormOpen(false)} onCreated={(text) => setMessage({ ok: true, text })} />

      {doneFor && (
        <MediaPicker
          isOpen
          onClose={() => setDoneFor(null)}
          selectedIds={doneFor.resultMediaId ? [doneFor.resultMediaId] : []}
          canUpload={RbacService.hasPermission(currentUser, 'media.upload')}
          onPick={(ids) => {
            const resultMediaId = ids[ids.length - 1];
            act(() => {
              if (resultMediaId) apiService.updateMedia(resultMediaId, { videoStatus: 'READY', editorId: currentUser.id, editorName: currentUser.fullName });
              apiService.updateRequest(doneFor.id, { status: 'DONE', resultMediaId });
            }, resultMediaId ? 'أُنجز المونتاج وسُلّم الفيديو' : 'أُنجز الطلب');
          }}
        />
      )}
    </div>
  );
};
