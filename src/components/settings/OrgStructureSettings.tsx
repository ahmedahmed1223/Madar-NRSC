import type React from 'react';
import { Building2, ExternalLink, Network, Users } from 'lucide-react';
import { apiService } from '../../services/api';
import { navigateTo } from '../../services/uiEvents';
import { departmentIdOf, departmentsAtStation, departmentsOf, type Department } from '../../shared/departments';
import { stationGroupsOf, stationScope, stationsOf, type Station } from '../../shared/stations';
import type { User } from '../../types';

const LINK = 'min-h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50';

/**
 * «الهيكل التنظيمي»: a read-only picture of the organisation — station groups, stations (main,
 * branches, links, general managers), the departments at each station with their sub-units, heads
 * and member counts — with links to where each part is edited.
 */
export function OrgStructureSettings({ onOpenSection }: { onOpenSection: (section: 'stations' | 'departments') => void }) {
  const settings = apiService.getSettings();
  const stations = stationsOf(settings);
  const groups = stationGroupsOf(settings);
  const departments = departmentsOf(settings).filter((d) => !d.archived);
  const users = apiService.getUsers().filter((u) => !u.deletedAt && u.isActive !== false);
  const nameOf = (id?: string) => users.find((u) => u.id === id)?.fullName;
  const generalManagers = users.filter((u) => u.managedStationIds?.length || u.managedGroupIds?.length);
  const followers = (station: Station) => generalManagers.filter((u) => stationScope(stations, u, groups).has(station.id));
  const central = users.filter((u) => !u.stationId || !stations.some((s) => s.id === u.stationId));

  const deptTree = (list: Department[], members: User[], parentId?: string, depth = 0): React.ReactElement | null => {
    const ids = new Set(list.map((d) => d.id));
    // Top level: departments without a parent, or whose parent is not at this station.
    const level = list.filter((d) => (parentId === undefined ? !d.parentId || !ids.has(d.parentId) : d.parentId === parentId));
    if (!level.length) return null;
    return (
      <ul className={depth ? 'pr-4 border-r border-slate-200 mt-1 space-y-1' : 'space-y-1'}>
        {level.map((d) => {
          const count = members.filter((u) => departmentIdOf(u) === d.id).length;
          return (
            <li key={d.id}>
              <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-bold text-slate-800">{d.name}</span>
                <span className="text-xs text-slate-500 tabular-nums">{count} من الزملاء</span>
                {d.headUserId && <span className="text-xs text-slate-600">· الرئيس: {nameOf(d.headUserId) || 'حساب غير نشط'}</span>}
              </div>
              {deptTree(list, members, d.id, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <section className="py-4 space-y-6" aria-labelledby="org-structure-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="org-structure-title" className="text-lg font-bold text-slate-900">الهيكل التنظيمي</h2>
          <p className="text-sm text-slate-600 max-w-3xl">
            {stations.length} محطة{groups.length ? ` في ${groups.length} مجموعة` : ''}، {departments.length} قسماً إدارياً، {users.length} من الزملاء النشطين. للعرض فقط؛ يُعدَّل كل جزء من مكانه.
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
          <ul className="grid gap-2 sm:grid-cols-2">
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

      <ol className="space-y-4">
        {[...stations].sort((a, b) => Number(!!b.isMain) - Number(!!a.isMain)).map((station) => {
          const members = users.filter((u) => u.stationId === station.id);
          const atStation = departmentsAtStation(station.id, departments);
          const links = [...stationScope(stations, station.id, [])].filter((id) => id !== station.id).map((id) => stations.find((s) => s.id === id)?.name);
          const managers = followers(station);
          const inGroups = groups.filter((g) => g.stationIds.includes(station.id)).map((g) => g.name);
          return (
            <li key={station.id} className="border border-slate-200 rounded-2xl bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-base font-bold text-slate-900">{station.name}</h3>
                <span className={`text-2xs font-bold px-2 py-0.5 rounded-full ${station.isMain ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-700'}`}>{station.isMain ? 'المحطة الرئيسية' : 'فرع'}</span>
                <span className="text-xs text-slate-500 tabular-nums">{members.length} من الزملاء</span>
                {inGroups.length > 0 && <span className="text-xs text-slate-600">ضمن: {inGroups.join('، ')}</span>}
              </div>
              <p className="text-xs text-slate-600">
                {station.isMain ? 'تتابع كل المحطات.' : `تتابع وتكلّف: ${links.length ? links.join('، ') : 'نفسها فقط'}.`}
                {managers.length > 0 && ` · مدراء عامّون يتابعونها: ${managers.map((u) => u.fullName).join('، ')}`}
              </p>
              {atStation.length ? deptTree(atStation, members) : <p className="text-sm text-slate-500">لا أقسام في هذه المحطة.</p>}
            </li>
          );
        })}
      </ol>

      <div className="border border-dashed border-slate-300 rounded-2xl p-4 space-y-1">
        <h3 className="text-sm font-bold text-slate-800">الإدارة المركزية (بلا محطة)</h3>
        <p className="text-xs text-slate-600">{central.length} من الزملاء يتابعون كل المحطات، إلا من حُددت له محطات بعينها.</p>
        {central.length > 0 && <p className="text-xs text-slate-500">{central.slice(0, 12).map((u) => u.fullName).join('، ')}{central.length > 12 ? '…' : ''}</p>}
        <a href="/users" onClick={(e) => { e.preventDefault(); navigateTo.emit('/users'); }} className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 underline">
          تعديل محطات الزملاء <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
