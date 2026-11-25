import { useEffect, useState } from 'react';
import type { User } from '../../types';
import { apiFetch } from '../../services/http';
import { apiService } from '../../services/api';
import { RbacService } from '../../services/rbacService';
import { useLiveData } from '../../hooks/useLiveData';
import { ShowMore, useIncremental } from '../common/ShowMore';
import { stationDay, when } from '../cards/cardUi';
import { CARD_WORK_PERIODS, matchesCardWorkPeriod, type CardWorkPeriod } from '../../shared/cardWorkPeriod';
import type { DepartmentWork, DepartmentWorkItem } from '../../shared/departmentWork';
import { CARD_STATE_NAMES, stepStatusName, type CardState, type StepStatus } from '../../shared/productionCards';
import { taskDurationLabel } from '../../shared/taskWorkflow';
import { TASK_STATUS_OPTIONS } from '../../services/taskBoard';
import { stationsOf, stationName } from '../../shared/stations';
import type { WorkItem } from '../../shared/workload';
import { matchesQuery } from '../../shared/search';
import { useQueueFilter } from '../../hooks/useQueueFilter';

const SELECT = 'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm';
const STATUS_CLOSED = new Set(['DONE', 'COMPLETED', 'CLOSED', 'CANCELLED']);
const KIND_LABELS = { card: 'مسؤول التكليف', step: 'خطوة في تكليف', task: 'مهمة' };

function stateName(item: DepartmentWorkItem): string {
  if (item.kind === 'card') return CARD_STATE_NAMES[item.status as CardState];
  if (item.kind === 'step' && item.status !== 'CLOSED' && item.status !== 'CANCELLED') return stepStatusName(item.status as StepStatus);
  return TASK_STATUS_OPTIONS.find(option => option.value === item.status)?.label || CARD_STATE_NAMES[item.status as CardState];
}

