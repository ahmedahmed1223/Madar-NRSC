import { ALL_PERMISSIONS, DEFAULT_ROLE_DEFINITIONS, departmentGrantAllowed, evaluatePermission, findUserRole, isRestrictionPermission, permissionDepartments, type PermissionSubject, type RoleDefinition } from '../shared/rbac';
import { assignedWorkOnly } from '../shared/assignedWork';
import { departmentsOf, type Department } from '../shared/departments';
import type { PolicyInput } from './policy';
import type { User } from '../types';

export function permissionListError(value: unknown, department = false, role = false, stored: readonly string[] = []): string | null {
  if (!Array.isArray(value) || value.length > ALL_PERMISSIONS.length || value.some(p => typeof p !== 'string')) return 'قائمة الصلاحيات غير صالحة';
  const seen = new Set<string>();
  for (const entry of value as string[]) {
    const code = entry.startsWith('!') ? entry.slice(1) : entry;
    if (!ALL_PERMISSIONS.some(p => p.code === code) || seen.has(code) || (role && entry.startsWith('!'))) return 'صلاحية غير معروفة أو مكررة أو متعارضة';
    if (department && !entry.startsWith('!') && !departmentGrantAllowed(code)) return 'الصلاحيات الإدارية الحساسة لا تُمنح على مستوى القسم';
    // A scope restriction is not an action: denying it would widen access instead.
    if (!role && entry.startsWith('!') && isRestrictionPermission(code) && !stored.includes(entry)) return 'قيد النطاق لا يُمنع؛ فهو يضيّق نطاق العمل ولا يمنح صلاحية';
    seen.add(code);
  }
  return null;
}

export function departmentPoliciesError(departments: readonly Department[]): string | null {
  for (const department of departments) {
    if (!department || typeof department !== 'object') return 'تعريف القسم غير صالح';
    if (department.permissionOverrides !== undefined) {
      const error = permissionListError(department.permissionOverrides, true);
      if (error) return `${department.name}: ${error}`;
    }
  }
  return null;
}

/** Also protects legacy sync writes, not just the dedicated permissions editor. */
/**
 * Lifting a scope restriction widens what a set of accounts may reach. It is an administrative
 * act reserved to actors who are not themselves subject to that restriction.
 */
export function restrictionRemovalError(input: PolicyInput, before: readonly string[] | undefined, after: readonly string[] | undefined): string | null {
  const { auth, list } = input;
  if (auth.user?.role === 'SUPER_ADMIN') return null;
  const removed = (before || []).filter(code => isRestrictionPermission(code) && !(after || []).includes(code));
  if (!removed.length) return null;
  const actor = list?.('users')?.find(u => u.id === auth.user?.id) as PermissionSubject | undefined;
  const departments = departmentsOf(list?.('settings')?.[0]);
  const roles = (list?.('roles')?.length ? list('roles') : DEFAULT_ROLE_DEFINITIONS) as RoleDefinition[];
  const subject = actor ? { ...actor, isActive: true } : undefined;
  if (!subject || removed.some(code => isRestrictionPermission(code) &&
    assignedWorkOnly(permission => evaluatePermission(subject, permission, roles, departments)))) {
    return 'لا يمكنك إلغاء قيد النطاق وأنت خاضع له؛ يقتصر إلغاؤه على مدير النظام العام أو حساب غير مقيّد';
  }
  return null;
}

function isAssignedWorkRestricted(subject: PermissionSubject | null | undefined, roles: RoleDefinition[], departments: readonly Department[]): boolean {
  if (!subject) return false;
  const activeSubject = { ...subject, isActive: true };
  return assignedWorkOnly(permission => evaluatePermission(activeSubject, permission, roles, departments));
}

function scopeRestrictionChangeError(
  input: PolicyInput,
  before: PermissionSubject | null | undefined,
  after: PermissionSubject | null | undefined,
  beforeDepartments: readonly Department[],
  afterDepartments: readonly Department[],
  roles: RoleDefinition[],
): string | null {
  if (!isAssignedWorkRestricted(before, roles, beforeDepartments) ||
      isAssignedWorkRestricted(after, roles, afterDepartments)) return null;
  return restrictionRemovalError(input, ['work.assigned_only'], []);
}

