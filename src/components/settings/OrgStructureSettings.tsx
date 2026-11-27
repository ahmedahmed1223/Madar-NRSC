import { useState } from 'react';
import { Building2, ExternalLink, GitBranch, Map as MapIcon, Network, Table2, Users } from 'lucide-react';
import { apiService } from '../../services/api';
import { navigateTo } from '../../services/uiEvents';
import { countLabel } from '../../shared/arabicPlural';
import { departmentIdOf, departmentsAtStation, departmentsOf, type Department } from '../../shared/departments';
import { buildStationNetwork } from '../../shared/stationNetwork';
import { stationGroupsOf, stationsOf } from '../../shared/stations';
import { DepartmentChart } from './DepartmentChart';
import { StationNetworkChart } from './StationNetworkChart';

const LINK = 'min-h-11 sm:min-h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50';
const STATIONS = { one: 'محطة واحدة', two: 'محطتان', few: 'محطات', many: 'محطة' };
const GROUPS = { one: 'مجموعة واحدة', two: 'مجموعتان', few: 'مجموعات', many: 'مجموعة' };
const DEPARTMENTS = { one: 'قسم إداري واحد', two: 'قسمان إداريان', few: 'أقسام إدارية', many: 'قسماً إدارياً' };
const COLLEAGUES = { one: 'زميل واحد', two: 'زميلان', few: 'زملاء', many: 'زميلاً', zero: 'لا زملاء' };

type View = 'network' | 'departments' | 'matrix';

