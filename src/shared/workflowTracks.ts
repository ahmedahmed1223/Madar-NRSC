import type { CardKind } from './productionCards';

export const WORKFLOW_TRACKS = ['news', 'programmes'] as const;
export type WorkflowTrack = (typeof WORKFLOW_TRACKS)[number];
export type WorkflowRole = 'MANAGER' | 'PREPARER';
export type WorkflowRoles = Partial<Record<WorkflowTrack, WorkflowRole>>;

export const WORKFLOW_DELEGATION_PERMISSIONS = ['manageAssignments', 'skipOptionalSteps'] as const;
export type WorkflowDelegationPermission = (typeof WORKFLOW_DELEGATION_PERMISSIONS)[number];
export interface WorkflowDelegation {
  expiresAt: string;
  permissions: readonly WorkflowDelegationPermission[];
}
export type WorkflowDelegations = Partial<Record<WorkflowTrack, WorkflowDelegation>>;

interface WorkflowAccount {
  role?: string;
  isActive?: boolean;
  deletedAt?: string | null;
  workflowRoles?: WorkflowRoles | null;
  workflowDelegations?: WorkflowDelegations;
}

export const WORKFLOW_TRACK_LABEL: Record<WorkflowTrack, string> = { news: 'الأخبار', programmes: 'البرامج' };
export const WORKFLOW_ROLE_LABEL: Record<WorkflowTrack, Record<WorkflowRole, string>> = {
  news: { MANAGER: 'مدير إعداد الأخبار', PREPARER: 'معدّ أخبار' },
  programmes: { MANAGER: 'مدير إعداد البرامج', PREPARER: 'معدّ برامج' },
};
export const WORKFLOW_DELEGATION_LABEL: Record<WorkflowDelegationPermission, string> = {
  manageAssignments: 'إدارة التكليفات الجارية',
  skipOptionalSteps: 'تجاوز الخطوات الاختيارية',
};

export function workflowTrackOf(kind: CardKind, target?: string | { kind: string } | null): WorkflowTrack {
  const targetKind = typeof target === 'string' ? target : target?.kind;
  if (targetKind === 'episode') return 'programmes';
  if (targetKind === 'news' || targetKind === 'bulletin') return 'news';
  return kind === 'PROGRAM' ? 'programmes' : 'news';
}

const active = (account: WorkflowAccount) => account.isActive !== false && !account.deletedAt;
const managesBoth = (account: WorkflowAccount) => account.role === 'SUPER_ADMIN' || account.role === 'GENERAL_MANAGER';

/** The caller supplies its existing authorization when handling a pre-upgrade account. */
export function mayManageWorkflowTrack(account: WorkflowAccount, track: WorkflowTrack, legacyMayManage = false): boolean {
  return active(account) && (
    managesBoth(account) ||
    (account.workflowRoles == null ? legacyMayManage : account.workflowRoles[track] === 'MANAGER')
  );
}

export function hasWorkflowDelegation(
  account: WorkflowAccount,
  track: WorkflowTrack,
  permission: WorkflowDelegationPermission,
  now = new Date(),
): boolean {
  const grant = account.workflowDelegations?.[track];
  return active(account) && !!grant && Date.parse(grant.expiresAt) > now.getTime() &&
    Array.isArray(grant.permissions) && grant.permissions.includes(permission);
}

/** A track boundary. Callers also apply record, station, and module access. */
export function mayReadWorkflowTrack(account: WorkflowAccount, track: WorkflowTrack, now = new Date()): boolean {
  const role = account.workflowRoles?.[track];
  return active(account) && (
    managesBoth(account) || account.workflowRoles == null || role === 'MANAGER' || role === 'PREPARER' ||
    WORKFLOW_DELEGATION_PERMISSIONS.some(permission => hasWorkflowDelegation(account, track, permission, now))
  );
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const knownTrack = (key: string) => WORKFLOW_TRACKS.some(track => track === key);

export function workflowScopeError(roles: unknown, delegations: unknown): string | null {
  if (roles != null && (!record(roles) || Object.entries(roles).some(([track, role]) =>
    !knownTrack(track) || (role !== 'MANAGER' && role !== 'PREPARER')))) return 'أدوار مساري الإعداد غير صالحة';
  if (delegations === undefined) return null;
  if (!record(delegations)) return 'تفويضات مساري الإعداد غير صالحة';
  for (const [track, grant] of Object.entries(delegations)) {
    if (!knownTrack(track) || !record(grant) || Object.keys(grant).some(key => key !== 'expiresAt' && key !== 'permissions')) {
      return 'تفويض مسار الإعداد غير صالح';
    }
    if (typeof grant.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(grant.expiresAt) ||
      !Number.isFinite(Date.parse(grant.expiresAt))) return 'وقت انتهاء التفويض غير صالح';
    if (!Array.isArray(grant.permissions) || !grant.permissions.length ||
      new Set(grant.permissions).size !== grant.permissions.length ||
      grant.permissions.some(permission => !WORKFLOW_DELEGATION_PERMISSIONS.includes(permission))) {
      return 'حدد صلاحيات التفويض ضمن المسار';
    }
  }
  return null;
}
