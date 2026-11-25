import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import type { NewsroomDatabase } from './db';
import { buildAuthContext, loadRoles, requirePermission } from './auth';
import { POLICIES } from './policy';
import { permissionChangeError, permissionListError } from './permissionChanges';
import { departmentsError, departmentsOf } from '../shared/departments';
import type { PermissionTarget, PermissionsSnapshot } from '../shared/permissionsWorkspace';
import type { User } from '../types';
import type { CollectionName } from '../shared/collections';
import { changeBus } from './sync';

function snapshot(db: NewsroomDatabase): PermissionsSnapshot {
  const roles = loadRoles(db);
  const departments = departmentsOf(db.getRow('settings', 'singleton')?.d);
  const users = db.listCollection('users').filter(r => !r.d.deletedAt).map(r => {
    const u = r.d as User;
    // Permission preview needs principal identity, not private contact details.
    return { id: u.id, fullName: u.fullName, role: u.role, customRoleId: u.customRoleId, department: u.department,
      departmentId: u.departmentId, stationId: u.stationId, isActive: u.isActive,
      customPermissions: u.customPermissions, avatarUrl: u.avatarUrl, jobTitle: u.jobTitle, email: '', createdAt: u.createdAt } as User;
  });
  const version = createHash('sha256').update(JSON.stringify({ roles, departments, users })).digest('hex');
  return { version, roles, departments, users };
}

/** Dedicated writes never expose general settings-edit authority. */
export function permissionsWorkspaceRouter(db: NewsroomDatabase) {
  const router = Router();
  router.use(requirePermission('users.manage_roles_permissions'));
  router.get('/', (_req, res) => res.json({ success: true, data: snapshot(db) }));
  router.put('/', (req, res, next) => {
    try {
      const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { permissionStatus: status }); };
      db.transaction(() => {
        const auth = buildAuthContext(db, db.getRow('users', req.auth!.user.id)!.d, req.auth!.sessionId);
        if (!auth.can('users.manage_roles_permissions')) fail(403, 'صلاحياتك لا تسمح بإدارة الصلاحيات');
        const current = snapshot(db);
        if (typeof req.body.version !== 'string' || req.body.version !== current.version) fail(409, 'تغيّرت الصلاحيات أو العضويات؛ أعد تحميل النسخة الحالية وراجع تعديلاتك');
        const { kind, id, permissions } = req.body;
        if (!['role', 'department', 'user'].includes(kind) || typeof id !== 'string') fail(400, 'الجهة المحددة غير صالحة');
        const collection: CollectionName = kind === 'role' ? 'roles' : kind === 'user' ? 'users' : 'settings';
        const row = db.getRow(collection, kind === 'department' ? 'singleton' : id);
        if (!row) fail(404, 'السجل المطلوب غير موجود');
        // An existing scope-restriction denial stays valid; adding a new one is refused.
        const invalid = permissionListError(permissions, kind === 'department', kind === 'role', kind === 'user' ? row.d.customPermissions || [] : []);
        if (invalid) fail(400, invalid);
        let after = { ...row!.d };
        if (kind === 'department') {
          if (!current.departments.some(d => d.id === id)) fail(404, 'القسم غير موجود');
          after.departments = current.departments.map(d => d.id === id ? { ...d, permissionOverrides: permissions } : d);
          const invalidDepartments = departmentsError(after.departments);
          if (invalidDepartments) fail(400, invalidDepartments);
        } else if (kind === 'role') after.permissions = permissions;
        else after.customPermissions = permissions;
        const input = { auth, collection, kind: 'update' as const, before: row!.d, after, list: (c: Parameters<NewsroomDatabase['listCollection']>[0]) => db.listCollection(c).map(r => r.d) };
        const denied = kind === 'department' ? permissionChangeError(input) : POLICIES[collection](input);
        if (denied) fail(403, denied);
        db.recordHistory(collection, row!.id, row!.v, row!.d, auth.user.id, auth.user.fullName);
        db.writeRow(collection, row!.id, after, row!.p, auth.user.id);
        const auditId = `aud-${randomUUID()}`;
        const beforePermissions = kind === 'department' ? current.departments.find(d => d.id === id)?.permissionOverrides || [] :
          kind === 'role' ? row!.d.permissions : row!.d.customPermissions || [];
        db.writeRow('auditLogs', auditId, {
          id: auditId, userId: auth.user.id, userName: auth.user.fullName, userRole: auth.user.role,
          actionType: 'PERMISSIONS_UPDATED', targetEntity: kind === 'role' ? 'ROLE' : kind === 'user' ? 'USER' : 'DEPARTMENT', targetId: id, severity: 'SECURITY',
          details: JSON.stringify({ kind: kind as PermissionTarget, before: beforePermissions, after: permissions }),
          timestamp: new Date().toISOString(), ipAddress: req.ip || 'unknown',
        }, db.positionBounds('auditLogs').min - 1, auth.user.id);
      });
      changeBus.emit('rev', db.currentRev());
      res.json({ success: true, data: snapshot(db) });
    } catch (error) {
      if (error instanceof Error && 'permissionStatus' in error) res.status(Number(error.permissionStatus)).json({ success: false, error: error.message });
      else next(error);
    }
  });
  return router;
}
