import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, DEFAULT_ROLE_DEFINITIONS, computeEffectivePermissions, evaluatePermission, resolvePermission } from '../../src/shared/rbac';
import type { Department } from '../../src/shared/departments';
import type { User } from '../../src/types';

const user = { id: 'worker', role: 'VIEWER', isActive: true, departmentId: 'child', customPermissions: [] } as unknown as User;
const roles = [{ ...DEFAULT_ROLE_DEFINITIONS[0], id: 'viewer', roleCode: 'VIEWER', permissions: ['news.view'] }];
const departments = [
  { id: 'parent', name: 'الإنتاج', permissionOverrides: ['!news.view', 'media.upload'] },
  { id: 'child', name: 'المونتاج', parentId: 'parent', permissionOverrides: [] },
] as Department[];
// Removing department context from either evaluator must break these tests.
describe('department-aware permissions', () => {
  it('inherits parent grants and denies even for archived departments', () => {
    expect(evaluatePermission(user, 'news.view', roles, departments)).toBe(false);
    expect(evaluatePermission(user, 'media.upload', roles, departments)).toBe(true);
    expect(evaluatePermission(user, 'media.upload', roles, departments.map(d => ({ ...d, archived: true })))).toBe(true);
  });
  it('department denial beats user grant, user denial beats department grant', () => {
    const edited = { ...user, customPermissions: ['news.view', '!media.upload'] };
    expect(evaluatePermission(edited, 'news.view', roles, departments)).toBe(false);
    expect(evaluatePermission(edited, 'media.upload', roles, departments)).toBe(false);
    expect(computeEffectivePermissions(edited, roles, departments)).not.toContain('news.view');
  });
  it('recalculates membership without copying grants', () => {
    expect(evaluatePermission(user, 'media.upload', roles, departments)).toBe(true);
    expect(evaluatePermission({ ...user, departmentId: 'other' }, 'media.upload', roles, departments)).toBe(false);
    expect(user.customPermissions).toEqual([]);
  });
  it('does not grant sensitive or unknown permissions through departments', () => {
    const forged = [{ id: 'child', name: 'x', permissionOverrides: ['users.create', 'system.settings', 'audit.view', 'unknown.code'] }];
    for (const code of ['users.create', 'system.settings', 'audit.view', 'unknown.code']) {
      expect(evaluatePermission(user, code, roles, forged)).toBe(false);
    }
  });
  it('cannot use a department denial to remove the assigned-work-only scope restriction', () => {
    const restrictedRoles = [{ ...roles[0], permissions: ['work.assigned_only', 'cards.view'] }];
    expect(evaluatePermission(user, 'work.assigned_only', restrictedRoles, [{ id: 'child', name: 'x', permissionOverrides: ['!work.assigned_only'] }])).toBe(true);
  });
  it.each(['child', 'parent'])('an inherited restriction from %s wins over an existing individual denial', (source) => {
    const policy = departments.map(d => ({ ...d, permissionOverrides: d.id === source ? ['work.assigned_only'] : [] }));
    const member = { ...user, customPermissions: ['!work.assigned_only'] };
    expect(resolvePermission(member, 'work.assigned_only', roles, policy)).toMatchObject({
      allowed: true, source: 'department-grant', departmentId: source,
    });
    expect(computeEffectivePermissions(member, roles, policy)).toContain('work.assigned_only');
  });
  it('any ancestor denial wins over a nearer department grant with the correct source', () => {
    const policy = departments.map(d => d.id === 'child' ? { ...d, permissionOverrides: ['news.view'] } : d);
    expect(resolvePermission(user, 'news.view', roles, policy)).toMatchObject({
      allowed: false, source: 'department-deny', departmentId: 'parent',
    });
  });
  it('blocks inactive accounts and protects active super administrators', () => {
    expect(evaluatePermission({ ...user, isActive: false }, 'media.upload', roles, departments)).toBe(false);
    expect(evaluatePermission({ ...user, role: 'SUPER_ADMIN' }, 'news.view', roles, departments)).toBe(true);
    expect(evaluatePermission({ ...user, role: 'SUPER_ADMIN', isActive: false }, 'news.view', roles, departments)).toBe(false);
  });
  it('fails closed on a malformed ancestry cycle', () => {
    const cyclic = [{ id: 'child', name: 'x', parentId: 'child', permissionOverrides: ['media.upload'] }];
    expect(evaluatePermission(user, 'media.upload', roles, cyclic)).toBe(false);
  });
  it('keeps effective-list and individual decisions consistent for every known permission', () => {
    const effective = computeEffectivePermissions(user, roles, departments);
    for (const permission of ALL_PERMISSIONS) expect(effective.includes(permission.code)).toBe(evaluatePermission(user, permission.code, roles, departments));
  });
});
