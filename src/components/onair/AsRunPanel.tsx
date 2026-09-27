import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, History } from 'lucide-react';
import type { User } from '../../types';
import { apiService } from '../../services/api';
import { useLiveData } from '../../hooks/useLiveData';
import { asRunForDay } from '../../shared/asrun';
import { arabicDate, localDateString } from '../../shared/dates';
import { mmss } from '../../shared/bulletins';
import { ExportMenu, docContext } from '../common/ExportMenu';
import { asRunDoc } from '../../services/documents/builders';

const addDays = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return localDateString(new Date(y, m - 1, d + days));
};
const clock = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—');
const signed = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : n < 0 ? '-' : ''}${mmss(Math.abs(n))}`);
const tone = (n: number | null) => (n === null || Math.abs(n) < 30 ? 'text-slate-600' : n > 0 ? 'text-rose-700' : 'text-amber-700');

/** What actually aired on a day, segment by segment, against the plan. */
export const AsRunPanel: React.FC<{ currentUser: User }> = () => {
  useLiveData(['onAir', 'episodes', 'bulletins', 'bulletinStories'], 5000);
  const [day, setDay] = useState(localDateString());
  const shows = asRunForDay(apiService.getOnAirStates(), apiService.getAirShows(), day);

  return (
    <div className="space-y-4" data-testid="asrun">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setDay(addDays(day, -1))} aria-label="اليوم السابق" className="p-2 rounded-lg border border-slate-200 bg-white">
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="text-sm font-bold text-slate-800 min-w-[9rem] text-center">{arabicDate(day)}</span>
          <button type="button" onClick={() => setDay(addDays(day, 1))} aria-label="اليوم التالي" className="p-2 rounded-lg border border-slate-200 bg-white">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <input type="date" aria-label="التاريخ" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white" />
        </div>
        <ExportMenu items={[{ id: 'asrun', label: 'سجل البث الفعلي لليوم', hint: `${shows.length} بث — الأوقات الفعلية مقابل المخطط`, build: () => asRunDoc(shows, day, docContext()) }]} />
      </div>

      {shows.length === 0 ? (
        <div className="bg-white p-10 text-center rounded-2xl border border-dashed border-slate-300 text-xs text-slate-500 flex flex-col items-center gap-2">
          <History className="w-8 h-8 text-slate-300" />
          لم يُسجَّل بث في {arabicDate(day)}. يُسجَّل كل ما يُشغَّل من «وضع الهواء» تلقائياً.
        </div>
      ) : (
        shows.map((s) => (
          <section key={`${s.id}-${s.startedAt}`} aria-label={`${s.programName} — ${s.title}`} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="font-mono font-black text-slate-800" dir="ltr">{clock(s.startedAt)}</span>
              <strong className="text-slate-800">{s.programName ? `${s.programName}: ` : ''}{s.title}</strong>
              {s.status === 'LIVE' && <span className="px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold animate-pulse">على الهواء</span>}
              <span className="text-slate-500">
                الفعلي <b className="font-mono" dir="ltr">{s.actualSeconds === null ? '—' : mmss(s.actualSeconds)}</b> مقابل <b className="font-mono" dir="ltr">{mmss(s.plannedSeconds)}</b>
              </span>
              {s.startDelaySeconds !== null && (
                <span className={tone(s.startDelaySeconds)}>
                  البداية <b className="font-mono" dir="ltr">{signed(s.startDelaySeconds)}</b> عن الموعد
                </span>
              )}
              {s.operatorName && <span className="text-slate-400">التشغيل: {s.operatorName}</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[640px]">
                <thead className="text-[11px] text-slate-500">
                  <tr>
                    <th className="p-2 text-right">البداية</th>
                    <th className="p-2 text-right">النهاية</th>
                    <th className="p-2 text-right">الفقرة / القصة</th>
                    <th className="p-2 text-center">المخطط</th>
                    <th className="p-2 text-center">الفعلي</th>
                    <th className="p-2 text-center">الفرق</th>
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r, i) => (
                    <tr key={`${r.segmentId}-${i}`} className="border-t border-slate-100">
                      <td className="p-2 font-mono" dir="ltr">{clock(r.startedAt)}</td>
                      <td className="p-2 font-mono" dir="ltr">{clock(r.endedAt)}</td>
                      <td className="p-2 font-bold text-slate-800">{r.title}</td>
                      <td className="p-2 text-center font-mono" dir="ltr">{r.plannedSeconds === null ? '—' : mmss(r.plannedSeconds)}</td>
                      <td className="p-2 text-center font-mono" dir="ltr">{r.actualSeconds === null ? '—' : mmss(r.actualSeconds)}</td>
                      <td className={`p-2 text-center font-mono font-bold ${tone(r.diffSeconds)}`} dir="ltr">{signed(r.diffSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
};
