import type { Department } from './departments';
import type { RoleDefinition } from './rbac';
import type { User } from '../types';

export type PermissionTarget = 'role' | 'department' | 'user';
export interface PermissionsSnapshot {
  version: string;
  roles: RoleDefinition[];
  departments: Department[];
  users: User[];
}
export interface PermissionWrite {
  version: string;
  kind: PermissionTarget;
  id: string;
  permissions: string[];
}
