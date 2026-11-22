import { useLiveData } from '../../hooks/useLiveData';
import { apiService } from '../../services/api';
import { airingSummary, type BroadcastArchiveItem, type BroadcastWithArchive } from '../../shared/broadcastArchive';
import { departmentName, departmentsOf } from '../../shared/departments';
import { stationName, stationsOf } from '../../shared/stations';

export function AiringOutcomes({ accepts }: { accepts: (state: BroadcastWithArchive, item: BroadcastArchiveItem) => boolean }) {
  useLiveData(['onAir', 'settings'], 30_000);
  const settings = apiService.getSettings();
  const stations = stationsOf(settings);
  const departments = departmentsOf(settings);
  const groups = airingSummary(apiService.getOnAirStates(), accepts);
  return (
    <section aria-label="المُعدّ والمذاع فعليًا" className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">المُعدّ والمذاع فعليًا</h2>
      <p className="mt-1 text-xs text-slate-600">تعتمد الأرقام على الرانداون المحفوظ عند إغلاق البث، وتستبعد الفواصل.</p>
      {groups.length === 0 ? <p className="mt-3 text-sm text-slate-600">لا توجد سجلات بث موثقة ضمن نطاق العرض.</p> : (
        <div className="mt-3 overflow-x-auto" role="region" tabIndex={0} aria-label="نتائج البث حسب المحطة والقسم">
          <table className="min-w-[40rem] w-full text-start text-xs">
            <thead><tr className="border-b border-slate-200 text-slate-600">
              {['المحطة', 'القسم', 'المُعدّ', 'المذاع', 'مؤجل', 'مسقط', 'لم يُذع', 'نسبة البث'].map(label => <th key={label} scope="col" className="px-2 py-2 text-start">{label}</th>)}
            </tr></thead>
            <tbody>{groups.map(row => (
              <tr key={JSON.stringify([row.stationId, row.departmentId])} className="border-b border-slate-100">
                <th scope="row" className="px-2 py-2 text-start">{row.stationId ? stationName(stations, row.stationId) : 'غير محددة'}</th>
                <td className="px-2 py-2">{row.departmentId ? departments.find(department => department.id === row.departmentId)?.name || departmentName(row.departmentId) : 'غير محدد'}</td>
                {[row.prepared, row.aired, row.deferred, row.killed, row.prepared - row.aired - row.deferred - row.killed, `${Math.round(100 * row.aired / row.prepared)}%`]
                  .map((value, index) => <td key={index} className="px-2 py-2"><bdi>{value}</bdi></td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
