import { confirmDialog } from '../services/dialogs';
import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Copy, Crown, Plus, UserCheck, X } from 'lucide-react';
import type { User } from '../types';
import { apiService } from '../services/api';
import { dataStore } from '../services/dataStore';
import { RbacService } from '../services/rbacService';
import { DEPARTMENTS, departmentIdOf, departmentName } from '../shared/departments';
import { onDutyAt, SHIFTS, ShiftId, RosterEntry } from '../shared/roster';
import { addDaysIso, localDateString } from '../shared/dates';

interface RosterViewProps {
  users: User[];
  currentUser: User;
}

const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const addDays = addDaysIso;

/** Weeks start on Saturday. */
const weekStartOf = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return addDays(date, -((day + 1) % 7));
};

/** Who is on duty in each department, per day and shift. */
export const RosterView: React.FC<RosterViewProps> = ({ users, currentUser }) => {
  const canManage = RbacService.hasPermission(currentUser, 'roster.manage');
  const [entries, setEntries] = useState<RosterEntry[]>(() => apiService.getRoster());
  const [weekStart, setWeekStart] = useState(() => weekStartOf(localDateString()));
  const [departmentId, setDepartmentId] = useState<string>(() => departmentIdOf(currentUser));
  const [adding, setAdding] = useState<string | null>(null); // `${date}|${shift}`
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
  const activeUsers = users.filter((u) => u.isActive !== false);
  const members = activeUsers.filter((u) => departmentIdOf(u) === departmentId);
  const others = activeUsers.filter((u) => departmentIdOf(u) !== departmentId);
  const onDutyNow = onDutyAt(entries, now);

  const cell = (date: string, shift: ShiftId) =>
    entries.filter((e) => e.date === date && e.shift === shift && e.departmentId === departmentId);

  const weekLabel = `${days[0]} — ${days[6]}`;

  return (
    <div className="space-y-5">
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
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))} className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50" aria-label="الأسبوع السابق">
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="text-xs font-bold text-slate-700 font-mono px-2" dir="ltr" aria-live="polite">{`${days[0]} → ${days[6]}`}</span>
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))} className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50" aria-label="الأسبوع التالي">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => setWeekStart(weekStartOf(today))} className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold">
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
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold"
            >
              <Copy className="w-3.5 h-3.5" />
              نسخ للأسبوع التالي
            </button>
          )}
        </div>
      </div>

      {message && (
        <div role="status" className={`p-3 rounded-xl text-xs font-bold flex justify-between ${message.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} aria-label="إغلاق">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* On duty right now */}
      <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" aria-label="المناوبون الآن">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-emerald-600" />
          المناوبون الآن
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
          {DEPARTMENTS.map((d) => {
            const people = onDutyNow.filter((e) => e.departmentId === d.id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setDepartmentId(d.id)}
                className={`text-right p-2.5 rounded-xl border text-xs transition-colors ${
                  people.length ? 'bg-emerald-50/60 border-emerald-200 hover:bg-emerald-50' : 'bg-amber-50/60 border-amber-200 hover:bg-amber-50'
                }`}
              >
                <span className="font-bold text-slate-800 block">{d.name}</span>
                <span className={`block mt-0.5 truncate ${people.length ? 'text-emerald-800' : 'text-amber-700'}`}>
                  {people.length ? people.map((p) => p.userName).join('، ') : 'لا يوجد مناوب'}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Department selector */}
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="الأقسام">
        {DEPARTMENTS.map((d) => (
          <button
            key={d.id}
            type="button"
            role="tab"
            aria-selected={departmentId === d.id}
            onClick={() => setDepartmentId(d.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap border transition-colors ${
              departmentId === d.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {d.name}
          </button>
        ))}
      </div>

      {/* Week grid for the department */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full min-w-[860px] text-xs">
          <caption className="sr-only">مناوبات {departmentName(departmentId)} للأسبوع {weekLabel}</caption>
          <thead>
            <tr className="bg-slate-50 text-slate-600">
              <th scope="col" className="p-3 text-right w-32">الوردية</th>
              {days.map((d) => {
                const [y, m, dd] = d.split('-').map(Number);
                return (
                  <th key={d} scope="col" className={`p-3 text-center ${d === today ? 'text-blue-700' : ''}`}>
                    <span className="block font-bold">{DAY_NAMES[new Date(y, m - 1, dd).getDay()]}</span>
                    <span className="block font-mono text-[10px] text-slate-400">{d.slice(5)}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {SHIFTS.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 align-top">
                <th scope="row" className="p-3 text-right">
                  <span className="block font-bold text-slate-800">{s.name}</span>
                  <span className="block font-mono text-[10px] text-slate-400" dir="ltr">
                    {s.start} – {s.end}
                  </span>
                </th>
                {days.map((date) => {
                  const list = cell(date, s.id);
                  const key = `${date}|${s.id}`;
                  return (
                    <td key={date} className={`p-2 ${date === today ? 'bg-blue-50/40' : ''}`}>
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
                              onClick={() => run(() => apiService.updateRosterEntry(e.id, { isLead: !e.isLead }))}
                              title={canManage ? (e.isLead ? 'إلغاء تعيينه مسؤول الوردية' : 'تعيينه مسؤول الوردية') : undefined}
                              className="inline-flex items-center gap-1 truncate disabled:cursor-default"
                            >
                              {e.isLead && <Crown className="w-3 h-3 text-amber-500 shrink-0" />}
                              <span className="truncate">{e.userName}</span>
                            </button>
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => run(() => apiService.removeRosterEntry(e.id))}
                                aria-label={`إزالة ${e.userName} من الوردية`}
                                className="text-slate-400 hover:text-rose-600"
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
                              className="w-full text-xs px-2 py-1 border border-slate-300 rounded-lg bg-white"
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
                              aria-label={`إضافة مناوب ${s.name} يوم ${date}`}
                              className="inline-flex items-center justify-center gap-1 px-2 py-1 rounded-lg border border-dashed border-slate-300 text-slate-400 hover:text-blue-600 hover:border-blue-300"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          ))}
                        {!canManage && list.length === 0 && <span className="text-slate-300 text-center">—</span>}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && <p className="text-[11px] text-slate-500">اضغط على اسم المناوب لتعيينه مسؤولاً عن الوردية (يظهر بتاج).</p>}
    </div>
  );
};
