import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { apiService } from '../../services/api';
import { downloadCsv } from '../../services/csvExport';
import { assignmentReport, assignmentTotals, REPORT_DIMENSIONS, reportCsvRows, waitingByStepType, type ReportDimension, type ReportRow } from '../../shared/assignmentReports';
import { stepTypesOf, type ProductionCard } from '../../shared/productionCards';
import { stationsOf } from '../../shared/stations';
import { departmentIdOf } from '../../shared/departments';
import { minutesLabel } from '../../shared/workload';

interface AssignmentReportsProps {
  cards: ProductionCard[];
  now: number;
}

const PERIODS = [
  { id: 'day', name: 'آخر 24 ساعة', hours: 24 },
  { id: 'week', name: 'آخر 7 أيام', hours: 24 * 7 },
  { id: 'month', name: 'آخر 30 يوماً', hours: 24 * 30 },
] as const;

const SELECT = 'min-h-11 px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white';
const rate = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);
/** A measured duration; a measured zero reads «أقل من دقيقة», only «—» means nothing was measured. */
const cycle = (m: number | null) => (m === null ? '—' : m < 1 ? 'أقل من دقيقة' : minutesLabel(m));

/** «التقارير»: open, late, blocked and finished work by template, department, station or person, with cycle time and waits. */
export const AssignmentReports: React.FC<AssignmentReportsProps> = ({ cards, now }) => {
  const settings = apiService.getSettings();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['id']>('week');
  const [dimension, setDimension] = useState<ReportDimension>('template');
  const input = useMemo(() => {
    const hours = PERIODS.find((p) => p.id === period)!.hours;
    return {
      cards,
      stepTypes: stepTypesOf(settings),
      stations: stationsOf(settings),
      people: apiService.getUsers().map((u) => ({ id: u.id, name: u.fullName, stationId: u.stationId, departmentId: departmentIdOf(u) })),
      period: { from: now - hours * 3600_000, to: now },
      now,
    };
    // Settings are read on every render; the report follows the cards, the period and the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, period, now]);
  const rows = useMemo(() => assignmentReport(input, dimension), [input, dimension]);
  const totals = useMemo(() => assignmentTotals(input), [input]);
  // Only step types with a measured wait or something waiting now: rows of «—» say nothing.
  const waits = useMemo(() => waitingByStepType(input).filter((w) => w.avgWaitMinutes !== null || w.waitingNow > 0).slice(0, 8), [input]);
  const periodName = PERIODS.find((p) => p.id === period)!.name;
  const dimensionName = REPORT_DIMENSIONS.find((d) => d.id === dimension)?.name || '';
  const unit = dimension === 'template' ? 'التكليفات' : 'المهام';

  const tiles: { label: string; value: string | number; tone: string }[] = [
    { label: 'مفتوحة', value: totals.open, tone: 'text-slate-900' },
    { label: 'متأخرة', value: totals.late, tone: 'text-amber-700' },
    { label: 'متعطلة', value: totals.blocked, tone: 'text-rose-700' },
    { label: 'أُنجزت في الفترة', value: totals.done, tone: 'text-emerald-700' },
    { label: 'متوسط مدة الإنجاز', value: cycle(totals.avgCycleMinutes), tone: 'text-slate-900' },
    { label: 'الالتزام بالموعد', value: rate(totals.onTimeRate), tone: 'text-blue-700' },
  ];

  const table = (list: ReportRow[]) => (
    <div role="region" tabIndex={0} aria-label={`${unit} ${REPORT_DIMENSIONS.find((d) => d.id === dimension)?.name} (يمكن تمريره أفقياً)`} className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
      <table className="w-full min-w-[36rem] text-xs">
        <thead>
          <tr className="text-right text-slate-600 border-b border-slate-200">
            <th scope="col" className="p-3 font-bold">{REPORT_DIMENSIONS.find((d) => d.id === dimension)?.name.replace('حسب ', '')}</th>
            <th scope="col" className="p-3 font-bold">مفتوحة</th>
            <th scope="col" className="p-3 font-bold">متأخرة</th>
            <th scope="col" className="p-3 font-bold">متعطلة</th>
            <th scope="col" className="p-3 font-bold">أُنجزت</th>
            <th scope="col" className="p-3 font-bold">متوسط المدة</th>
            <th scope="col" className="p-3 font-bold">في الموعد</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {list.map((r) => (
            <tr key={r.key || 'none'} className="border-b border-slate-100 last:border-0">
              <th scope="row" className="p-3 text-right font-bold text-slate-800">{r.label}</th>
              <td className="p-3">{r.open}</td>
              <td className={`p-3 ${r.late ? 'text-amber-700 font-bold' : ''}`}>{r.late}</td>
              <td className={`p-3 ${r.blocked ? 'text-rose-700 font-bold' : ''}`}>{r.blocked}</td>
              <td className="p-3">{r.done}</td>
              <td className="p-3">{cycle(r.avgCycleMinutes)}</td>
              <td className="p-3">{rate(r.onTimeRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <section className="space-y-4" aria-label="تقارير التكليفات">
      {/* On paper: what the sheet is and which filters made it (the controls stay off the sheet). */}
      <p className="hidden print-only text-xs">
        <b>{settings.organizationName}</b> · تقرير التكليفات · {periodName} · {dimensionName}
      </p>
      <div className="flex flex-wrap items-center gap-2 no-print">
        <select aria-label="الفترة" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className={SELECT}>
          {PERIODS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select aria-label="التجميع" value={dimension} onChange={(e) => setDimension(e.target.value as ReportDimension)} className={SELECT}>
          {REPORT_DIMENSIONS.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <button type="button" onClick={() => downloadCsv(`تقرير-التكليفات-${period}-${dimension}`, reportCsvRows(rows, dimension))} className="inline-flex items-center gap-1.5 min-h-11 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 mr-auto">
          <Download className="w-4 h-4" />
          تصدير CSV
        </button>
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="bg-white border border-slate-200 rounded-2xl p-3">
            <dt className="text-2xs text-slate-600">{t.label}</dt>
            <dd className={`text-xl font-bold tabular-nums ${t.value && t.value !== '—' ? t.tone : 'text-slate-900'}`}>{t.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-2xs text-slate-500">
        {dimension === 'template' ? 'تُعدّ التكليفات كاملة؛ مدة الإنجاز من الإنشاء حتى اكتمال آخر مهمة.' : 'تُعدّ المهام؛ مدة الإنجاز من بدء العمل حتى التسليم.'} «في الموعد» نسبة ما سُلّم قبل موعده مما له موعد.
      </p>

      {rows.length === 0 ? <p className="text-center text-xs text-slate-500 py-10 bg-white border border-dashed border-slate-300 rounded-2xl">لا تكليفات في هذه الفترة.</p> : table(rows)}

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-slate-900">أين تنتظر المهام أطول؟</h2>
        <p className="text-2xs text-slate-500">من اكتمال المهمة السابقة حتى بدء العمل، حسب نوع المهمة.</p>
        {waits.length === 0 ? (
          <p className="text-xs text-slate-500">لا انتظار يُذكر في هذه الفترة.</p>
        ) : (
          <ul className="space-y-1.5">
            {waits.map((w) => (
              <li key={w.type} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-2 rounded-xl border border-slate-200 bg-white text-xs">
                <b className="text-slate-900 min-w-28">{w.label}</b>
                <span className="text-slate-700">متوسط الانتظار: {cycle(w.avgWaitMinutes)}</span>
                {w.waitingNow > 0 && <span className="text-amber-800">تنتظر الآن: {w.waitingNow} (أطولها {minutesLabel(w.longestWaitMinutes)})</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
};
