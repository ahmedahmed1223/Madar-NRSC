import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Download, Printer, Scale } from 'lucide-react';
import type { User } from '../types';
import { apiService } from '../services/api';
import { dataStore } from '../services/dataStore';
import { RbacService } from '../services/rbacService';
import { FilterTabs } from '../components/common/FilterTabs';
import { stationDay, timeOnly, when } from '../components/cards/cardUi';
import { formatDay } from '../shared/dateFormat';
import { buildHandover, HANDOVER_SECTIONS, handoverText } from '../shared/handover';
import { cardKindName, stepTypesOf } from '../shared/productionCards';
import { stationName, stationScope, stationsOf } from '../shared/stations';
import { collectWork, employeeFile, loadByPerson, loadByStation, minutesLabel, productionSummary, type LoadLevel, type Period, type WorkItem } from '../shared/workload';

interface WorkloadViewProps {
  currentUser: User;
  users: User[];
  onOpen: (ref: WorkItem['ref']) => void;
}

type Tab = 'LOAD' | 'OUTPUT' | 'FILE' | 'HANDOVER';
type Range = 'today' | 'week' | 'month' | 'custom';

const SELECT = 'px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white';
const TH = 'p-3 font-bold text-right whitespace-nowrap';
const TD = 'p-3 tabular-nums';
const LEVEL: Record<LoadLevel, { name: string; style: string }> = {
  HIGH: { name: 'حمل مرتفع', style: 'bg-rose-50 text-rose-700 border-rose-200' },
  NORMAL: { name: 'متوازن', style: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  LOW: { name: 'طاقة متاحة', style: 'bg-sky-50 text-sky-800 border-sky-200' },
};
const RANGE_NAMES: Record<Range, string> = { today: 'اليوم', week: 'آخر 7 أيام', month: 'آخر 30 يوماً', custom: 'فترة محددة' };

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

function downloadCsv(name: string, rows: unknown[][]) {
  const blob = new Blob([`﻿${rows.map((r) => r.map(csvCell).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Workload and performance: how work is spread between stations and people, what was produced,
 * each colleague's record of work (printable as PDF) and the shift handover brief.
 */
export const WorkloadView: React.FC<WorkloadViewProps> = ({ currentUser, users, onOpen }) => {
  const canView = RbacService.hasPermission(currentUser, 'workload.view');
  const canViewAll = RbacService.hasPermission(currentUser, 'workload.view_all');
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<Tab>(canView ? 'LOAD' : 'FILE');
  const [range, setRange] = useState<Range>('week');
  const [fromDay, setFromDay] = useState(() => stationDay(Date.now() - 6 * 86400_000));
  const [toDay, setToDay] = useState(() => stationDay(Date.now()));
  const [station, setStation] = useState('ALL');
  const [personId, setPersonId] = useState(currentUser.id);
  const [shiftHours, setShiftHours] = useState(8);
  const [copied, setCopied] = useState(false);

  useEffect(
    () =>
      dataStore.subscribe((evt) => {
        if (evt.type === 'data-changed' && evt.collections.some((c) => ['productionCards', 'tasks', 'requests', 'news', 'users', 'settings'].includes(c))) setVersion((v) => v + 1);
      }),
    []
  );

  const settings = useMemo(() => apiService.getSettings(), [version]);
  const stations = stationsOf(settings);
  const stepTypes = stepTypesOf(settings);
  const cards = useMemo(() => apiService.getCards(), [version]);

  // Supervisors follow their own station and the ones linked to it; central management follows all.
  const scope = useMemo(() => (canViewAll ? new Set(stations.map((s) => s.id)) : stationScope(stations, currentUser.stationId)), [canViewAll, stations, currentUser.stationId]);
  const seesEverything = scope.size === stations.length;
  const visibleStations = stations.filter((s) => scope.has(s.id));
  const visibleUsers = useMemo(
    () => (canView ? users.filter((u) => u.isActive !== false && !u.deletedAt && (seesEverything || (u.stationId && scope.has(u.stationId)) || u.id === currentUser.id)) : users.filter((u) => u.id === currentUser.id)),
    [canView, users, scope, seesEverything, currentUser.id]
  );

  const period: Period = useMemo(() => {
    const now = new Date();
    if (range === 'custom') {
      const from = new Date(`${fromDay}T00:00:00`).getTime();
      const to = new Date(`${toDay}T00:00:00`).getTime() + 86400_000;
      return Number.isFinite(from) && Number.isFinite(to) && to > from ? { from, to } : { from: startOfDay(now), to: startOfDay(now) + 86400_000 };
    }
    const days = range === 'today' ? 0 : range === 'week' ? 6 : 29;
    return { from: startOfDay(now) - days * 86400_000, to: startOfDay(now) + 86400_000 };
  }, [range, fromDay, toDay]);
  const periodLabel = range === 'custom' ? `${formatDay(fromDay)} — ${formatDay(toDay)}` : RANGE_NAMES[range];

  const items = useMemo(
    () => collectWork({ cards, tasks: apiService.getTasks(), requests: apiService.getRequests(), news: apiService.getNews(), users, stepTypes }),
    // Recomputed when shared data changes (version) or the user list is replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, users]
  );
  const scopedItems = useMemo(() => (seesEverything ? items : items.filter((i) => i.stationId && scope.has(i.stationId))), [items, scope, seesEverything]);

  const stationRows = useMemo(() => loadByStation(scopedItems, visibleUsers, visibleStations, period), [scopedItems, visibleUsers, visibleStations, period]);
  const peopleRows = useMemo(
    () =>
      loadByPerson(scopedItems, visibleUsers, period)
        .filter((r) => station === 'ALL' || r.stationId === station)
        .sort((a, b) => b.openPoints - a.openPoints || b.donePoints - a.donePoints || a.name.localeCompare(b.name, 'ar')),
    [scopedItems, visibleUsers, period, station]
  );
  const output = useMemo(() => productionSummary(seesEverything ? cards : cards.filter((c) => c.steps.some((s) => s.stationId && scope.has(s.stationId))), stepTypes, period), [cards, stepTypes, period, scope, seesEverything]);

  const person = visibleUsers.find((u) => u.id === personId) || currentUser;
  const file = useMemo(() => employeeFile(items, person, period, stationDay), [items, person, period]);

  const handoverStation = station === 'ALL' ? (seesEverything ? null : currentUser.stationId || null) : station;
  const brief = useMemo(() => {
    const now = Date.now();
    return buildHandover(cards, { stationId: handoverStation, from: now - shiftHours * 3600_000, now, aheadHours: shiftHours, stepTypes, time: when });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, handoverStation, shiftHours, version]);
  const briefHeading = `موجز تسليم المناوبة — ${handoverStation ? stationName(stations, handoverStation) : 'كل المحطات'} — ${when(new Date(brief.from).toISOString())} إلى ${timeOnly(new Date(brief.to).toISOString())}`;

  const openFile = (id: string) => {
    setPersonId(id);
    setTab('FILE');
  };

  const exportFile = () =>
    downloadCsv(`ملف-إنجاز-${person.fullName}.csv`, [
      ['ملف إنجاز', person.fullName, stationName(stations, person.stationId), periodLabel],
      [],
      ['الحالة', 'النوع', 'المادة', 'النقاط', 'الوقت الفعلي (د)', 'بدأ', 'أُنجز', 'التسليم المطلوب'],
      ...file.done.map((i) => ['منجز', i.typeName, i.title, i.points, i.spentMinutes ?? '', i.startedAt ? when(i.startedAt) : '', when(i.doneAt), i.dueAt ? when(i.dueAt) : '']),
      ...file.open.map((i) => [i.blocked ? 'متعطل' : i.overdue ? 'متأخر' : 'مفتوح', i.typeName, i.title, i.points, '', i.startedAt ? when(i.startedAt) : '', '', i.dueAt ? when(i.dueAt) : '']),
    ]);

  const stationFilter = (allLabel: string) => (
    <select aria-label="المحطة" value={station} onChange={(e) => setStation(e.target.value)} className={SELECT}>
      {(seesEverything || visibleStations.length > 1) && <option value="ALL">{allLabel}</option>}
      {visibleStations.map((s) => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </select>
  );

  const periodFilter = (
    <>
      <select aria-label="الفترة" value={range} onChange={(e) => setRange(e.target.value as Range)} className={SELECT}>
        {(Object.keys(RANGE_NAMES) as Range[]).map((r) => (
          <option key={r} value={r}>{RANGE_NAMES[r]}</option>
        ))}
      </select>
      {range === 'custom' && (
        <>
          <input type="date" aria-label="من يوم" value={fromDay} max={toDay} onChange={(e) => setFromDay(e.target.value)} className={SELECT} />
          <input type="date" aria-label="إلى يوم" value={toDay} min={fromDay} onChange={(e) => setToDay(e.target.value)} className={SELECT} />
        </>
      )}
    </>
  );

  const itemRow = (item: WorkItem, date: string) => (
    <tr key={item.key} className="border-b border-slate-100 last:border-0">
      <td className="p-3 whitespace-nowrap text-slate-600">{date}</td>
      <td className="p-3 whitespace-nowrap">{item.typeName}</td>
      <td className="p-3">
        <button type="button" onClick={() => onOpen(item.ref)} className="text-blue-700 hover:underline text-right font-bold">{item.title}</button>
        <span className="hidden print-only font-bold">{item.title}</span>
      </td>
      <td className={TD}>{item.points}</td>
      <td className={TD}>{minutesLabel(item.open ? item.estimateMinutes || 0 : item.spentMinutes || 0)}</td>
    </tr>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Scale className="w-5 h-5 text-blue-600" />
            الأعباء والأداء
          </h1>
          <p className="text-xs text-slate-500 mt-1">من يحمل ماذا الآن، وما أنجزه كل فرد وكل محطة، محسوباً من العمل الموثّق في المنصة.</p>
        </div>
      </div>

      <FilterTabs<Tab>
        label="الأعباء والأداء"
        active={tab}
        onChange={setTab}
        tabs={[
          ...(canView ? [{ id: 'LOAD' as const, label: 'توزيع الأعباء', tone: 'blue' as const }, { id: 'OUTPUT' as const, label: 'الإنتاج', tone: 'emerald' as const }] : []),
          { id: 'FILE' as const, label: canView ? 'ملف موظف' : 'ملف إنجازي', tone: 'violet' as const },
          { id: 'HANDOVER' as const, label: 'تسليم المناوبة', tone: 'amber' as const },
        ]}
      />

      {tab === 'LOAD' && canView && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 no-print">
            {periodFilter}
            <span className="text-2xs text-slate-500">الفترة تخص عمود «أُنجز»؛ الأعباء المفتوحة هي الحالية.</span>
          </div>
          <section className="space-y-2">
            <h2 className="text-sm font-bold text-slate-900">مقارنة المحطات</h2>
            <p className="text-2xs text-slate-500">نقاط الحمل = وزن نوع المهمة × درجة تعقيدها (تُضبط الأوزان من الإعدادات). «الحمل للفرد» يقسم النقاط المفتوحة على عدد أفراد المحطة، وبه يُقارن بين المحطات قبل طلب موظفين إضافيين.</p>
            <div role="region" tabIndex={0} aria-label={`جدول مقارنة المحطات (يمكن تمريره أفقياً)`} className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
              <table className="w-full min-w-[44rem] text-xs">
                <thead>
                  <tr className="text-slate-600 border-b border-slate-200">
                    {['المحطة', 'الأفراد', 'مهام مفتوحة', 'نقاط الحمل', 'الحمل للفرد', 'متأخرة', 'متعطلة', 'لم تُستلم', 'أُنجز في الفترة', 'التقييم'].map((h) => (
                      <th key={h} scope="col" className={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stationRows.map((row) => (
                    <tr key={row.id || 'none'} className="border-b border-slate-100 last:border-0">
                      <th scope="row" className="p-3 text-right font-bold text-slate-900 whitespace-nowrap">{row.name}</th>
                      <td className={TD}>{row.people}</td>
                      <td className={TD}>{row.open}</td>
                      <td className={TD}>{row.openPoints}</td>
                      <td className={`${TD} font-bold`}>{row.level ? row.perPerson.toFixed(1) : '—'}</td>
                      <td className={`${TD} ${row.overdue ? 'text-amber-700 font-bold' : ''}`}>{row.overdue}</td>
                      <td className={`${TD} ${row.blocked ? 'text-rose-700 font-bold' : ''}`}>{row.blocked}</td>
                      <td className={TD}>{row.unassigned}</td>
                      <td className={TD}>{row.done} ({row.donePoints} نقطة)</td>
                      <td className="p-3">{row.level ? <span className={`px-2 py-0.5 rounded-md border font-bold whitespace-nowrap ${LEVEL[row.level].style}`}>{LEVEL[row.level].name}</span> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">الأفراد</h2>
              <span className="no-print">{stationFilter('كل المحطات')}</span>
            </div>
            <div role="region" tabIndex={0} aria-label={`جدول أعباء الأفراد (يمكن تمريره أفقياً)`} className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
              <table className="w-full min-w-[44rem] text-xs">
                <thead>
                  <tr className="text-slate-600 border-b border-slate-200">
                    {['الاسم', 'المحطة', 'مفتوحة', 'نقاط الحمل', 'وقت مقدر', 'متأخرة', 'متعطلة', 'أُنجز', 'نقاط منجزة', 'وقت فعلي'].map((h) => (
                      <th key={h} scope="col" className={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {peopleRows.length === 0 && (
                    <tr><td colSpan={10} className="p-6 text-center text-slate-500">لا أفراد في هذه المحطة. تُحدَّد محطة كل زميل من «المستخدمون والصلاحيات».</td></tr>
                  )}
                  {peopleRows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 last:border-0">
                      <th scope="row" className="p-3 text-right">
                        <button type="button" onClick={() => openFile(row.id)} className="font-bold text-blue-700 hover:underline text-right whitespace-nowrap">{row.name}</button>
                        <span className="block text-2xs font-normal text-slate-500 max-w-48 truncate">{row.jobTitle}</span>
                      </th>
                      <td className="p-3 whitespace-nowrap">{stationName(stations, row.stationId)}</td>
                      <td className={TD}>{row.open}</td>
                      <td className={`${TD} font-bold`}>{row.openPoints}</td>
                      <td className={TD}>{minutesLabel(row.openMinutes)}</td>
                      <td className={`${TD} ${row.overdue ? 'text-amber-700 font-bold' : ''}`}>{row.overdue}</td>
                      <td className={`${TD} ${row.blocked ? 'text-rose-700 font-bold' : ''}`}>{row.blocked}</td>
                      <td className={TD}>{row.done}</td>
                      <td className={TD}>{row.donePoints}</td>
                      <td className={TD}>{minutesLabel(row.spentMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === 'OUTPUT' && canView && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 no-print">{periodFilter}</div>
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="bg-white border border-slate-200 rounded-2xl p-3">
              <dt className="text-2xs text-slate-600">مواد أُنجزت ({periodLabel})</dt>
              <dd className="text-2xl font-bold tabular-nums text-slate-900">{output.total}</dd>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-3">
              <dt className="text-2xs text-slate-600">منها مشتركة بين محطات</dt>
              <dd className="text-2xl font-bold tabular-nums text-slate-900">{output.shared}</dd>
            </div>
            {output.byKind.slice(0, 2).map((k) => (
              <div key={k.kind} className="bg-white border border-slate-200 rounded-2xl p-3">
                <dt className="text-2xs text-slate-600">{cardKindName(k.kind)}</dt>
                <dd className="text-2xl font-bold tabular-nums text-slate-900">{k.count}</dd>
              </div>
            ))}
          </dl>
          <section className="space-y-2">
            <h2 className="text-sm font-bold text-slate-900">إسهام كل محطة</h2>
            <p className="text-2xs text-slate-500">المادة المشتركة تُحتسب مرة واحدة في الإجمالي أعلاه، وتظهر هنا عند كل محطة أنجزت فيها مهمة، بنقاط ما أنجزته.</p>
            <div role="region" tabIndex={0} aria-label={`جدول إسهام كل محطة (يمكن تمريره أفقياً)`} className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
              <table className="w-full min-w-[44rem] text-xs">
                <thead>
                  <tr className="text-slate-600 border-b border-slate-200">
                    {['المحطة', 'مواد شاركت فيها', 'منها مشتركة', 'مهام أنجزتها', 'النقاط', 'حصتها من العمل'].map((h) => (
                      <th key={h} scope="col" className={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {output.byStation.length === 0 && (
                    <tr><td colSpan={6} className="p-6 text-center text-slate-500">لم تكتمل بطاقات إنتاج في هذه الفترة.</td></tr>
                  )}
                  {output.byStation.map((row) => (
                    <tr key={row.stationId || 'none'} className="border-b border-slate-100 last:border-0">
                      <th scope="row" className="p-3 text-right font-bold text-slate-900 whitespace-nowrap">{stationName(stations, row.stationId)}</th>
                      <td className={TD}>{row.cards}</td>
                      <td className={TD}>{row.shared}</td>
                      <td className={TD}>{row.steps}</td>
                      <td className={TD}>{row.points}</td>
                      <td className={`${TD} font-bold`}>{row.share}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {output.byKind.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-bold text-slate-900">حسب نوع المادة</h2>
              <div className="flex flex-wrap gap-2">
                {output.byKind.map((k) => (
                  <span key={k.kind} className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-700"><b>{cardKindName(k.kind)}</b>: {k.count}</span>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {tab === 'FILE' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 no-print">
            {canView && (
              <select aria-label="الموظف" value={person.id} onChange={(e) => setPersonId(e.target.value)} className={SELECT}>
                {visibleUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName} — {stationName(stations, u.stationId)}</option>
                ))}
              </select>
            )}
            {periodFilter}
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 mr-auto">
              <Printer className="w-4 h-4" />
              طباعة / حفظ PDF
            </button>
            <button type="button" onClick={exportFile} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700">
              <Download className="w-4 h-4" />
              CSV
            </button>
          </div>

          <header>
            <h2 className="text-lg font-bold text-slate-900">ملف إنجاز: {person.fullName}</h2>
            <p className="text-xs text-slate-600">
              {person.jobTitle} — {stationName(stations, person.stationId)} — {periodLabel}
              <span className="hidden print-only"> — {settings.organizationName}</span>
            </p>
          </header>

          <dl className="grid grid-cols-2 lg:grid-cols-5 gap-2">
            {[
              { label: 'مواد أنجزها', value: file.totals.done },
              { label: 'نقاط الإنجاز', value: file.totals.donePoints },
              { label: 'الوقت الفعلي المسجّل', value: minutesLabel(file.totals.spentMinutes) },
              { label: 'أيام عمل فيها', value: file.days.length },
              { label: 'على مكتبه الآن', value: file.totals.open },
            ].map((stat) => (
              <div key={stat.label} className="bg-white border border-slate-200 rounded-2xl p-3">
                <dt className="text-2xs text-slate-600">{stat.label}</dt>
                <dd className="text-xl font-bold tabular-nums text-slate-900">{stat.value}</dd>
              </div>
            ))}
          </dl>

          {file.byType.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-bold text-slate-900">حسب نوع العمل</h3>
              <div className="flex flex-wrap gap-2">
                {file.byType.map((t) => (
                  <span key={t.typeName} className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-700"><b>{t.typeName}</b>: {t.count} ({t.points} نقطة)</span>
                ))}
              </div>
            </section>
          )}

          {file.days.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-bold text-slate-900">متى عمل</h3>
              <div className="flex flex-wrap gap-2">
                {file.days.map((d) => (
                  <span key={d.date} className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-700"><b>{formatDay(d.date)}</b>: أنجز {d.done}، بدأ {d.started}</span>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-sm font-bold text-slate-900">ما أنجزه ({file.done.length})</h3>
            <div role="region" tabIndex={0} aria-label={`جدول ما أنجزه (يمكن تمريره أفقياً)`} className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
              <table className="w-full min-w-[44rem] text-xs">
                <thead>
                  <tr className="text-slate-600 border-b border-slate-200">
                    {['أُنجز', 'النوع', 'المادة', 'النقاط', 'الوقت الفعلي'].map((h) => (
                      <th key={h} scope="col" className={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {file.done.length === 0 && (
                    <tr><td colSpan={5} className="p-6 text-center text-slate-500">لا إنجاز مسجّل في هذه الفترة.</td></tr>
                  )}
                  {file.done.map((item) => itemRow(item, when(item.doneAt)))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-bold text-slate-900">على مكتبه الآن ({file.open.length})</h3>
            <div role="region" tabIndex={0} aria-label={`جدول ما على مكتبه الآن (يمكن تمريره أفقياً)`} className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
              <table className="w-full min-w-[44rem] text-xs">
                <thead>
                  <tr className="text-slate-600 border-b border-slate-200">
                    {['التسليم', 'النوع', 'المادة', 'النقاط', 'الوقت المقدر'].map((h) => (
                      <th key={h} scope="col" className={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {file.open.length === 0 && (
                    <tr><td colSpan={5} className="p-6 text-center text-slate-500">لا مهام مفتوحة.</td></tr>
                  )}
                  {file.open.map((item) => itemRow(item, item.blocked ? 'متعطلة' : item.dueAt ? `${when(item.dueAt)}${item.overdue ? ' (متأخرة)' : ''}` : '—'))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === 'HANDOVER' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 no-print">
            {stationFilter('كل المحطات')}
            <select aria-label="مدة المناوبة" value={shiftHours} onChange={(e) => setShiftHours(Number(e.target.value))} className={SELECT}>
              {[6, 8, 12, 24].map((h) => (
                <option key={h} value={h}>آخر {h} ساعة</option>
              ))}
            </select>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(handoverText(brief, briefHeading));
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2500);
                } catch {
                  setCopied(false);
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 mr-auto"
            >
              <Copy className="w-4 h-4" />
              {copied ? 'نُسخ الموجز' : 'نسخ نصاً'}
            </button>
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700">
              <Printer className="w-4 h-4" />
              طباعة / حفظ PDF
            </button>
          </div>
          <header>
            <h2 className="text-lg font-bold text-slate-900">{briefHeading}</h2>
            <p className="text-xs text-slate-600">يُعدّه النظام من العمل الموثّق في بطاقات الإنتاج؛ يراجعه مسؤول المناوبة قبل التسليم.</p>
          </header>
          {HANDOVER_SECTIONS.map((section) => {
            const rows = brief[section.key];
            return (
              <section key={section.key} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
                <h3 className="text-sm font-bold text-slate-900">{section.title} <span className="font-normal text-slate-500 tabular-nums">({rows.length})</span></h3>
                {rows.length === 0 ? (
                  <p className="text-xs text-slate-500">{section.empty}</p>
                ) : (
                  <ul className="space-y-1.5 text-xs">
                    {rows.map((row, index) => (
                      <li key={`${row.cardId}:${index}`} className="leading-6">
                        {row.urgent && <span className="ml-1 px-1.5 py-0.5 rounded bg-red-600 text-white font-bold text-3xs">عاجل</span>}
                        <button type="button" onClick={() => onOpen({ nav: 'cards', id: row.cardId })} className="font-bold text-blue-700 hover:underline">{row.title}</button>
                        <span className="hidden print-only font-bold">{row.title}</span>
                        <span className="text-slate-700"> — {row.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};
