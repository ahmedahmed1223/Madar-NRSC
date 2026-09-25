import { User } from '../types';
import {
  DEFAULT_ROLE_DEFINITIONS,
  RoleDefinition,
  computeEffectivePermissions,
  evaluatePermission,
} from '../shared/rbac';
import { COLLECTIONS } from '../shared/collections';
import { dataStore } from './dataStore';

export * from '../shared/rbac';

const ROLES_KEY = COLLECTIONS.roles.storageKey;

/** Role definitions live in the server database and are enforced there as well. */
export class RbacService {
  static getRoleDefinitions(): RoleDefinition[] {
    const roles = dataStore.get<RoleDefinition[]>(ROLES_KEY, []);
    return roles.length > 0 ? roles : DEFAULT_ROLE_DEFINITIONS;
  }

  static saveRoleDefinitions(roles: RoleDefinition[]): void {
    dataStore.set(ROLES_KEY, roles);
  }

  static saveRole(role: RoleDefinition): RoleDefinition[] {
    const roles = this.getRoleDefinitions();
    const existingIndex = roles.findIndex((r) => r.id === role.id);
    if (existingIndex !== -1) {
      const current = roles[existingIndex];
      // A role's identity and system flag never change through an edit.
      roles[existingIndex] = { ...current, ...role, id: current.id, isSystemRole: current.isSystemRole, roleCode: current.isSystemRole ? current.roleCode : role.roleCode };
    } else {
      if (roles.some((r) => r.roleCode === role.roleCode)) throw new Error('يوجد دور بنفس الرمز مسبقاً');
      roles.push({ ...role, isSystemRole: false });
    }

    this.saveRoleDefinitions(roles);
    return roles;
  }

  static deleteRole(roleId: string): { success: boolean; error?: string; roles: RoleDefinition[] } {
    const roles = this.getRoleDefinitions();
    const target = roles.find((r) => r.id === roleId);

    if (!target) {
      return { success: false, error: 'الدور غير موجود', roles };
    }

    if (target.isSystemRole) {
      return { success: false, error: 'لا يمكن حذف الأدوار الأساسية للنظام', roles };
    }

    const filtered = roles.filter((r) => r.id !== roleId);
    this.saveRoleDefinitions(filtered);
    return { success: true, roles: filtered };
  }

  static resetToDefaults(): RoleDefinition[] {
    const custom = this.getRoleDefinitions().filter((r) => !r.isSystemRole);
    const next = [...DEFAULT_ROLE_DEFINITIONS, ...custom];
    this.saveRoleDefinitions(next);
    return next;
  }

  /**
   * Evaluates if a given user has permission to perform an action.
   * Handles role inheritance, custom user overrides, and Super Admin bypass.
   */
  static hasPermission(user: User | undefined | null, permissionCode: string): boolean {
    return evaluatePermission(user, permissionCode, this.getRoleDefinitions());
  }

  /**
   * Retrieves full list of effective permission codes for a user
   */
  static getEffectivePermissions(user: User | undefined | null): string[] {
    return computeEffectivePermissions(user, this.getRoleDefinitions());
  }

  static getRoleBadge(roleCode: string): { labelAr: string; color: string; badgeBg: string; badgeText: string } {
    const roles = this.getRoleDefinitions();
    const found = roles.find((r) => r.roleCode === roleCode || r.id === roleCode);
    if (found) {
      return {
        labelAr: found.nameAr,
        color: found.color,
        badgeBg: found.badgeBg,
        badgeText: found.badgeText,
      };
    }
    return {
      labelAr: roleCode,
      color: '#64748b',
      badgeBg: 'bg-slate-100 text-slate-700 border-slate-200',
      badgeText: roleCode,
    };
  }
}
