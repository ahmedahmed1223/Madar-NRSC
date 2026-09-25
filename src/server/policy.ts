import type { CollectionName } from '../shared/collections';
import type { AuthContext } from './auth';

export type WriteKind = 'create' | 'update' | 'delete';

export interface PolicyInput {
  auth: AuthContext;
  collection: CollectionName;
  kind: WriteKind;
  before: any | null;
  after: any | null;
}

/** Returns an Arabic error message when the write is not allowed, otherwise null. */
export type Policy = (input: PolicyInput) => string | null;

const DENIED = 'صلاحياتك لا تسمح بتنفيذ هذا الإجراء';

const any = (auth: AuthContext, ...perms: string[]) => perms.some((p) => auth.can(p));

const require =
  (...perms: string[]): Policy =>
  ({ auth }) =>
    any(auth, ...perms) ? null : DENIED;

/** Soft-deletes arrive as updates that set `deletedAt`. */
const isSoftDelete = (before: any, after: any) => !!after?.deletedAt && !before?.deletedAt;

const PRIVILEGED_USER_FIELDS = ['role', 'customRoleId', 'customPermissions', 'isActive', 'securityClearance'] as const;

function changed(before: any, after: any, field: string) {
  return JSON.stringify(before?.[field] ?? null) !== JSON.stringify(after?.[field] ?? null);
}

const newsPolicy: Policy = ({ auth, kind, before, after }) => {
  if (kind === 'delete' || isSoftDelete(before, after)) {
    return auth.can('news.delete') ? null : 'صلاحياتك لا تسمح بحذف الأخبار';
  }
  if (kind === 'create') {
    if (!auth.can('news.create')) return 'صلاحياتك لا تسمح بإنشاء الأخبار';
  } else {
    const isOwn = before?.authorId === auth.user.id;
    const statusChange = before?.status !== after?.status;
    // A workflow transition by a reviewer is allowed even on someone else's story.
    const reviewer = statusChange && any(auth, 'news.review', 'news.approve', 'news.publish');
    if (!auth.can('news.edit_any') && !(isOwn && auth.can('news.edit_own')) && !reviewer) {
      return 'صلاحياتك لا تسمح بتعديل هذا الخبر';
    }
    // Content that is live (or cleared to go live) must not change without the matching sign-off.
    if (before?.status === 'PUBLISHED' && !auth.can('news.publish')) return 'لا يمكن تعديل خبر منشور دون صلاحية النشر';
    if (before?.status === 'APPROVED' && !any(auth, 'news.approve', 'news.publish')) {
      return 'لا يمكن تعديل خبر معتمد دون صلاحية الاعتماد';
    }
  }
  const prevStatus = before?.status;
  const nextStatus = after?.status;
  if (nextStatus !== prevStatus) {
    if (nextStatus === 'APPROVED' && !auth.can('news.approve')) return 'صلاحياتك لا تسمح باعتماد الأخبار';
    if (nextStatus === 'PUBLISHED' && !auth.can('news.publish')) return 'صلاحياتك لا تسمح بنشر الأخبار';
    if (prevStatus === 'PUBLISHED' && !auth.can('news.publish')) return 'صلاحياتك لا تسمح بإلغاء نشر الأخبار';
  }
  if (!!after?.isBreaking && !before?.isBreaking && !auth.can('news.breaking_push')) {
    return 'صلاحياتك لا تسمح بإطلاق الأخبار العاجلة';
  }
  return null;
};

const usersPolicy: Policy = ({ auth, kind, before, after }) => {
  const self = auth.user.id;
  const targetId = (after ?? before)?.id;
  if (kind === 'delete' || isSoftDelete(before, after)) {
    if (targetId === self) return 'لا يمكن حذف الحساب النشط حالياً';
    return auth.can('users.suspend_delete') ? null : DENIED;
  }
  if (kind === 'create') {
    if (!auth.can('users.create')) return DENIED;
    if (after?.role === 'SUPER_ADMIN' && auth.user.role !== 'SUPER_ADMIN') return 'فقط مدير النظام العام يمكنه إنشاء حساب مدير عام';
    return null;
  }
  const privilegedChange = PRIVILEGED_USER_FIELDS.some((f) => changed(before, after, f));
  if (privilegedChange) {
    if (targetId === self) return 'لا يمكنك تعديل دورك أو صلاحياتك أو حالة حسابك بنفسك';
    if (changed(before, after, 'isActive') && !auth.can('users.suspend_delete')) return DENIED;
    const roleFields = PRIVILEGED_USER_FIELDS.filter((f) => f !== 'isActive');
    if (roleFields.some((f) => changed(before, after, f)) && !auth.can('users.manage_roles_permissions')) return DENIED;
    if ((after?.role === 'SUPER_ADMIN' || before?.role === 'SUPER_ADMIN') && auth.user.role !== 'SUPER_ADMIN') {
      return 'فقط مدير النظام العام يمكنه تعديل حسابات المدير العام';
    }
  }
  if (targetId === self) return null; // own profile fields
  return auth.can('users.edit_profile') ? null : DENIED;
};

