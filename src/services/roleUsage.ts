import type { User } from '../types';
import type { RoleDefinition } from '../shared/rbac';
import { countLabel } from '../shared/labels';

type Holder = Pick<User, 'role' | 'customRoleId' | 'deletedAt'>;

/** Accounts (not deleted) that hold a role, either as their custom role or through its role code. */
export function roleHolders<T extends Holder>(role: Pick<RoleDefinition, 'id' | 'roleCode'>, users: T[]): T[] {
  return users.filter((u) => !u.deletedAt && (u.customRoleId === role.id || u.role === role.roleCode));
}

/** Why a role cannot be deleted while colleagues hold it, or null when nobody does. */
export function roleInUseError(role: Pick<RoleDefinition, 'id' | 'roleCode' | 'nameAr'>, users: Holder[]): string | null {
  const n = roleHolders(role, users).length;
  if (!n) return null;
  const who = countLabel(n, { zero: '', one: 'مستخدم واحد', two: 'مستخدمان', few: 'مستخدمين', many: 'مستخدماً' });
  return `لا يمكن حذف الدور «${role.nameAr}»: يحمله ${who}. انقل ${n === 1 ? 'صاحبه' : 'أصحابه'} إلى دور آخر أولاً.`;
}
