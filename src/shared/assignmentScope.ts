import { departmentWorkScope, departmentsOf, type Department } from './departments';
import { stationGroupsOf, stationScope, stationsOf, type Station, type StationGroup } from './stations';
import type { User } from '../types';

type AssignmentUser = Pick<User, 'id' | 'role' | 'isActive' | 'deletedAt' | 'departmentId' | 'department' | 'stationId' | 'managedStationIds' | 'managedGroupIds'>;
type AssignmentSettings = { stations?: Station[]; stationGroups?: StationGroup[]; departments?: Department[] };

const ROLE_LEVEL: Partial<Record<User['role'], number>> = {
  SUPER_ADMIN: 6,
  ADMIN: 5,
  MAIN_STATION_MANAGER: 4,
  GENERAL_MANAGER: 4,
  STATION_MANAGER: 3,
  EDITOR: 2,
  PRODUCER: 1,
};

export function assignmentScope(actor: AssignmentUser, settings?: AssignmentSettings) {
  const departments = departmentsOf(settings);
  const heads = new Set(departments.filter(department => !department.archived).map(department => department.headUserId));
  const level = (user: AssignmentUser) => Math.max(ROLE_LEVEL[user.role] ?? 0, heads.has(user.id) ? 2 : 0);
  const actorLevel = level(actor);
  const stations = stationScope(stationsOf(settings), actor, stationGroupsOf(settings));
  return {
    stations,
    errorFor(recipient: AssignmentUser | undefined): string | null {
      if (!recipient || recipient.isActive === false || recipient.deletedAt) return 'المكلف غير موجود أو موقوف';
      if (recipient.id === actor.id) return null;
      const recipientLevel = level(recipient);
      if (recipientLevel > actorLevel ||
        (recipientLevel === actorLevel && heads.has(recipient.id) && departmentWorkScope(recipient.id, departments).departmentFor(actor))) {
        return 'لا يمكنك إسناد مهمة إلى زميل في مستوى إداري أعلى';
      }
      if (recipient.stationId && !stations.has(recipient.stationId)) return 'المكلف خارج نطاق المحطات التي تديرها أو ترتبط بها';
      return null;
    },
  };
}
