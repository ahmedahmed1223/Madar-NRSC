import { SystemSettings, User } from '../types';
import {
  DEFAULT_ROLE_DEFINITIONS,
  RoleDefinition,
  computeEffectivePermissions,
  evaluatePermission,
  findUserRole,
} from '../shared/rbac';
import { workflowAccess } from '../shared/workflowAccess';
import { WORKFLOW_TRACKS } from '../shared/workflowTracks';
import { canOpenScreen } from '../shared/screens';
import { departmentsLedBy, departmentsOf } from '../shared/departments';
import { assignedWorkOnly } from '../shared/assignedWork';
import { COLLECTIONS } from '../shared/collections';
import { dataStore } from './dataStore';
import { roleInUseError } from './roleUsage';
import { allowsModule, moduleForCollection, moduleSubject, moduleForScreen, type ModuleId } from '../shared/moduleAccess';
import { TRASH_COLLECTIONS, TRASH_SECTIONS, type TrashCollection } from '../shared/trash';

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
    // The code is the role's identity: empty or shared codes are refused on create and on update (the server checks too).
    const code = String(role.roleCode || '').trim();
    const current = existingIndex !== -1 ? roles[existingIndex] : null;
    if (!current || (!current.isSystemRole && current.roleCode !== code)) {
      if (!code) throw new Error('رمز الدور مطلوب');
      if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) throw new Error('رمز الدور: حروف إنجليزية كبيرة وأرقام وشرطة سفلية (_) فقط');
      if (roles.some((r) => r.id !== role.id && r.roleCode === code) || DEFAULT_ROLE_DEFINITIONS.some((r) => r.roleCode === code)) throw new Error('يوجد دور بنفس الرمز مسبقاً');
    }
    if (current) {
      // A role's identity and system flag never change through an edit.
      roles[existingIndex] = { ...current, ...role, id: current.id, isSystemRole: current.isSystemRole, roleCode: current.isSystemRole ? current.roleCode : role.roleCode };
    } else {
      roles.push({ ...role, isSystemRole: false });
    }

    this.saveRoleDefinitions(roles);
    return roles;
  }

  /** Refuses while any (non-deleted) account still holds the role: pass the current user list. */
  static deleteRole(roleId: string, users: Pick<User, 'role' | 'customRoleId' | 'deletedAt'>[] = []): { success: boolean; error?: string; roles: RoleDefinition[] } {
    const roles = this.getRoleDefinitions();
    const target = roles.find((r) => r.id === roleId);

    if (!target) {
      return { success: false, error: 'الدور غير موجود', roles };
    }

    if (target.isSystemRole) {
      return { success: false, error: 'لا يمكن حذف الأدوار الأساسية للنظام', roles };
    }

    const inUse = roleInUseError(target, users);
    if (inUse) return { success: false, error: inUse, roles };

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
    return evaluatePermission(user, permissionCode, this.getRoleDefinitions(), this.getPermissionDepartments());
  }

  static getPermissionDepartments() {
    return departmentsOf(dataStore.get<SystemSettings | null>(COLLECTIONS.settings.storageKey, null));
  }

  static canUseModule(user: User | undefined | null, id: ModuleId): boolean {
    if (!user?.isActive) return false;
    const effective = dataStore.moduleAvailability(user.id, id);
    if (effective !== undefined) return effective;
    const settings = dataStore.get<SystemSettings | null>(COLLECTIONS.settings.storageKey, null);
    return allowsModule(settings?.moduleAccess, id, moduleSubject(user, findUserRole(user, this.getRoleDefinitions())?.id, departmentsOf(settings)));
  }

  static acceptsNewAssignments(user: User | undefined | null): boolean {
    return !!user && this.canUseModule(user, 'assignments') && dataStore.moduleAvailability(user.id, 'assignmentIntake') !== false;
  }

  static isScreenModuleAvailable(user: User | undefined | null, nav: string): boolean {
    if (['on-air', 'studio-screen', 'calendar'].includes(nav)) {
      return this.canUseModule(user, 'programmes') || this.canUseModule(user, 'bulletins');
    }
    const module = moduleForScreen(nav);
    return !module || this.canUseModule(user, module);
  }

  static availableTrashCollections(user: User): TrashCollection[] {
    const can = (permission: string) => this.hasPermission(user, permission);
    const workOnly = assignedWorkOnly(can);
    const role = findUserRole(user, this.getRoleDefinitions());
    return TRASH_COLLECTIONS.filter(collection => {
      const module = moduleForCollection(collection);
      const { screen, permissions } = TRASH_SECTIONS[collection];
      return (!workOnly || collection === 'productionCards') && (!module || this.canUseModule(user, module)) &&
        permissions.some(can) && canOpenScreen(screen, role, can, user.role === 'SUPER_ADMIN');
    });
  }

  /** Whether the user's role opens a screen (the sidebar, the search and the address bar all ask here). */
  static canOpenScreen(user: User | undefined | null, nav: string, includeDepartmentWork = true): boolean {
    if (!user || !this.isScreenModuleAvailable(user, nav)) return false;
    const roles = this.getRoleDefinitions();
    if (nav === 'trash') return this.availableTrashCollections(user).length > 0;
    if ((nav === 'workload' || nav === 'tasks') && includeDepartmentWork && this.leadsDepartment(user)) return true;
    const can = (permission: string) => this.hasPermission(user, permission);
    const workflow = nav === 'cards' && WORKFLOW_TRACKS.some(track => workflowAccess(user, track, { view: can('cards.view'), work: can('cards.work'), manage: can('cards.manage') }).view);
    return canOpenScreen(nav, findUserRole(user, roles), permission => permission === 'cards.view' && nav === 'cards' ? workflow : can(permission), user.role === 'SUPER_ADMIN');
  }

  static leadsDepartment(user: User): boolean {
    const settings = dataStore.get<SystemSettings | null>(COLLECTIONS.settings.storageKey, null);
    return departmentsLedBy(user.id, departmentsOf(settings)).length > 0 && !assignedWorkOnly(permission => this.hasPermission(user, permission));
  }

  /**
   * Retrieves full list of effective permission codes for a user
   */
  static getEffectivePermissions(user: User | undefined | null): string[] {
    return computeEffectivePermissions(user, this.getRoleDefinitions(), this.getPermissionDepartments());
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