export function DepartmentWorkPanel({ currentUser, onOpen }: { currentUser: User; onOpen: (ref: WorkItem['ref']) => void }) {
  const rev = useLiveData(['settings', 'users', 'tasks', 'productionCards'], 20_000);
  const [loadedData, setData] = useState<DepartmentWork | null>(null);
  const [failure, setFailure] = useState('');
  const [retry, setRetry] = useState(0);
  const [dataUserId, setDataUserId] = useState(currentUser.id);
  const data = dataUserId === currentUser.id ? loadedData : null;
  const [memberId, setMemberId] = useQueueFilter(currentUser.id, 'department-work', 'member', 'ALL', data?.members.map(member => member.id));
  const [period, setPeriod] = useQueueFilter<CardWorkPeriod>(currentUser.id, 'department-work', 'period', 'ALL', CARD_WORK_PERIODS.map(option => option.id));
  const [state, setState] = useQueueFilter<'OPEN' | 'CLOSED' | 'ALL'>(currentUser.id, 'department-work', 'state', 'OPEN', ['OPEN', 'CLOSED', 'ALL']);
  const [query, setQuery] = useQueueFilter(currentUser.id, 'department-work', 'query', '');
  const [kind, setKind] = useQueueFilter(currentUser.id, 'department-work', 'kind', 'ALL', Object.keys(KIND_LABELS));
  const [lateOnly, setLateOnly] = useQueueFilter(currentUser.id, 'department-work', 'lateOnly', false);
  const [blockedOnly, setBlockedOnly] = useQueueFilter(currentUser.id, 'department-work', 'blockedOnly', false);

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<{ data: DepartmentWork }>('/api/v1/work/department', { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setDataUserId(currentUser.id);
        setData(result.data);
        setFailure('');
      }).catch(error => {
        if (controller.signal.aborted) return;
        setData(null);
        setFailure(error instanceof Error ? error.message : 'تعذر تحديث أعمال القسم');
      });
    return () => controller.abort();
  }, [currentUser.id, rev, retry]);

  const members = new Map(data?.members.map(member => [member.id, member]));
  const stations = stationsOf(apiService.getSettings());
  const selectedMember = members.has(memberId) ? memberId : 'ALL';
  const today = stationDay(Date.now());
  const late = (item: DepartmentWorkItem) => !STATUS_CLOSED.has(item.status) && !!item.dueAt && Date.parse(item.dueAt) < Date.now();
  const filtered = (data?.items || [])
    .filter(item => matchesQuery(query, item.title, item.detail, members.get(item.assigneeId)?.name))
    .filter(item => kind === 'ALL' || item.kind === kind)
    .filter(item => !lateOnly || late(item))
    .filter(item => !blockedOnly || item.status === 'BLOCKED')
    .filter(item => selectedMember === 'ALL' || item.assigneeId === selectedMember)
    .filter(item => state === 'ALL' || (state === 'CLOSED') === STATUS_CLOSED.has(item.status))
    .filter(item => matchesCardWorkPeriod(period, today, item.dueAt && Number.isFinite(Date.parse(item.dueAt)) ? [stationDay(item.dueAt)] : []))
    .sort((a, b) => (a.dueAt || '9').localeCompare(b.dueAt || '9') || a.title.localeCompare(b.title, 'ar'));
  const page = useIncremental(filtered, 40, `${selectedMember}|${period}|${state}|${query}|${kind}|${lateOnly}|${blockedOnly}`);

  return (
    <section aria-labelledby="department-work-title" className="space-y-4">
      <header>
        <h1 id="department-work-title" className="text-xl font-bold text-slate-900">أعمال فريقي</h1>
        {data && <p className="mt-1 text-sm text-slate-600">{data.departments.join('، ')}</p>}
      </header>
      {failure && <div className="flex items-center gap-3" role="alert">
        <p>{failure}</p>
        <button type="button" className="min-h-11 rounded-lg border border-slate-300 px-3" onClick={() => { setFailure(''); setRetry(value => value + 1); }}>إعادة المحاولة</button>
      </div>}
      {!data && !failure && <p role="status" className="text-sm text-slate-600">جارٍ تحميل أعمال القسم…</p>}
      {data && <>
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" aria-label="بحث في أعمال فريقي" placeholder="العنوان أو الموظف" className={`${SELECT} sm:max-w-sm`} value={query} onChange={event => setQuery(event.target.value)} />
          <select aria-label="نوع العمل" className={`${SELECT} sm:w-auto`} value={kind} onChange={event => setKind(event.target.value)}>
            <option value="ALL">كل الأنواع</option>
            {Object.entries(KIND_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={lateOnly} onChange={event => setLateOnly(event.target.checked)} />المتأخرة فقط</label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={blockedOnly} onChange={event => setBlockedOnly(event.target.checked)} />المتعطلة فقط</label>
        </div>
        <dl aria-label="ملخص حالة الفريق" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['المعروضة', filtered.length],
            ['مفتوحة', filtered.filter(item => !STATUS_CLOSED.has(item.status)).length],
            ['متأخرة', filtered.filter(late).length],
            ['متعطلة', filtered.filter(item => item.status === 'BLOCKED').length],
          ].map(([label, count]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-3"><dt className="text-xs text-slate-600">{label}</dt><dd className="text-lg font-bold">{count}</dd></div>)}
        </dl>
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-3">
          <label className="space-y-1 text-xs font-semibold text-slate-700">الموظف
            <select className={SELECT} value={selectedMember} onChange={event => setMemberId(event.target.value)}>
              <option value="ALL">جميع موظفي الفريق</option>
              {[...data.members].sort((a, b) => a.name.localeCompare(b.name, 'ar')).map(member => <option key={member.id} value={member.id}>{member.name} · {member.departmentName}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs font-semibold text-slate-700">فترة التسليم
            <select className={SELECT} value={period} onChange={event => setPeriod(event.target.value as CardWorkPeriod)}>
              {CARD_WORK_PERIODS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs font-semibold text-slate-700">حالة العمل
            <select className={SELECT} value={state} onChange={event => setState(event.target.value as typeof state)}>
              <option value="OPEN">مفتوح</option>
              <option value="CLOSED">مغلق أو منجز</option>
              <option value="ALL">جميع الحالات</option>
            </select>
          </label>
        </div>
        {filtered.length ? <ul className="space-y-2">
          {page.visible.map(item => {
            const member = members.get(item.assigneeId);
            const nav = item.kind === 'task' ? 'tasks' : 'cards';
            return <li key={`${item.kind}:${item.id}`} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_auto] sm:items-center">
              <div className="min-w-0 break-words">
                <p className="text-sm font-bold text-slate-900">{item.title}</p>
                <p className="mt-0.5 text-xs text-slate-600">{item.detail || KIND_LABELS[item.kind]}</p>
                {item.status === 'BLOCKED' && item.blockedReason && <p className="mt-1 text-xs text-rose-800">{item.blockedReason}</p>}
              </div>
              <div className="text-xs text-slate-700">
                <p className="font-semibold">{member?.name}</p>
                <p>{member?.departmentName}{member?.stationId && ` · ${stationName(stations, member.stationId)}`}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs sm:justify-end">
                <span className={`rounded-md px-2 py-1 font-semibold ${item.status === 'BLOCKED' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'}`}>{stateName(item)}</span>
                <span className="text-slate-600">{item.dueAt ? when(item.dueAt) : 'بلا موعد'}</span>
                {item.activeSeconds != null && <span className="text-slate-600">العمل {taskDurationLabel(item.activeSeconds)}</span>}
                {RbacService.canOpenScreen(currentUser, nav) && <button type="button" className="min-h-11 px-2 font-semibold text-blue-700" aria-label={`فتح ${item.title}`} onClick={() => onOpen({ nav, id: item.entityId })}>فتح</button>}
              </div>
            </li>;
          })}
        </ul> : <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">لا أعمال مسندة تطابق هذه التصفية.</p>}
        <ShowMore remaining={page.remaining} onMore={page.showMore} />
      </>}
    </section>
  );
}
