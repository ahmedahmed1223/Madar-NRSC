import { allowsModule, MODULE_IDS, MODULE_UNAVAILABLE, moduleSubject, type ModuleAvailability, type ModuleId } from '../shared/moduleAccess';
import { departmentsOf } from '../shared/departments';
import { findUserRole } from '../shared/rbac';
import type { RequestHandler } from 'express';
import type { CollectionName } from '../shared/collections';
import type { SystemSettings, User } from '../types';
import { loadRoles, type AuthContext } from './auth';
import type { NewsroomDatabase } from './db';

export function moduleAllowed(auth: AuthContext, module: ModuleId, stationId?: string): boolean {
  return auth.moduleAllowed?.(module, stationId) !== false;
}

function stationDerivedUserId(collection: CollectionName, data: any): string | undefined {
  const id = collection === 'news' ? data?.authorId
    : collection === 'tasks' ? data?.assigneeId || data?.assignedToId
    : collection === 'media' ? data?.ownerId || data?.uploadedById
    : undefined;
  return typeof id === 'string' ? id : undefined;
}

export function inferredStationPolicyChangeError(before: User, after: User, settings?: SystemSettings, list?: (collection: CollectionName) => any[]): string | null {
  if ((before.stationId || undefined) === (after.stationId || undefined)) return null;
  for (const collection of ['news', 'tasks', 'media'] as const) {
    const affected = settings?.moduleAccess?.[collection]?.scopes?.some(scope =>
      scope.mode !== 'everyone' && scope.stationId && (scope.stationId === before.stationId || scope.stationId === after.stationId));
    if (affected && list?.(collection).some(record => record.stationId == null && record.ownerStationId == null && stationDerivedUserId(collection, record) === before.id)) {
      return 'تغيير المحطة يؤثر في إتاحة الوحدات لسجلات مرتبطة بحسابك. اطلب من مسؤول مخوّل نقل الحساب.';
    }
  }
  return null;
}

export function moduleAllowsRecord(auth: AuthContext, module: ModuleId, collection: CollectionName, data: any,
  lookup?: (collection: CollectionName, id: string) => any): boolean {
  if (!moduleAllowed(auth, module, data?.stationId ?? data?.ownerStationId)) return false;
  if (!data || !lookup || !auth.moduleHasStationLimits?.(module)) return true;
  const get = (target: CollectionName, id: unknown) => typeof id === 'string' ? lookup(target, id) : undefined;
  const station = collection === 'bulletinStories' ? get('bulletins', data.bulletinId)?.stationId
    : get('users', stationDerivedUserId(collection, data))?.stationId;
  return moduleAllowed(auth, module, data.stationId ?? data.ownerStationId ?? station);
}

export function moduleAvailability(auth: AuthContext): ModuleAvailability {
  return {
    ...Object.fromEntries(MODULE_IDS.map(id => [id, moduleAllowed(auth, id)])) as Record<ModuleId, boolean>,
    assignmentIntake: auth.moduleAllowsNewWork?.('assignments') ?? moduleAllowed(auth, 'assignments'),
  };
}

/** Background work has no request context. Evaluate the recipient using the same stored policy. */
export function moduleAllowedForUser(db: NewsroomDatabase, module: ModuleId, userId: string | undefined, stationId?: string): boolean {
  const settings = db.getRow('settings', 'singleton')?.d;
  const access = settings?.moduleAccess;
  if (!access || Object.keys(access).length === 0) return true;
  const user = userId ? db.getRow('users', userId)?.d as User | undefined : undefined;
  if (user?.isActive === false || user?.deletedAt) return false;
  const subject = user ? moduleSubject(user, findUserRole(user, loadRoles(db))?.id, departmentsOf(settings)) : { id: '' };
  return allowsModule(access, module, subject, undefined, stationId);
}

export function requireModule(module: ModuleId): RequestHandler {
  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ success: false, code: 'UNAUTHENTICATED' });
    if (!moduleAllowed(req.auth, module)) {
      return res.status(403).json({ success: false, code: 'FORBIDDEN', error: MODULE_UNAVAILABLE });
    }
    next();
  };
}
