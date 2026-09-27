import { prefsError } from '../shared/notifications';
import { bookingError, diaryError, RESOURCE_KINDS } from '../shared/planning';
import { commentError } from '../shared/comments';
import { episodePlanError } from '../shared/episodePlan';
import { episodeReadiness, requestChangeError } from '../shared/production';
import { departmentIdOf, isDepartmentId } from '../shared/departments';
import { canControlOnAir } from '../shared/onair';
import { bulletinError, findShow, formatError, isApprover, storyError, storyStatusError } from '../shared/bulletins';
import { rosterEntryError } from '../shared/roster';
import type { CollectionName } from '../shared/collections';
import type { AuthContext } from './auth';
import { canEditNewsContent, contentDenial, embargoDenial, isUnderEmbargo, transitionDenial } from '../shared/newsWorkflow';

export type WriteKind = 'create' | 'update' | 'delete';

export interface PolicyInput {
  auth: AuthContext;
  collection: CollectionName;
  kind: WriteKind;
  before: any | null;
  after: any | null;
  /** Read access to other rows (e.g. to check for duplicate role codes). */
  list?: (collection: CollectionName) => any[];
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

const PRIVILEGED_USER_FIELDS = ['role', 'customRoleId', 'customPermissions', 'isActive', 'departmentId'] as const;

function changed(before: any, after: any, field: string) {
  return JSON.stringify(before?.[field] ?? null) !== JSON.stringify(after?.[field] ?? null);
}

const newsPolicy: Policy = ({ auth, kind, before, after }) => {
  const can = (p: string) => auth.can(p);
  const me = auth.user.id;
  if (kind === 'delete' || isSoftDelete(before, after)) {
    return auth.can('news.delete') ? null : 'صلاحياتك لا تسمح بحذف الأخبار';
  }
  if (before?.deletedAt && !after?.deletedAt) {
    return auth.can('news.delete') ? null : 'صلاحياتك لا تسمح باستعادة الأخبار المحذوفة';
  }

  const statusChanged = kind === 'create' || before?.status !== after?.status;
  if (statusChanged) {
    const denial = transitionDenial(can, me, kind === 'create' ? null : before, after?.status);
    if (denial) return denial;
    // Nothing empty goes to review, approval or air — whichever screen sent it.
    const empty = contentDenial(after, after?.status);
    if (empty) return empty.message;
  }
  if (after?.status === 'SCHEDULED') {
    if (!after.scheduledDate || !Number.isFinite(new Date(after.scheduledDate).getTime())) return 'حدد موعداً صالحاً للنشر المجدول';
    if (changed(before, after, 'scheduledDate') && !can('news.publish')) return 'صلاحياتك لا تسمح بجدولة النشر';
  }
  // The embargo is checked against the stored story as it will be after this write.
  if (after && !after.deletedAt) {
    if (after.embargoUntil !== undefined && after.embargoUntil !== null && after.embargoUntil !== '' && !Number.isFinite(Date.parse(after.embargoUntil))) return 'موعد الحظر غير صالح';
    if (after.status === 'PUBLISHED' && before?.status !== 'PUBLISHED' && isUnderEmbargo(after)) return embargoDenial(after, 'PUBLISHED');
    if (after.status === 'SCHEDULED') {
      const denial = embargoDenial(after, 'SCHEDULED');
      if (denial) return denial;
    }
    // Lifting or shortening an embargo that is still running is an editor's call.
    if (before && isUnderEmbargo(before) && changed(before, after, 'embargoUntil') && !(after.embargoUntil && Date.parse(after.embargoUntil) >= Date.parse(before.embargoUntil)) && !any(auth, 'news.approve', 'news.publish')) {
      return 'رفع الحظر أو تقديمه لرئيس التحرير';
    }
  }

  // Content edits (anything besides workflow bookkeeping) need edit rights on the story as it was.
  const contentChanged =
    kind === 'create' ||
    [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].some(
      (k) => !WORKFLOW_FIELDS.has(k) && changed(before, after, k)
    );
  if (contentChanged && !canEditNewsContent(can, me, kind === 'create' ? null : before)) {
    if (kind === 'create') return 'صلاحياتك لا تسمح بإنشاء الأخبار';
    if (before?.status === 'PUBLISHED' || before?.status === 'SCHEDULED') return 'لا يمكن تعديل خبر منشور دون صلاحية النشر';
    if (before?.status === 'APPROVED') return 'لا يمكن تعديل خبر معتمد دون صلاحية الاعتماد';
    return 'صلاحياتك لا تسمح بتعديل هذا الخبر';
  }

  if (!!before?.isBreaking !== !!after?.isBreaking && !auth.can('news.breaking_push')) {
    return 'صلاحياتك لا تسمح بإطلاق الأخبار العاجلة أو إيقافها';
  }
  return null;
};

/** Fields a status transition is allowed to touch without content-edit rights. */
const WORKFLOW_FIELDS = new Set([
  'status',
  'workflowLogs',
  'updatedAt',
  'publishDate',
  'editorId',
  'editorName',
  'approvedById',
  'approvedByName',
  'approvedAt',
  'publishedById',
  'publishedByName',
  'isBreaking',
  'breakingUntil',
  'slug',
  'scheduledDate',
]);

const usersPolicy: Policy = ({ auth, kind, before, after }) => {
  const self = auth.user.id;
  const targetId = (after ?? before)?.id;
  const actorIsSuper = auth.user.role === 'SUPER_ADMIN';
  // Super-admin accounts can only be touched by a super admin (or themselves for profile fields).
  const targetIsSuper = before?.role === 'SUPER_ADMIN' || after?.role === 'SUPER_ADMIN';
  if (targetIsSuper && !actorIsSuper && targetId !== self) return 'فقط مدير النظام العام يمكنه تعديل أو حذف حسابات المدير العام';

  if (kind === 'delete' || isSoftDelete(before, after)) {
    if (targetId === self) return 'لا يمكن حذف الحساب النشط حالياً';
    return auth.can('users.suspend_delete') ? null : DENIED;
  }
  if (kind === 'create') {
    if (!auth.can('users.create')) return DENIED;
    const privileged =
      ['ADMIN', 'SUPER_ADMIN'].includes(after?.role) || (after?.customPermissions?.length ?? 0) > 0 || !!after?.customRoleId;
    if (privileged && !auth.can('users.manage_roles_permissions')) return 'منح دور إداري أو صلاحيات مخصصة يتطلب صلاحية إدارة الأدوار';
    return null;
  }
  const privilegedChange = PRIVILEGED_USER_FIELDS.some((f) => changed(before, after, f));
  if (privilegedChange) {
    if (targetId === self) return 'لا يمكنك تعديل دورك أو صلاحياتك أو حالة حسابك بنفسك';
    if (changed(before, after, 'isActive') && !auth.can('users.suspend_delete')) return DENIED;
    const roleFields = PRIVILEGED_USER_FIELDS.filter((f) => f !== 'isActive');
    if (roleFields.some((f) => changed(before, after, f)) && !auth.can('users.manage_roles_permissions')) return DENIED;
  }
  if (targetId === self) return null; // own profile fields
  return auth.can('users.edit_profile') ? null : DENIED;
};

/**
 * Role definitions: nobody may edit the role they hold (no self-escalation), grant permissions
 * they do not have themselves, or touch the ADMIN/SUPER_ADMIN roles unless super admin.
 */
const rolesPolicy: Policy = ({ auth, kind, before, after, list }) => {
  if (!auth.can('users.manage_roles_permissions')) return DENIED;
  const actorIsSuper = auth.user.role === 'SUPER_ADMIN';
  const role = after ?? before;
  const codes = [before?.roleCode, after?.roleCode].filter(Boolean);
  if (!actorIsSuper) {
    if (codes.some((c) => c === 'SUPER_ADMIN' || c === 'ADMIN')) return 'فقط مدير النظام العام يمكنه تعديل أدوار الإدارة العليا';
    const ownRole = codes.includes(auth.user.role) || (auth.user.customRoleId && role?.id === auth.user.customRoleId);
    if (ownRole) return 'لا يمكنك تعديل الدور الذي تحمله';
    const added = ((after?.permissions as string[]) || []).filter((p) => !((before?.permissions as string[]) || []).includes(p));
    const notHeld = added.filter((p) => !auth.can(p));
    if (notHeld.length) return `لا يمكنك منح صلاحيات لا تملكها: ${notHeld.join('، ')}`;
  }
  if (kind === 'delete') return before?.isSystemRole ? 'لا يمكن حذف الأدوار الأساسية للنظام' : null;
  if (before && (before.isSystemRole !== after?.isSystemRole || (before.isSystemRole && before.roleCode !== after?.roleCode))) {
    return 'لا يمكن تغيير رمز أو صفة دور أساسي';
  }
  if (kind === 'create') {
    if (after?.isSystemRole) return 'لا يمكن إنشاء دور أساسي جديد';
    const duplicate = (list?.('roles') || []).some((r) => r.roleCode === after?.roleCode);
    if (duplicate) return 'يوجد دور بنفس الرمز مسبقاً';
  }
  return null;
};

const episodesPolicy: Policy = ({ auth, kind, before, after, list }) => {
  if (after && !after.deletedAt) {
    const err = episodePlanError(after);
    if (err) return err;
  }
  // An episode is only declared ready for air when every department has delivered.
  if (after?.status === 'READY_FOR_BROADCAST' && before?.status !== 'READY_FOR_BROADCAST' && !after?.deletedAt) {
    const readiness = episodeReadiness(after, { requests: list?.('requests') || [], media: list?.('media') || [] });
    if (!readiness.ready) {
      const first = readiness.blockers[0];
      return readiness.total === 0
        ? 'لا يمكن اعتماد حلقة بلا فقرات للبث'
        : `لا يمكن اعتماد الحلقة للبث: ${readiness.blockers.length} عنصر غير جاهز (مثلاً «${first.segmentTitle}»: ${first.detail})`;
    }
  }
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

const bulletinsPolicy: Policy = ({ auth, kind, before, after }) => {
  if (kind === 'create' || kind === 'delete' || isSoftDelete(before, after)) {
    return auth.can('bulletins.manage') ? null : 'إنشاء النشرات وحذفها لمسؤولي النشرات';
  }
  const isEditor = !!before?.editorId && before.editorId === auth.user.id;
  if (!auth.can('bulletins.manage') && !isEditor) return 'تعديل بيانات النشرة لمحررها المسؤول';
  if (!auth.can('bulletins.manage') && after?.editorId !== before?.editorId) return 'تغيير محرر النشرة لمسؤولي النشرات';
  if (!auth.can('bulletins.manage') && JSON.stringify(after?.approvalSteps || null) !== JSON.stringify(before?.approvalSteps || null)) {
    return 'تغيير مسار الاعتماد لمسؤولي النشرات';
  }
  return after?.deletedAt ? null : bulletinError(after);
};

const bulletinStoriesPolicy: Policy = ({ auth, kind, before, after, list }) => {
  const record = after || before;
  const bulletin = (list?.('bulletins') || []).find((b: any) => b.id === record?.bulletinId);
  const actor = { id: auth.user.id, canApprove: auth.can('bulletins.approve'), canEdit: auth.can('bulletins.edit'), role: auth.user.role };
  const approver = isApprover(bulletin, actor);
  if (kind === 'delete' || isSoftDelete(before, after)) {
    return approver || auth.can('bulletins.manage') || (actor.canEdit && before?.writerId === auth.user.id) ? null : 'حذف القصة لكاتبها أو لمحرر النشرة';
  }
  if (!bulletin || bulletin.deletedAt) return 'النشرة غير موجودة';
  if (!actor.canEdit && !approver) return 'صلاحياتك لا تسمح بتعديل قصص النشرة';
  if (before && before.bulletinId !== after.bulletinId) return 'لا يمكن نقل القصة بين النشرات؛ انسخها بدلاً من ذلك';
  return storyError(after) || storyStatusError(before, after, bulletin, actor);
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
  if (kind === 'delete' || isSoftDelete(before, after)) {
    const isOwner = [before?.ownerId, before?.uploadedById].includes(auth.user.id);
    return auth.can('media.delete') || (isOwner && auth.can('media.upload')) ? null : 'صلاحياتك لا تسمح بحذف الوسائط';
  }
  return auth.can('media.upload') ? null : 'صلاحياتك لا تسمح برفع الوسائط';
};

const notificationsPolicy: Policy = ({ auth, kind, before }) => {
  if (kind === 'create') return null; // any signed-in user may notify a colleague
  if (before?.userId === auth.user.id) return null; // mark own as read / dismiss
  return auth.can('system.settings') ? null : DENIED;
};

/** Reference data (categories/sources) cannot be removed while active news still points at it. */
const referencedPolicy = (field: 'categoryId' | 'sourceId', label: string): Policy => (input) => {
  const base = require('system.settings')(input);
  if (base) return base;
  const { kind, before, after, list } = input;
  if (!before || !(kind === 'delete' || isSoftDelete(before, after))) return null;
  const inUse = ['news', 'stories']
    .flatMap((c) => list?.(c as CollectionName) || [])
    .filter((n) => !n.deletedAt && n[field] === before.id).length;
  return inUse > 0 ? `لا يمكن حذف ${label} لأنه مرتبط بـ ${inUse} مادة إخبارية نشطة؛ انقل المواد إلى ${label} آخر أولاً` : null;
};

const notificationPrefsPolicy: Policy = ({ auth, kind, after, before }) => {
  if (kind === 'delete') return (before?.userId === auth.user.id) ? null : 'يعدّل كل زميل إعدادات تنبيهاته فقط';
  return prefsError(after, auth.user.id);
};

/** Diary: planners manage entries; people assigned to an entry may note progress on it. */
const diaryPolicy: Policy = ({ auth, kind, before, after }) => {
  if (auth.can('diary.manage')) return kind === 'delete' || !after || after.deletedAt ? null : diaryError(after);
  const assigned = (before?.assigneeIds || []).includes(auth.user.id);
  if (kind === 'update' && assigned && after && !after.deletedAt) {
    const locked = ['title', 'date', 'startTime', 'endTime', 'kind', 'coverage', 'priority', 'assigneeIds', 'location'] as const;
    if (locked.some((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null))) return 'يمكنك إضافة ملاحظات وربط الأخبار فقط؛ تعديل الموعد والتكليف لمسؤول الأجندة';
    return diaryError(after);
  }
  return 'صلاحياتك لا تسمح بتعديل أجندة التغطية';
};

const resourcesPolicy: Policy = ({ auth, kind, after }) => {
  if (!auth.can('resources.manage')) return 'إدارة الموارد لمسؤول الحجوزات';
  if (kind === 'delete' || !after || after.deletedAt) return null;
  if (typeof after.name !== 'string' || !after.name.trim() || after.name.length > 120) return 'اسم المورد مطلوب';
  if (!RESOURCE_KINDS.some((k) => k.id === after.kind)) return 'نوع المورد غير معروف';
  return null;
};

/** Anyone allowed to book may book; only the booker (or a resources manager) changes a booking. */
const bookingsPolicy: Policy = ({ auth, kind, before, after }) => {
  const manager = auth.can('resources.manage');
  if (!manager && !auth.can('resources.book')) return 'صلاحياتك لا تسمح بحجز الموارد';
  if (before && !manager && before.bookedById !== auth.user.id) return 'يعدّل الحجز أو يلغيه صاحبه أو مسؤول الحجوزات';
  if (kind === 'delete' || !after || after.deletedAt) return null;
  return bookingError(after);
};

/** Logs are append-only: identity fields are stamped by the server, edits are rejected. */
const logPolicy: Policy = ({ kind }) => (kind === 'create' ? null : 'السجلات غير قابلة للتعديل أو الحذف');

export const POLICIES: Record<CollectionName, Policy> = {
  users: usersPolicy,
  roles: rolesPolicy,
  news: newsPolicy,
  stories: ({ auth, kind, before, after }) =>
    kind === 'delete' || isSoftDelete(before, after)
      ? auth.can('news.delete') ? null : DENIED
      : any(auth, 'news.create', 'news.edit_any') ? null : DENIED,
  breaking: require('news.breaking_push'),
  programs: require('programs.manage'),
  episodes: episodesPolicy,
  guests: require('guests.manage'),
  tasks: tasksPolicy,
  media: mediaPolicy,
  categories: referencedPolicy('categoryId', 'القسم'),
  sources: referencedPolicy('sourceId', 'المصدر'),
  programTypes: require('system.settings'),
  settings: require('system.settings'),
  notifications: notificationsPolicy,
  broadcastState: require('rundown.lock_override'),
  comments: ({ auth, kind, before, after }) => {
    if (kind === 'delete' || isSoftDelete(before, after)) {
      return before?.authorId === auth.user.id || auth.can('system.settings') ? null : 'يحذف التعليق كاتبه فقط';
    }
    if (kind !== 'create') return 'التعليقات لا تُعدَّل بعد نشرها';
    if (!auth.can('news.view')) return DENIED;
    return commentError(after);
  },
  bulletins: bulletinsPolicy,
  bulletinStories: bulletinStoriesPolicy,
  bulletinFormats: (input) => require('bulletins.manage')(input) || (input.after && !input.after.deletedAt ? formatError(input.after) : null),
  onAir: ({ auth, kind, after, list }) => {
    if (!canControlOnAir(auth.user, auth.can)) return 'تشغيل وضع الهواء للمخرج والكنترول فقط';
    if (kind === 'delete') return auth.can('onair.control') ? null : DENIED;
    if (!['LIVE', 'ENDED'].includes(after?.status)) return 'حالة البث غير صالحة';
    const episode = findShow(String(after?.episodeId), (c) => list?.(c) || []);
    if (!episode || after?.id !== episode.id) return 'الحلقة أو النشرة غير موجودة';
    if (!(episode.rundown || []).some((seg: any) => seg.id === after.currentSegmentId)) return 'الفقرة ليست ضمن رانداون البث';
    return null;
  },
  cues: ({ auth, kind, before, after }) => {
    if (kind === 'create') {
      if (!canControlOnAir(auth.user, auth.can) && !auth.can('tasks.intercom_broadcast')) return 'إرسال تنبيهات الهواء للمخرج والكنترول';
      if (typeof after?.message !== 'string' || !after.message.trim() || after.message.length > 300) return 'نص التنبيه غير صالح';
      if (!Array.isArray(after?.targetDepartmentIds) || !after.targetDepartmentIds.every(isDepartmentId)) return 'القسم المستهدف غير معروف';
      return null;
    }
    if (kind === 'delete') return auth.can('onair.control') ? null : DENIED;
    // Recipients may only acknowledge (the server records who and when).
    const { acks: _a, ...restBefore } = before || {};
    const { acks: _b, ...restAfter } = after || {};
    return JSON.stringify(restBefore) === JSON.stringify(restAfter) ? null : 'التنبيه لا يُعدَّل بعد إرساله';
  },
  requests: ({ auth, kind, before, after }) => {
    const canManage = auth.can('requests.manage');
    if (kind === 'delete' || isSoftDelete(before, after)) {
      return canManage || (before?.requesterId === auth.user.id && before?.status === 'OPEN') ? null : 'لا يمكنك حذف هذا الطلب';
    }
    if (kind === 'create' && !auth.can('requests.create')) return 'صلاحياتك لا تسمح بإرسال طلبات للأقسام';
    return requestChangeError(before, after, { id: auth.user.id, departmentId: departmentIdOf(auth.user), canManage });
  },
  roster: ({ auth, kind, after }) => {
    if (!auth.can('roster.manage')) return 'صلاحياتك لا تسمح بتعديل جدول المناوبات';
    if (kind === 'delete') return null;
    if (after?.deletedAt) return null;
    return rosterEntryError(after);
  },
  wires: () => 'البرقيات تُجلب من خلاصات الوكالات على الخادم ولا تُعدّل يدوياً',
  editLocks: ({ auth, kind, before, after }) => {
    const target = after ?? before;
    if (!target || !['news', 'episodes', 'bulletinStories'].includes(target.collection) || target.id !== `${target.collection}:${target.entityId}`) {
      return 'قفل تحرير غير صالح';
    }
    const noun = target.collection === 'episodes' ? 'الحلقة' : target.collection === 'bulletinStories' ? 'قصة النشرة' : 'الخبر';
    const overridePerm = target.collection === 'episodes' ? 'rundown.lock_override' : target.collection === 'bulletinStories' ? 'bulletins.approve' : 'news.edit_any';
    const heldByOther = before && before.userId !== auth.user.id && before.expiresAt && new Date(before.expiresAt).getTime() > Date.now();
    // Taking over (or clearing) a colleague's live lock is reserved for editors / rundown supervisors.
    if (heldByOther && !auth.can(overridePerm)) {
      return `${noun} قيد التحرير لدى ${before.userName}`;
    }
    const canHold =
      target.collection === 'episodes'
        ? any(auth, 'episodes.edit', 'rundown.edit', 'rundown.reorder', 'rundown.presenter_teleprompter')
        : target.collection === 'bulletinStories'
        ? any(auth, 'bulletins.edit', 'bulletins.approve', 'bulletins.manage')
        : any(auth, 'news.create', 'news.edit_any');
    if (kind !== 'delete' && !canHold) return DENIED;
    return null;
  },
  messages: ({ kind, after }) => {
    if (kind !== 'create') return 'الرسائل غير قابلة للتعديل أو الحذف';
    if (!(after?.channel === 'general' || isDepartmentId(after?.channel) || ['STUDIO_PCR', 'NEWSROOM', 'FIELD'].includes(after?.channel))) return 'قناة غير معروفة';
    if (typeof after?.text !== 'string' || !after.text.trim() || after.text.length > 2000) return 'نص الرسالة غير صالح';
    return null;
  },
  activityLogs: logPolicy,
  auditLogs: logPolicy,
  notificationPrefs: notificationPrefsPolicy,
  diary: diaryPolicy,
  resources: resourcesPolicy,
  bookings: bookingsPolicy,
};

/** Read filter per collection; returning false hides the row from the user. */
export function canRead(auth: AuthContext, collection: CollectionName, data: any): boolean {
  switch (collection) {
    case 'auditLogs':
      return auth.can('audit.view');
    case 'wires':
      return auth.can('news.view') || auth.can('news.create');
    case 'notifications':
      return !data?.userId || data.userId === auth.user.id || data.userId === 'all';
    case 'notificationPrefs':
      return data?.userId === auth.user.id;
    default:
      return true;
  }
}
