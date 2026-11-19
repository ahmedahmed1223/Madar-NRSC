import { Building2, ExternalLink, Network, Users } from 'lucide-react';
import { apiService } from '../../services/api';
import { navigateTo } from '../../services/uiEvents';
import { countLabel } from '../../shared/arabicPlural';
import { departmentIdOf, departmentsAtStation, departmentsOf, type Department } from '../../shared/departments';
import { stationGroupsOf, stationScope, stationsOf, type Station } from '../../shared/stations';

const LINK = 'min-h-11 sm:min-h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50';
const STATIONS = { one: 'محطة واحدة', two: 'محطتان', few: 'محطات', many: 'محطة' };
const GROUPS = { one: 'مجموعة واحدة', two: 'مجموعتان', few: 'مجموعات', many: 'مجموعة' };
const DEPARTMENTS = { one: 'قسم إداري واحد', two: 'قسمان إداريان', few: 'أقسام إدارية', many: 'قسماً إدارياً' };
const COLLEAGUES = { one: 'زميل واحد', two: 'زميلان', few: 'زملاء', many: 'زميلاً', zero: 'لا زملاء' };

/** Departments in tree order (parents before their sub-units), each with its depth. */
function departmentRows(list: Department[]): { dept: Department; depth: number }[] {
  const ids = new Set(list.map((d) => d.id));
  const rows: { dept: Department; depth: number }[] = [];
  const walk = (parentId: string | undefined, depth: number) => {
    for (const d of list) {
      const parent = d.parentId && ids.has(d.parentId) ? d.parentId : undefined;
      if (parent !== parentId || rows.some((r) => r.dept.id === d.id)) continue;
      rows.push({ dept: d, depth });
      walk(d.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return rows;
}

/**
 * «الهيكل التنظيمي»: a read-only picture of the organisation — station groups, stations (main,
 * branches, links, general managers), and one table of the departments against the stations with
 * the number of colleagues in each and the department head — with links to where each part is edited.
 */
export function OrgStructureSettings({ onOpenSection }: { onOpenSection: (section: 'stations' | 'departments') => void }) {
  const settings = apiService.getSettings();
  const stations = [...stationsOf(settings)].sort((a, b) => Number(!!b.isMain) - Number(!!a.isMain));
  const groups = stationGroupsOf(settings);
  const departments = departmentsOf(settings).filter((d) => !d.archived);
  const users = apiService.getUsers().filter((u) => !u.deletedAt && u.isActive !== false);
  const nameOf = (id?: string) => users.find((u) => u.id === id)?.fullName;
  const generalManagers = users.filter((u) => u.managedStationIds?.length || u.managedGroupIds?.length);
  const followers = (station: Station) => generalManagers.filter((u) => stationScope(stations, u, groups).has(station.id));
  const central = users.filter((u) => !u.stationId || !stations.some((s) => s.id === u.stationId));
  const rows = departmentRows(departments);
  const offered = new Map(stations.map((s) => [s.id, new Set(departmentsAtStation(s.id, departments).map((d) => d.id))]));
  const count = (deptId: string, stationId: string | null) =>
    (stationId ? users.filter((u) => u.stationId === stationId) : central).filter((u) => departmentIdOf(u) === deptId).length;

  return (
    <section className="py-4 space-y-6" aria-labelledby="org-structure-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="org-structure-title" className="text-lg font-bold text-slate-900">الهيكل التنظيمي</h2>
          <p className="text-sm text-slate-600 max-w-3xl">
            {countLabel(stations.length, STATIONS)}{groups.length ? ` في ${countLabel(groups.length, GROUPS)}` : ''}، {countLabel(departments.length, DEPARTMENTS)}، والزملاء النشطون: {countLabel(users.length, COLLEAGUES)}. للعرض فقط؛ يُعدَّل كل جزء من مكانه.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={LINK} onClick={() => onOpenSection('stations')}><Network className="w-3.5 h-3.5" aria-hidden="true" />تعديل المحطات والمجموعات</button>
          <button type="button" className={LINK} onClick={() => onOpenSection('departments')}><Building2 className="w-3.5 h-3.5" aria-hidden="true" />تعديل الأقسام الإدارية</button>
          <button type="button" className={LINK} onClick={() => navigateTo.emit('/users')}><Users className="w-3.5 h-3.5" aria-hidden="true" />المستخدمون والصلاحيات</button>
        </div>
      </div>

      {groups.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-slate-800">مجموعات المحطات</h3>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {groups.map((g) => {
              const managers = generalManagers.filter((u) => u.managedGroupIds?.includes(g.id));
              return (
                <li key={g.id} className="border border-slate-200 rounded-xl bg-white p-3 text-sm">
                  <div className="font-bold text-slate-900">{g.name}</div>
                  <div className="text-slate-700">{g.stationIds.map((id) => stations.find((s) => s.id === id)?.name).filter(Boolean).join('، ') || 'بلا محطات'}</div>
                  {managers.length > 0 && <div className="text-xs text-slate-600 mt-1">يتابعها: {managers.map((u) => u.fullName).join('، ')}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-bold text-slate-800">المحطات</h3>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {stations.map((station) => {
            const members = users.filter((u) => u.stationId === station.id).length;
            const links = [...stationScope(stations, station.id, [])].filter((id) => id !== station.id).map((id) => stations.find((s) => s.id === id)?.name);
            const managers = followers(station);
            const inGroups = groups.filter((g) => g.stationIds.includes(station.id)).map((g) => g.name);
            return (
              <li key={station.id} className="border border-slate-200 rounded-xl bg-white p-3 space-y-1 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-base font-bold text-slate-900">{station.name}</span>
                  <span className={`text-2xs font-bold px-2 py-0.5 rounded ${station.isMain ? 'bg-blue-50 text-blue-800 border border-blue-200' : 'bg-slate-100 text-slate-700'}`}>{station.isMain ? 'المحطة الرئيسية' : 'فرع'}</span>
                  <span className="ms-auto text-xs text-slate-600 tabular-nums">{countLabel(members, COLLEAGUES)}</span>
                </div>
                <p className="text-xs text-slate-600">{station.isMain ? 'تتابع كل المحطات.' : `تتابع وتكلّف: ${links.length ? links.join('، ') : 'نفسها فقط'}.`}</p>
                {inGroups.length > 0 && <p className="text-xs text-slate-600">ضمن: {inGroups.join('، ')}</p>}
                {managers.length > 0 && <p className="text-xs text-slate-600">يتابعها من المدراء العامين: {managers.map((u) => u.fullName).join('، ')}</p>}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-2">
        <h3 id="org-departments-title" className="text-sm font-bold text-slate-800">الأقسام في كل محطة</h3>
        <p className="text-xs text-slate-600">عدد الزملاء النشطين في كل قسم. الشرطة تعني أن القسم غير موجود في تلك المحطة.</p>
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto" role="region" aria-labelledby="org-departments-title" tabIndex={0}>
          <table className="w-full text-sm text-right">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <th scope="col" className="py-2.5 px-3 min-w-36">القسم</th>
                {stations.map((s) => <th key={s.id} scope="col" className="py-2.5 px-3 text-center whitespace-nowrap">{s.name}</th>)}
                <th scope="col" className="py-2.5 px-3 text-center whitespace-nowrap">بلا محطة</th>
                <th scope="col" className="py-2.5 px-3 text-center">المجموع</th>
                <th scope="col" className="py-2.5 px-3 min-w-36">رئيس القسم</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(({ dept, depth }) => {
                const perStation = stations.map((s) => (offered.get(s.id)?.has(dept.id) ? count(dept.id, s.id) : null));
                const centralCount = count(dept.id, null);
                const total = perStation.reduce<number>((sum, n) => sum + (n || 0), 0) + centralCount;
                return (
                  <tr key={dept.id} className="hover:bg-slate-50/60">
                    <th scope="row" className="py-2 px-3 font-bold text-slate-800 text-right">
                      <span style={{ paddingInlineStart: `${depth * 1.25}rem` }} className={`inline-block ${depth ? 'font-semibold text-slate-700' : ''}`}>
                        {depth > 0 && <span className="text-slate-500 me-1" aria-hidden="true">└</span>}
                        {dept.name}
                      </span>
                    </th>
                    {perStation.map((n, i) => (
                      <td key={stations[i].id} className="py-2 px-3 text-center tabular-nums">
                        {n === null ? <span className="text-slate-500" title="القسم غير موجود في هذه المحطة">—<span className="sr-only">غير موجود</span></span> : <span className={n ? 'font-bold text-slate-900' : 'text-slate-500'}>{n}</span>}
                      </td>
                    ))}
                    <td className="py-2 px-3 text-center tabular-nums"><span className={centralCount ? 'font-bold text-slate-900' : 'text-slate-500'}>{centralCount}</span></td>
                    <td className="py-2 px-3 text-center tabular-nums font-bold text-slate-900">{total}</td>
                    <td className="py-2 px-3 text-slate-700">{dept.headUserId ? nameOf(dept.headUserId) || 'حساب غير نشط' : <span className="text-slate-500">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="border border-dashed border-slate-300 rounded-xl p-4 space-y-1">
        <h3 className="text-sm font-bold text-slate-800">الإدارة المركزية (بلا محطة)</h3>
        <p className="text-xs text-slate-600">{countLabel(central.length, COLLEAGUES)}. يتابع الزميل بلا محطة كل المحطات، إلا من حُددت له محطات بعينها.</p>
        {central.length > 0 && <p className="text-xs text-slate-500">{central.slice(0, 12).map((u) => u.fullName).join('، ')}{central.length > 12 ? '…' : ''}</p>}
        <a href="/users" onClick={(e) => { e.preventDefault(); navigateTo.emit('/users'); }} className="inline-flex items-center gap-1 min-h-9 text-xs font-bold text-blue-700 underline">
          تعديل محطات الزملاء <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
