import { TriangleAlert } from 'lucide-react';
import type { User } from '../../types';
import { useLiveData } from '../../hooks/useLiveData';
import { apiService } from '../../services/api';
import { addDaysIso, arabicDate, stationTimeZone } from '../../shared/dates';
import { departmentName, departmentsOf } from '../../shared/departments';
import { shiftName, type RosterEntry } from '../../shared/roster';
import { shiftCoverageGaps, shiftGapSupervisors } from '../../shared/shiftGaps';
import { stationGroupsOf, stationName, stationsOf } from '../../shared/stations';
import { stationWall } from '../../shared/stationTime';

export function ShiftGapPanel({ currentUser, users, roster, canManage }: { currentUser: User; users: User[]; roster: RosterEntry[]; canManage: boolean }) {
  useLiveData(['settings', 'episodes', 'bulletins', 'bulletinFormats', 'tasks', 'productionCards'], 60_000);
  const settings = apiService.getSettings();
  const stations = stationsOf(settings);
  const groups = stationGroupsOf(settings);
  const date = addDaysIso(stationWall(Date.now(), stationTimeZone(settings.defaultTimezone)).date, 1);
  const isCentral = ['ADMIN', 'SUPER_ADMIN', 'MAIN_STATION_MANAGER'].includes(currentUser.role);
  const isSupervisor = isCentral || ['STATION_MANAGER', 'GENERAL_MANAGER'].includes(currentUser.role);
  if (!canManage && !isSupervisor) return null;

  const gaps = shiftCoverageGaps({ date, stations, departments: departmentsOf(settings), roster, users,
    episodes: apiService.getEpisodes(), bulletins: apiService.getBulletins(), bulletinFormats: apiService.getBulletinFormats(), tasks: apiService.getTasks(), cards: apiService.getCards(),
  }).filter(gap => isCentral || (canManage && currentUser.stationId === gap.stationId) ||
    shiftGapSupervisors(gap.stationId, users, stations, groups).some(user => user.id === currentUser.id));

  return <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="roster-shift-gaps">
    <h2 id="roster-shift-gaps" className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
      <TriangleAlert aria-hidden="true" className="size-4 text-amber-700" /> نواقص مناوبات بث الغد
      <span className="text-xs font-normal text-slate-600">{arabicDate(date)}</span>
    </h2>
    {gaps.length ? <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {gaps.map(gap => <li key={gap.id} className="min-w-0 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-slate-700">
        <div className="flex flex-wrap items-baseline justify-between gap-1">
          <strong className="text-amber-900">{departmentName(gap.departmentId)} · {shiftName(gap.shift)}</strong>
          <span>{stationName(stations, gap.stationId)} · {arabicDate(gap.date)}</span>
        </div>
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {gap.shows.map(show => <li key={`${show.kind}:${show.id}`}><a className="font-semibold text-blue-800 hover:underline"
            href={show.kind === 'scheduled-bulletin' ? '/bulletins' : `/${show.kind === 'bulletin' ? 'bulletins' : 'episodes'}/${encodeURIComponent(show.id)}`}>{show.title}</a></li>)}
        </ul>
        {gap.suggestions.length ? <p><b>بدلاء مقترحون</b> · {gap.suggestions.map(user => user.name).join('، ')}</p>
          : <p>لا بديل متاح في هذه المناوبة.</p>}
      </li>)}
    </ul> : <p className="text-xs text-slate-600">لا نواقص مرصودة في المناوبات المطلوبة للبث المجدول.</p>}
  </section>;
}