export function permissionChangeError(input: PolicyInput): string | null {
  const { auth, collection, before, after, list } = input;
  const currentSettings = list?.('settings')?.[0];
  const beforeDepartments = departmentsOf(collection === 'settings' ? before : currentSettings);
  const afterDepartments = departmentsOf(collection === 'settings' ? after : currentSettings);
  const roles = (list?.('roles')?.length ? list('roles') : DEFAULT_ROLE_DEFINITIONS) as RoleDefinition[];
  const users = (list?.('users') || []) as User[];
  if (collection === 'settings') {
    const invalid = departmentPoliciesError(afterDepartments);
    if (invalid) return invalid;
    const policyShape = (ds: Department[]) => ds.map(d => ({ id: d.id, parentId: d.parentId, permissions: [...(d.permissionOverrides || [])].sort() }));
    const changed = JSON.stringify(policyShape(beforeDepartments)) !== JSON.stringify(policyShape(afterDepartments));
    const hasPolicy = [...beforeDepartments, ...afterDepartments].some(d => d.permissionOverrides?.length);
    if (!changed || !hasPolicy) return null;
    if (!auth.can('users.manage_roles_permissions')) return 'تعديل صلاحيات الأقسام أو تسلسلها يتطلب إدارة الأدوار والصلاحيات';
    for (const d of beforeDepartments) {
      const relaxation = restrictionRemovalError(input, d.permissionOverrides, afterDepartments.find(n => n.id === d.id)?.permissionOverrides);
      if (relaxation) return relaxation;
    }
    for (const user of users) {
      const relaxation = scopeRestrictionChangeError(input, user, user, beforeDepartments, afterDepartments, roles);
      if (relaxation) return relaxation;
    }
    if (auth.user?.role === 'SUPER_ADMIN') return null;
    const own = permissionDepartments(auth.user, beforeDepartments).chain;
    for (const d of own) {
      const next = afterDepartments.find(n => n.id === d.id);
      if (JSON.stringify(d.permissionOverrides || []) !== JSON.stringify(next?.permissionOverrides || []) || d.parentId !== next?.parentId || !next) return 'لا يمكنك تعديل سياسة قسمك أو أحد أقسامه العليا';
    }
    // Check every changed clause as well as effective changes: cannot plant
    // a latent grant, or remove a deny hidden by a user's current exception.
    for (const d of afterDepartments) {
      const old = beforeDepartments.find(p => p.id === d.id)?.permissionOverrides || [];
      const next = d.permissionOverrides || [];
      for (const p of ALL_PERMISSIONS) {
        if (((!old.includes(p.code) && next.includes(p.code)) || (old.includes(`!${p.code}`) && !next.includes(`!${p.code}`))) && !auth.can(p.code)) return 'لا يمكنك منح صلاحية لا تملكها أو إزالة منعها';
      }
    }
    for (const u of users) {
      for (const p of ALL_PERMISSIONS) {
        if (!evaluatePermission(u, p.code, roles, beforeDepartments) && evaluatePermission(u, p.code, roles, afterDepartments) &&
          (u.id === auth.user?.id || !auth.can(p.code))) return 'التعديل يرفع صلاحياتك أو يمنح الآخرين صلاحيات لا تملكها';
      }
    }
  }
  if (collection === 'users' && after) {
    const invalid = after.customPermissions !== undefined ? permissionListError(after.customPermissions) : null;
    if (invalid) return invalid;
    if (auth.user?.role === 'SUPER_ADMIN') return null;
    if (!before || before.role !== after.role || before.customRoleId !== after.customRoleId) {
      const assignedRole = findUserRole(after, roles);
      if (assignedRole && !Array.isArray(assignedRole.permissions)) return 'تعريف صلاحيات الدور غير صالح';
      if (assignedRole?.permissions.some(p => !auth.can(p))) return 'لا يمكنك إسناد دور يتضمن صلاحيات لا تملكها، حتى للحسابات غير النشطة';
    }
    const direct = after.customPermissions || [];
    const old = before?.customPermissions || [];
    // A scope restriction cannot be cancelled by an individual denial: that would widen access
    // beyond assigned work even though it looks like a reduction.
    if (direct.some(p => p.startsWith('!') && isRestrictionPermission(p.slice(1)) && !old.includes(p))) return 'لا يمكن منع قيد النطاق؛ فهو يضيّق نطاق العمل ولا يُلغى باستثناء فردي';
    const relaxation = restrictionRemovalError(input, old, direct);
    if (relaxation) return relaxation;
    const scopeRelaxation = scopeRestrictionChangeError(input, before, after, beforeDepartments, afterDepartments, roles);
    if (scopeRelaxation) return scopeRelaxation;
    for (const p of ALL_PERMISSIONS) {
      if ((!old.includes(p.code) && direct.includes(p.code) || old.includes(`!${p.code}`) && !direct.includes(`!${p.code}`)) && !auth.can(p.code)) return 'لا يمكنك منح صلاحية لا تملكها أو إزالة منعها';
      if (evaluatePermission(after, p.code, roles, afterDepartments) &&
        (!before || !evaluatePermission(before, p.code, roles, beforeDepartments)) && !auth.can(p.code)) return 'نقل المستخدم أو تعديل دوره يمنحه صلاحية لا تملكها';
    }
  }
  return null;
}
