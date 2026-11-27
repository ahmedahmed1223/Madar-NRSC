import type { SystemSettings, User } from '../types';
import { departmentsOf, findDepartmentId } from './departments';
import { allowsModule, MODULE_IDS, moduleAllowsNewWork, moduleSubject } from './moduleAccess';
import { canGovernCard, type CardActor } from './productionCards';
import { stationGroupsOf, stationScope, stationsArchiveOf, stationsOf } from './stations';

export function canEditOwnStation(role: User['role'], can: (permission: string) => boolean): boolean {
  return (role === 'ADMIN' || role === 'SUPER_ADMIN') && can('users.edit_profile') && can('users.manage_roles_permissions');
}

/** An administrator's home station may change without granting access outside their current scope. */
export function ownStationChangeError(user: User, stationId: User['stationId'], settings: SystemSettings | undefined, roleId: string | undefined, can: (permission: string) => boolean): string | null {
  if (stationId != null && typeof stationId !== 'string') return 'المحطة المختارة غير متاحة';
  if ((user.stationId || undefined) === (stationId || undefined)) return null;
  const stations = stationsOf(settings);
  if (stationId && !stations.some(station => station.id === stationId)) return 'المحطة المختارة غير متاحة';

  const nextUser = { ...user, stationId };
  const departments = departmentsOf(settings);
  if (findDepartmentId(user, departments) !== findDepartmentId(nextUser, departments)) {
    return 'اختيار هذه المحطة يغيّر قسم حسابك. اطلب من مسؤول مخوّل نقل الحساب والقسم معاً.';
  }
  const groups = stationGroupsOf(settings);
  const currentStations = stationScope(stations, user, groups);
  if ([...stationScope(stations, nextUser, groups)].some(id => !currentStations.has(id))) {
    return 'اختيار هذه المحطة يوسّع نطاق المحطات لحسابك. اطلب من مسؤول مخوّل تعديلها.';
  }

  const cardActor: CardActor = { ...user, stationId: user.stationId || undefined, canManage: can('cards.manage'), canWork: can('cards.work') };
  if (cardActor.canManage) {
    const nextActor = { ...cardActor, stationId: stationId || undefined };
    const owners = new Set([undefined, ...stations.map(station => station.id), ...stationsArchiveOf(settings).map(station => station.id)]);
    for (const ownerStationId of owners) {
      const card = { ownerId: '', ownerStationId };
      if (canGovernCard(card, nextActor, stations) && !canGovernCard(card, cardActor, stations)) {
        return 'اختيار هذه المحطة يوسّع نطاق إدارة التكليفات. اطلب من مسؤول مخوّل تعديلها.';
      }
    }
  } else if (cardActor.canWork && stationId) {
    return 'تغيير المحطة يغيّر نطاق استلام خطوات التكليفات الموجّهة لمحطتك. اطلب من مسؤول مخوّل تعديلها.';
  }

  const policy = settings?.moduleAccess;
  if (!policy) return null;
  const current = moduleSubject(user, roleId, departments);
  const next = moduleSubject(nextUser, roleId, departments);
  const recordStations = new Set<string | undefined>([undefined]);
  for (const rule of Object.values(policy)) {
    for (const scope of rule?.scopes ?? []) recordStations.add(scope.stationId);
  }
  for (const moduleId of MODULE_IDS) {
    for (const recordStation of recordStations) {
      const newAccess = allowsModule(policy, moduleId, next, undefined, recordStation) && !allowsModule(policy, moduleId, current, undefined, recordStation);
      const newWork = moduleAllowsNewWork(policy, moduleId, next, recordStation) && !moduleAllowsNewWork(policy, moduleId, current, recordStation);
      if (newAccess || newWork) return 'اختيار هذه المحطة يوسّع إتاحة الوحدات لحسابك. اطلب من مسؤول مخوّل تعديلها.';
    }
  }
  return null;
}
