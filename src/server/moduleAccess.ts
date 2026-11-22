import { allowsModule, moduleRule, type ModuleAvailability, type ModuleId } from '../shared/moduleAccess';
import { findUserRole } from '../shared/rbac';
import type { User } from '../types';
import { loadRoles, type AuthContext } from './auth';
import type { NewsroomDatabase } from './db';

export function moduleAllowed(auth: AuthContext, module: ModuleId): boolean {
  return auth.moduleAllowed?.(module) !== false;
}

export function moduleAvailability(auth: AuthContext): ModuleAvailability {
  return { programmes: moduleAllowed(auth, 'programmes'), assignments: moduleAllowed(auth, 'assignments') };
}

/** Background work has no request context. Evaluate the recipient using the same stored policy. */
export function moduleAllowedForUser(db: NewsroomDatabase, module: ModuleId, userId: string): boolean {
  const access = db.getRow('settings', 'singleton')?.d?.moduleAccess;
  const { mode } = moduleRule(access, module);
  if (mode !== 'selected') return mode === 'everyone';
  const user = db.getRow('users', userId)?.d as User | undefined;
  return !!user?.isActive && !user.deletedAt && allowsModule(access, module, userId, findUserRole(user, loadRoles(db))?.id);
}