const episodesPolicy: Policy = ({ auth, kind, before, after }) => {
  if (kind === 'create') return auth.can('episodes.create') ? null : 'صلاحياتك لا تسمح بإنشاء الحلقات';
  if (kind === 'delete' || isSoftDelete(before, after)) {
    return any(auth, 'programs.manage', 'episodes.edit') ? null : 'صلاحياتك لا تسمح بحذف الحلقات';
  }
  if (any(auth, 'episodes.edit')) return null;
  // Narrower roles may only touch the parts of the episode their permission covers.
  const changedKeys = new Set(
    [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter(
      (k) => k !== 'updatedAt' && changed(before, after, k)
    )
  );
  const allowed = new Set<string>();
  if (any(auth, 'rundown.edit', 'rundown.reorder')) allowed.add('rundown').add('durationMinutes');
  if (auth.can('rundown.presenter_teleprompter')) allowed.add('questions');
  return [...changedKeys].every((k) => allowed.has(k)) ? null : 'صلاحياتك لا تسمح بتعديل هذه الحلقة';
};

const tasksPolicy: Policy = ({ auth, kind, before, after }) => {
  if (auth.can('tasks.create_assign')) return null;
  // Assignees may progress their own tasks.
  if (kind === 'update' && before?.assigneeId === auth.user.id && after?.assigneeId === auth.user.id && !isSoftDelete(before, after)) {
    return null;
  }
  return 'صلاحياتك لا تسمح بإدارة المهام';
};

const mediaPolicy: Policy = ({ auth, kind, before, after }) => {
  if (kind === 'delete' || isSoftDelete(before, after)) return auth.can('media.delete') ? null : 'صلاحياتك لا تسمح بحذف الوسائط';
  return auth.can('media.upload') ? null : 'صلاحياتك لا تسمح برفع الوسائط';
};

const notificationsPolicy: Policy = ({ auth, kind, before }) => {
  if (kind === 'create') return null; // any signed-in user may notify a colleague
  if (before?.userId === auth.user.id) return null; // mark own as read / dismiss
  return auth.can('system.settings') ? null : DENIED;
};

/** Logs are append-only: identity fields are stamped by the server, edits are rejected. */
const logPolicy: Policy = ({ kind }) => (kind === 'create' ? null : 'السجلات غير قابلة للتعديل أو الحذف');

export const POLICIES: Record<CollectionName, Policy> = {
  users: usersPolicy,
  roles: require('users.manage_roles_permissions'),
  news: newsPolicy,
  stories: ({ auth, kind, before, after }) =>
    kind === 'delete' || isSoftDelete(before, after)
      ? auth.can('news.delete') ? null : DENIED
      : any(auth, 'news.create', 'news.edit_any') ? null : DENIED,
  breaking: require('news.breaking_push'),
  programs: require('programs.manage'),
  programEvaluations: require('episodes.evaluate'),
  episodes: episodesPolicy,
  guests: require('guests.manage'),
  tasks: tasksPolicy,
  media: mediaPolicy,
  categories: require('system.settings'),
  sources: require('system.settings'),
  programTypes: require('system.settings'),
  settings: require('system.settings'),
  notifications: notificationsPolicy,
  activityLogs: logPolicy,
  auditLogs: logPolicy,
};

/** Read filter per collection; returning false hides the row from the user. */
export function canRead(auth: AuthContext, collection: CollectionName, data: any): boolean {
  switch (collection) {
    case 'auditLogs':
      return auth.can('audit.view');
    case 'notifications':
      return !data?.userId || data.userId === auth.user.id || data.userId === 'all';
    default:
      return true;
  }
}