function departmentRows(list: Department[]): { dept: Department; depth: number }[] {
  const ids = new Set(list.map(d => d.id));
  const rows: { dept: Department; depth: number }[] = [];
  const walk = (parentId: string | undefined, depth: number) => {
    for (const department of list) {
      const parent = department.parentId && ids.has(department.parentId) ? department.parentId : undefined;
      if (parent !== parentId || rows.some(row => row.dept.id === department.id)) continue;
      rows.push({ dept: department, depth });
      walk(department.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return rows;
}

export function OrgStructureSettings({ onOpenSection }: { onOpenSection: (section: 'stations' | 'departments') => void }) {
  const [view, setView] = useState<View>('network');
  const settings = apiService.getSettings();
  const stations = [...stationsOf(settings)].sort((a, b) => Number(!!b.isMain) - Number(!!a.isMain));
  const groups = stationGroupsOf(settings);
  const allDepartments = departmentsOf(settings);
  const departments = allDepartments.filter(department => !department.archived);
  const users = apiService.getUsers().filter(user => !user.deletedAt && user.isActive !== false);
  const nameOf = (id?: string) => users.find(user => user.id === id)?.fullName;
  const central = users.filter(user => !user.stationId || !stations.some(station => station.id === user.stationId));
  const rows = departmentRows(departments);
  const offered = new Map(stations.map(station => [station.id, new Set(departmentsAtStation(station.id, departments).map(department => department.id))]));
  const count = (departmentId: string, stationId: string | null) =>
    (stationId ? users.filter(user => user.stationId === stationId) : central).filter(user => departmentIdOf(user) === departmentId).length;
  const network = buildStationNetwork({ stations, stationGroups: groups, users });
  const views: { id: View; label: string; icon: typeof MapIcon }[] = [
    { id: 'network', label: 'خريطة المحطات', icon: MapIcon },
    { id: 'departments', label: 'مخطط الأقسام', icon: GitBranch },
    { id: 'matrix', label: 'مصفوفة الأقسام والمحطات', icon: Table2 },
  ];

  return (
    <section className="space-y-5 py-4" aria-labelledby="org-structure-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="org-structure-title" className="text-lg font-bold text-slate-900">الهيكل التنظيمي</h2>
          <p className="max-w-3xl text-sm text-slate-600">
            {countLabel(stations.length, STATIONS)}{groups.length ? ` في ${countLabel(groups.length, GROUPS)}` : ''}، {countLabel(departments.length, DEPARTMENTS)}، والزملاء النشطون: {countLabel(users.length, COLLEAGUES)}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={LINK} onClick={() => onOpenSection('stations')}><Network className="size-3.5" aria-hidden="true" />تعديل المحطات والمجموعات</button>
          <button type="button" className={LINK} onClick={() => onOpenSection('departments')}><Building2 className="size-3.5" aria-hidden="true" />تحرير مخطط الأقسام</button>
          <button type="button" className={LINK} onClick={() => navigateTo.emit('/users')}><Users className="size-3.5" aria-hidden="true" />المستخدمون والصلاحيات</button>
        </div>
      </div>

      <div role="group" aria-label="طرق عرض الهيكل التنظيمي" className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {views.map(item => {
          const Icon = item.icon;
          return <button key={item.id} type="button" aria-pressed={view === item.id} onClick={() => setView(item.id)} className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-xs font-bold sm:flex-none ${view === item.id ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}><Icon size={16} aria-hidden="true" />{item.label}</button>;
        })}
      </div>

      {view === 'network' && <>
        {groups.length > 0 && <ul aria-label="مجموعات المحطات" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map(group => <li key={group.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
            <div className="font-bold text-slate-900">{group.name}</div>
            <div className="mt-1 text-xs text-slate-700">{group.stationIds.map(id => stations.find(station => station.id === id)?.name).filter(Boolean).join('، ') || 'بلا محطات'}</div>
          </li>)}
        </ul>}
        <StationNetworkChart network={network} stations={stations} onEditStations={() => onOpenSection('stations')} />
        <div className="rounded-xl border border-dashed border-slate-300 p-4">
          <h3 className="text-sm font-bold text-slate-800">الإدارة المركزية (بلا محطة)</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">{countLabel(central.length, COLLEAGUES)}. يتابع الزميل بلا محطة كل المحطات، إلا من حُددت له محطات بعينها.</p>
        </div>
      </>}

      {view === 'departments' && <DepartmentChart departments={allDepartments} stations={stations} users={users} />}

      {view === 'matrix' && <>
        <div className="space-y-2">
          <h3 id="org-departments-title" className="text-sm font-bold text-slate-800">الأقسام في كل محطة</h3>
          <p className="text-xs text-slate-600">عدد الزملاء النشطين في كل قسم. الشرطة تعني أن القسم غير موجود في تلك المحطة.</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white" role="region" aria-labelledby="org-departments-title" tabIndex={0}>
            <table className="w-full text-right text-sm">
              <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-600">
                <th scope="col" className="min-w-36 px-3 py-2.5">القسم</th>
                {stations.map(station => <th key={station.id} scope="col" className="whitespace-nowrap px-3 py-2.5 text-center">{station.name}</th>)}
                <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-center">بلا محطة</th>
                <th scope="col" className="px-3 py-2.5 text-center">المجموع</th>
                <th scope="col" className="min-w-36 px-3 py-2.5">رئيس القسم</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ dept, depth }) => {
                  const perStation = stations.map(station => offered.get(station.id)?.has(dept.id) ? count(dept.id, station.id) : null);
                  const centralCount = count(dept.id, null);
                  const total = perStation.reduce<number>((sum, value) => sum + (value || 0), 0) + centralCount;
                  return <tr key={dept.id} className="hover:bg-slate-50/60">
                    <th scope="row" className="px-3 py-2 text-right font-bold text-slate-800"><span style={{ paddingInlineStart: `${depth * 1.25}rem` }} className={`inline-block ${depth ? 'font-semibold text-slate-700' : ''}`}>{depth > 0 && <span className="me-1 text-slate-500" aria-hidden="true">└</span>}{dept.name}</span></th>
                    {perStation.map((value, index) => <td key={stations[index].id} className="px-3 py-2 text-center tabular-nums">{value === null ? <span className="text-slate-500" title="القسم غير موجود في هذه المحطة">—<span className="sr-only">غير موجود</span></span> : <span className={value ? 'font-bold text-slate-900' : 'text-slate-500'}>{value}</span>}</td>)}
                    <td className="px-3 py-2 text-center tabular-nums"><span className={centralCount ? 'font-bold text-slate-900' : 'text-slate-500'}>{centralCount}</span></td>
                    <td className="px-3 py-2 text-center font-bold tabular-nums text-slate-900">{total}</td>
                    <td className="px-3 py-2 text-slate-700">{dept.headUserId ? nameOf(dept.headUserId) || 'حساب غير نشط' : <span className="text-slate-500">—</span>}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-xl border border-dashed border-slate-300 p-4">
          <h3 className="text-sm font-bold text-slate-800">الإدارة المركزية (بلا محطة)</h3>
          <p className="mt-1 text-xs text-slate-600">{countLabel(central.length, COLLEAGUES)}. يتابع الزميل بلا محطة كل المحطات، إلا من حُددت له محطات بعينها.</p>
          {central.length > 0 && <p className="mt-1 text-xs text-slate-500">{central.slice(0, 12).map(user => user.fullName).join('، ')}{central.length > 12 ? '…' : ''}</p>}
          <a href="/users" onClick={event => { event.preventDefault(); navigateTo.emit('/users'); }} className="mt-2 inline-flex min-h-11 items-center gap-1 text-xs font-bold text-blue-700 underline"><ExternalLink className="size-3" aria-hidden="true" />تعديل محطات الزملاء</a>
        </div>
      </>}
    </section>
  );
}
