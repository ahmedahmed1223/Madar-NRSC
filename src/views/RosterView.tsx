import { confirmDialog } from '../services/dialogs';
import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Copy, Crown, Plus, UserCheck, X } from 'lucide-react';
import type { User } from '../types';
import { apiService } from '../services/api';
import { dataStore } from '../services/dataStore';
import { RbacService } from '../services/rbacService';
import { DEPARTMENTS, departmentIdOf, departmentName } from '../shared/departments';
import { onDutyAt, SHIFTS, ShiftId, RosterEntry } from '../shared/roster';
import { addDaysIso, arabicDate, localDateString } from '../shared/dates';
import { FilterTabs } from '../components/common/FilterTabs';
import { ShiftHandovers } from '../components/roster/ShiftHandovers';
import { ShiftGapPanel } from '../components/roster/ShiftGapPanel';
import { ENTITY_ID_PATTERN } from '../shared/collections';

interface RosterViewProps {
  users: User[];
  currentUser: User;
  onNavigate: (url: string) => void;
  focusId?: string | null;
}

const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const addDays = addDaysIso;

/** «الخميس 19/11» for a YYYY-MM-DD day. */
const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${DAY_NAMES[new Date(y, m - 1, d).getDay()]} ${d}/${m}`;
};

/** Weeks start on Saturday. */
const weekStartOf = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return addDays(date, -((day + 1) % 7));
};

/** Who is on duty in each department, per day and shift. */
export const RosterView: React.FC<RosterViewProps> = ({ users, currentUser, onNavigate, focusId }) => {
  const exactId = focusId?.startsWith('handover/') ? focusId.slice('handover/'.length) : undefined;
  const handoverId = exactId && ENTITY_ID_PATTERN.test(exactId) ? exactId : undefined;
  const focusHandover = focusId === 'handover' || !!handoverId;
  const [tab, setTab] = useState<'roster' | 'handover'>(() => focusHandover || new URLSearchParams(window.location.search).get('tab') === 'handover' ? 'handover' : 'roster');
  useEffect(() => { setTab(focusHandover || new URLSearchParams(window.location.search).get('tab') === 'handover' ? 'handover' : 'roster'); }, [focusId, focusHandover]);
  const changeTab = (next: 'roster' | 'handover') => {
    if (next === tab) return;
    setTab(next);
    onNavigate(next === 'handover' ? '/roster/handover' : '/roster');
  };
  const canManage = RbacService.hasPermission(currentUser, 'roster.manage');
  const [entries, setEntries] = useState<RosterEntry[]>(() => apiService.getRoster());
  const [weekStart, setWeekStart] = useState(() => weekStartOf(localDateString()));
  const [dayIndex, setDayIndex] = useState<number | null>(null);
  const [departmentId, setDepartmentId] = useState<string>(() => departmentIdOf(currentUser));
  const [adding, setAdding] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const unsubscribe = dataStore.subscribe((evt) => {
      if (evt.type === 'data-changed' && evt.collections.includes('roster')) setEntries(apiService.getRoster());
    });
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      unsubscribe();
      clearInterval(t);
    };
  }, []);

  const refresh = () => setEntries(apiService.getRoster());
  const run = (fn: () => void, ok?: string) => {
    try {
      fn();
      refresh();
      if (ok) setMessage({ ok: true, text: ok });
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message || 'تعذر حفظ التعديل' });
    }
  };

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const today = localDateString();
  const selectedDay = days[dayIndex ?? Math.max(0, days.indexOf(today))];
  const changeWeek = (start: string) => {
    setWeekStart(start);
    setDayIndex(null);
    setAdding(null);
  };
  const activeUsers = users.filter((u) => u.isActive !== false);
  const members = activeUsers.filter((u) => departmentIdOf(u) === departmentId);
  const others = activeUsers.filter((u) => departmentIdOf(u) !== departmentId);
  const onDutyNow = onDutyAt(entries, now);

  const cell = (date: string, shift: ShiftId) =>
    entries.filter((e) => e.date === date && e.shift === shift && e.departmentId === departmentId);

  const renderShiftEntries = (date: string, s: (typeof SHIFTS)[number], view: 'day' | 'week') => {
    const list = cell(date, s.id);
    const key = `${view}|${date}|${s.id}`;
    return (
      <div className="flex flex-col gap-1">
        {list.map((e) => (
          <span
            key={e.id}
            className={`inline-flex items-center justify-between gap-1 px-2 py-1 rounded-lg border ${
              e.isLead ? 'bg-amber-50 border-amber-200 text-amber-900 font-bold' : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}
          >
            <button
              type="button"
              disabled={!canManage}
              aria-pressed={canManage ? e.isLead === true : undefined}
              onClick={() => run(() => apiService.updateRosterEntry(e.id, { isLead: !e.isLead }))}
              title={canManage ? (e.isLead ? 'إلغاء تعيينه مسؤول الوردية' : 'تعيينه مسؤول الوردية') : undefined}
              className="inline-flex items-center gap-1 min-w-0 max-lg:min-h-11 truncate disabled:cursor-default"
            >
              {e.isLead && <Crown className="w-3 h-3 text-amber-500 shrink-0" />}
              <span className="truncate">{e.userName}</span>
            </button>
            {canManage && (
              <button
                type="button"
                onClick={() => run(() => apiService.removeRosterEntry(e.id))}
                aria-label={`إزالة ${e.userName} من الوردية`}
                className="max-lg:min-h-11 max-lg:min-w-11 inline-flex items-center justify-center p-1 rounded text-slate-500 hover:text-rose-600 hover:bg-white"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
        {canManage &&
          (adding === key ? (
            <select
              autoFocus
              aria-label="اختر الموظف"
              defaultValue=""
              onBlur={() => setAdding(null)}
              onChange={(ev) => {
                const userId = ev.target.value;
                setAdding(null);
                if (userId) run(() => apiService.addRosterEntry({ date, departmentId, shift: s.id, userId }));
              }}
              className="w-full min-w-0 max-lg:min-h-11 text-xs px-2 py-1 border border-slate-300 rounded-lg bg-white"
            >
              <option value="" disabled>
                اختر…
              </option>
              <optgroup label={departmentName(departmentId)}>
                {members.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </optgroup>
              <optgroup label="أقسام أخرى">
                {others.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} — {departmentName(departmentIdOf(u))}
                  </option>
                ))}
              </optgroup>
            </select>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(key)}
              aria-label={`إضافة مناوب ${s.name} يوم ${dayLabel(date)}`}
              className="inline-flex items-center justify-center gap-1 min-h-11 lg:min-h-7 px-2 py-1 rounded-lg border border-dashed border-slate-300 text-slate-500 hover:text-blue-600 hover:border-blue-300"
            >
              <Plus className="w-3 h-3" aria-hidden="true" />
              <span className="lg:hidden">إضافة مناوب</span>
            </button>
          ))}
        {!canManage && list.length === 0 && <p className="text-slate-600 lg:text-center">{view === 'day' ? 'لا مناوبين في هذه الوردية.' : '—'}</p>}
      </div>
    );
  };

  const weekLabel = `${days[0]} — ${days[6]}`;

  if (tab === 'handover') return <div className="space-y-4"><FilterTabs<'roster' | 'handover'> label="عرض المناوبات" active={tab} onChange={changeTab} tabs={[{ id: 'roster', label: 'جدول المناوبات' }, { id: 'handover', label: 'تسليم الوردية' }]} /><ShiftHandovers currentUser={currentUser} onNavigate={onNavigate} focusId={handoverId} /></div>;

  return (
    <div className="space-y-5">
      <FilterTabs<'roster' | 'handover'> label="عرض المناوبات" active={tab} onChange={changeTab} tabs={[{ id: 'roster', label: 'جدول المناوبات' }, { id: 'handover', label: 'تسليم الوردية' }]} />
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-blue-600" />
            جدول المناوبات
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            من المناوب في كل قسم وكل وردية؛ تُوجَّه طلبات الأقسام وتنبيهات الهواء إلى المناوبين.
          </p>
        </div>
        <div role="group" aria-label="أسبوع المناوبات" className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap">
          <button type="button" onClick={() => changeWeek(addDays(weekStart, -7))} className="w-11 h-11 sm:w-9 sm:h-9 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-50" aria-label="الأسبوع السابق">
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="grid justify-items-center sm:flex sm:items-center sm:gap-1.5 text-xs font-bold text-slate-700 tabular-nums" aria-live="polite">
            <time dateTime={days[0]}>{arabicDate(days[0])}</time>
            <span className="sr-only">إلى</span>
            <span className="hidden sm:inline" aria-hidden="true">–</span>
            <time dateTime={days[6]}>{arabicDate(days[6])}</time>
          </span>
          <button type="button" onClick={() => changeWeek(addDays(weekStart, 7))} className="w-11 h-11 sm:w-9 sm:h-9 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-50" aria-label="الأسبوع التالي">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="col-span-full flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => changeWeek(weekStartOf(today))} className="min-h-11 sm:min-h-9 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold">
              هذا الأسبوع
            </button>
            {canManage && (
              <button
                type="button"
                onClick={async () => {
                  if (!(await confirmDialog('نسخ مناوبات هذا الأسبوع (كل الأقسام) إلى الأسبوع التالي؟'))) return;
                  let n = 0;
                  run(() => {
                    n = apiService.copyRosterWeek(weekStart);
                  });
                  setMessage({ ok: true, text: n ? `نُسخت ${n} مناوبة إلى الأسبوع التالي` : 'لا شيء جديد للنسخ' });
                }}
                className="inline-flex items-center gap-1.5 min-h-11 sm:min-h-9 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold"
              >
                <Copy className="w-3.5 h-3.5" />
                نسخ للأسبوع التالي
              </button>
            )}
          </div>
        </div>
      </div>

      {message && (
        <div role="status" className={`p-3 rounded-xl text-xs font-bold flex justify-between ${message.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} aria-label="إغلاق" className="-m-1 p-1 rounded-lg hover:bg-white/60">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <ShiftGapPanel currentUser={currentUser} users={users} roster={entries} canManage={canManage} />

      {/* Department selector */}
      <FilterTabs<string>
        label="الأقسام"
        active={departmentId}
        onChange={setDepartmentId}
        tabs={DEPARTMENTS.map((d) => ({ id: d.id, label: d.name, tone: 'blue' as const }))}
      />

      <section aria-label="مناوبات اليوم المختار" className="lg:hidden space-y-3">
        <div className="grid gap-1">
          <label htmlFor="roster-day" className="text-xs font-semibold text-slate-700">يوم المناوبة</label>
          <select
            id="roster-day"
            value={selectedDay}
            onChange={(event) => {
              setDayIndex(days.indexOf(event.target.value));
              setAdding(null);
            }}
            className="w-full min-h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm"
          >
            {days.map((date) => <option key={date} value={date}>{dayLabel(date)}{date === today ? ' (اليوم)' : ''}</option>)}
          </select>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-200">
          {SHIFTS.map((s) => (
            <section key={s.id} aria-label={s.name} className="space-y-2 p-3">
              <h2 className="flex flex-wrap items-baseline justify-between gap-1 text-sm font-semibold text-slate-900">
                {s.name}
                <span dir="ltr" className="text-xs font-normal tabular-nums text-slate-600">{s.start} – {s.end}</span>
              </h2>
              {renderShiftEntries(selectedDay, s, 'day')}
            </section>
          ))}
        </div>
      </section>

      {/* On duty right now */}
      <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" aria-label="المناوبون الآن">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-emerald-700" />
          المناوبون الآن
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
          {DEPARTMENTS.map((d) => {
            const people = onDutyNow.filter((e) => e.departmentId === d.id);
            const chosen = d.id === departmentId;
            return (
              <button
                key={d.id}
                type="button"
                aria-pressed={chosen}
                title={`عرض مناوبات ${d.name}`}
                onClick={() => setDepartmentId(d.id)}
                className={`text-right p-2.5 rounded-xl border text-xs transition-colors ${
                  chosen ? 'border-blue-500 ring-1 ring-blue-500' : people.length ? 'border-emerald-200' : 'border-slate-200'
                } ${people.length ? 'bg-emerald-50/60 hover:bg-emerald-50' : 'bg-white hover:bg-slate-50'}`}
              >
                <span className="font-bold text-slate-800 block">{d.name}</span>
                <span className={`block mt-0.5 truncate ${people.length ? 'text-emerald-800' : 'text-amber-800'}`}>
                  {people.length ? people.map((p) => p.userName).join('، ') : 'لا يوجد مناوب'}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Week grid for the department */}
      <div role="region" aria-label="جدول المناوبات الأسبوعي" tabIndex={0} className="hidden lg:block bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full min-w-[860px] text-xs">
          <caption className="sr-only">مناوبات {departmentName(departmentId)} للأسبوع {weekLabel}</caption>
          <thead>
            <tr className="bg-slate-50 text-slate-600">
              <th scope="col" className="p-3 text-right min-w-32 sticky start-0 z-10 bg-slate-50">الوردية</th>
              {days.map((d) => {
                const [y, m, dd] = d.split('-').map(Number);
                return (
                  <th key={d} scope="col" aria-current={d === today ? 'date' : undefined} className={`p-3 text-center ${d === today ? 'bg-blue-50 text-blue-800' : ''}`}>
                    <span className="block font-bold">{DAY_NAMES[new Date(y, m - 1, dd).getDay()]}</span>
                    <span className="block tabular-nums text-2xs text-slate-500">{`${Number(d.slice(8))}/${Number(d.slice(5, 7))}`}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {SHIFTS.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 align-top">
                <th scope="row" className="p-3 text-right sticky start-0 z-[1] bg-white">
                  <span className="block font-bold text-slate-800">{s.name}</span>
                  <span className="block font-mono text-2xs text-slate-500" dir="ltr">
                    {s.start} – {s.end}
                  </span>
                </th>
                {days.map((date) => (
                  <td key={date} className={`p-2 ${date === today ? 'bg-blue-50/40' : ''}`}>
                    {renderShiftEntries(date, s, 'week')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && <p className="text-2xs text-slate-500">اضغط على اسم المناوب لتعيينه مسؤولاً عن الوردية (يظهر بتاج).</p>}
    </div>
  );
};
