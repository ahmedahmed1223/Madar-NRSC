import { NEWS_KEYWORD_NOTICE_PREFIX, prefsError } from '../shared/notifications';
import { CATEGORY_HAS_CHILDREN, categoryParentError } from '../shared/newsCategories';
import { savedNewsFilterError } from '../shared/savedNewsFilters';
import { guestFollowUpError } from '../shared/guestFollowUp';
import { pronunciationError } from '../shared/pronunciation';
import { normalizeArabic } from '../shared/search';
import { normalizeProductionName, productionPersonError } from '../shared/productionPeople';
import { evaluateBulletinReadiness } from '../shared/bulletinReadiness';
import { firstMediaRightsBlocker, mediaEditorialError, mediaRightsIssue, plannedMediaAirAt, segmentMediaIds } from '../shared/mediaEditorial';
import { reviewThreadError } from '../shared/reviewThreads';
import { bookingError, diaryError, RESOURCE_KINDS } from '../shared/planning';
import { commentError } from '../shared/comments';
import { episodePlanError } from '../shared/episodePlan';
import { episodeReadiness, requestChangeError } from '../shared/production';
import { departmentIdOf, departmentsError, departmentsOf, isDepartmentId, removedDepartmentsInUse } from '../shared/departments';
import { DEFAULT_ROLE_DEFINITIONS } from '../shared/rbac';
import { canControlOnAir, isCueForUser, isPresenterAccount, PRESENTER_INSTRUCTION_MS } from '../shared/onair';
import { bulletinError, findShow, formatError, isApprover, nextApprovalStep, canActOnStep, approvalStepName, plainText, storyError, storyStatusError } from '../shared/bulletins';
import { rosterEntryError } from '../shared/roster';
import type { CollectionName } from '../shared/collections';
import { messageWorkMediaIds, type PrivateMessageMedia } from '../shared/messageActions';
import type { AuthContext } from './auth';
import { videosError } from '../shared/newsVideos';
import { settingsError } from '../shared/settings';
import { canGovernCard, cardChangeError, cardContextOf, GOVERN_DENIED, isStepOpen } from '../shared/productionCards';
import { templateChangeError } from '../shared/workflowTemplates';
import { screensError } from '../shared/screens';
import { canReadMessage, chatReadsError, conversationChangeError, sendError } from '../shared/chat';
import { stationsOf } from '../shared/stations';
import { canEditNewsContent, contentDenial, embargoDenial, isUnderEmbargo, reviewBookkeepingDenial, transitionDenial } from '../shared/newsWorkflow';
import { handledChangeError, manualWireError } from '../shared/wires';
import { PERSONAL_NOTE_BODY_LIMIT, PERSONAL_NOTE_TITLE_LIMIT } from '../shared/personalWorkspace';
import { taskTransitionError } from '../shared/taskWorkflow';
import { assignedWorkOnly, cardAssignedTo, taskAssignedTo } from '../shared/assignedWork';
import { assignmentScope } from '../shared/assignmentScope';
import { workReminderError, workReminderInstant } from '../shared/workReminders';

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

const PRIVILEGED_USER_FIELDS = ['role', 'customRoleId', 'customPermissions', 'isActive', 'departmentId', 'stationId', 'managedStationIds', 'managedGroupIds'] as const;

/** Codes of the built-in roles: a user's `role` is always one of them; custom roles go through `customRoleId`. */
const systemRoleCodes = (roles: any[]) => new Set<string>([...DEFAULT_ROLE_DEFINITIONS.map((r) => r.roleCode), ...roles.filter((r) => r?.isSystemRole).map((r) => r.roleCode)]);

/** The role fields of a user write: `role` must be a system role, `customRoleId` an existing custom role. */
function userRoleError(before: any, after: any, list: PolicyInput['list']): string | null {
  const roles = list?.('roles') || [];
  if ((!before || changed(before, after, 'role')) && !systemRoleCodes(roles).has(after?.role)) return 'الدور غير معروف؛ تُسند الأدوار المخصصة باختيارها من القائمة (customRoleId)';
  if (after?.customRoleId !== undefined && after.customRoleId !== null && after.customRoleId !== '' && (!before || changed(before, after, 'customRoleId'))) {
    const role = roles.find((r: any) => r?.id === after.customRoleId);
    if (!role || role.isSystemRole) return 'الدور المخصص غير موجود';
  }
  return null;
}

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

  // Quality pass, review claim and breaking requests: review rights, checked on their own.
  const bookkeeping = reviewBookkeepingDenial(can, { id: me, name: auth.user.fullName }, kind === 'create' ? null : before, after);
  if (bookkeeping) return bookkeeping;

  if (!!before?.isBreaking !== !!after?.isBreaking && !auth.can('news.breaking_push')) {
    return 'صلاحياتك لا تسمح بإطلاق الأخبار العاجلة أو إيقافها';
  }
  if (changed(before, after, 'videos')) {
    const bad = videosError(after?.videos);
    if (bad) return bad;
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
  // Review bookkeeping (see reviewBookkeepingDenial): reviewers record these without edit rights.
  'qualityCheck',
  'reviewClaim',
  'breakingRequest',
]);

const usersPolicy: Policy = ({ auth, kind, before, after, list }) => {
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
  const roleError = userRoleError(kind === 'create' ? null : before, after, list);
  if (roleError) return roleError;
  if (kind === 'create') {
    if (!auth.can('users.create')) return DENIED;
    const privileged =
      ['ADMIN', 'SUPER_ADMIN'].includes(after?.role) || (after?.customPermissions?.length ?? 0) > 0 || !!after?.customRoleId ||
      (after?.managedStationIds?.length ?? 0) > 0 || (after?.managedGroupIds?.length ?? 0) > 0;
    if (privileged && !auth.can('users.manage_roles_permissions')) return 'منح دور إداري أو مخصص أو صلاحيات مخصصة يتطلب صلاحية إدارة الأدوار';
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
  const badScreens = screensError(after?.screens);
  if (badScreens) return badScreens;
  if (before && (before.isSystemRole !== after?.isSystemRole || (before.isSystemRole && before.roleCode !== after?.roleCode))) {
    return 'لا يمكن تغيير رمز أو صفة دور أساسي';
  }
  if (kind === 'create' && after?.isSystemRole) return 'لا يمكن إنشاء دور أساسي جديد';
  // A code is a role's identity in every user record: never empty, never shared, on create as on update.
  if (kind === 'create' || before?.roleCode !== after?.roleCode) {
    const code = typeof after?.roleCode === 'string' ? after.roleCode : '';
    if (!code.trim()) return 'رمز الدور مطلوب';
    if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) return 'رمز الدور: حروف إنجليزية كبيرة وأرقام وشرطة سفلية (_) فقط';
    const taken = DEFAULT_ROLE_DEFINITIONS.some((r) => r.roleCode === code) || (list?.('roles') || []).some((r) => r.id !== after.id && r.roleCode === code);
    if (taken) return 'يوجد دور بنفس الرمز مسبقاً';
  }
  return null;
};

const episodesPolicy: Policy = ({ auth, kind, before, after, list }) => {
  if (after && !after.deletedAt) {
    const err = episodePlanError(after);
    if (err) return err;
    for (const guest of after.guests || []) {
      const previous = (before?.guests || []).find((g: any) => (g.id || g.guestId) === (guest.id || guest.guestId));
      const followUpError = guestFollowUpError(guest, list?.('users') || [], previous);
      if (followUpError) return followUpError;
    }
    if (changed(before, after, 'rundown')) {
      const media = list?.('media') || [];
      const previous = new Map<string, any>((Array.isArray(before?.rundown) ? before.rundown : []).map((segment: any) => [segment.id, segment]));
      for (const segment of Array.isArray(after.rundown) ? after.rundown : []) {
        if (!segment) continue;
        const old = previous.get(segment.id);
        const priorIds = old ? segmentMediaIds(old, before.id, media) : new Set<string>();
        const airAt = plannedMediaAirAt(after.broadcastDate, after.startTime, list?.('settings')[0]?.defaultTimezone, segment.startTimeOffset);
        const blocker = firstMediaRightsBlocker([...segmentMediaIds(segment, after.id, media)].filter(id => !priorIds.has(id)), media, new Date(), airAt);
        if (blocker) return `لا يمكن إرفاق المادة بالرانداون: ${blocker}`;
      }
    }
  }
  // An episode is only declared ready for air when every department has delivered.
  if (after?.status === 'READY_FOR_BROADCAST' && before?.status !== 'READY_FOR_BROADCAST' && !after?.deletedAt) {
    const readiness = episodeReadiness(after, { requests: list?.('requests') || [], media: list?.('media') || [], timeZone: list?.('settings')[0]?.defaultTimezone });
    if (!readiness.ready) {
      const first = readiness.blockers[0];
      return readiness.total === 0
        ? 'لا يمكن اعتماد حلقة بلا فقرات للبث'
        : `لا يمكن اعتماد الحلقة للبث: ${readiness.blockers.length} عنصر غير جاهز (مثلاً «${first.segmentTitle}»: ${first.detail})`;
    }
  }
  if (kind === 'create') return auth.can('episodes.create') ? null : 'صلاحياتك لا تسمح بإنشاء الحلقات';
  // Deleting (or restoring) an episode is its own permission: preparing or directing one is not enough.
  if (kind === 'delete' || isSoftDelete(before, after)) {
    return auth.can('episodes.delete') ? null : 'حذف الحلقات للمنتج ومدير البرامج (صلاحية «حذف الحلقات»)';
  }
  if (before?.deletedAt && !after?.deletedAt) {
    return auth.can('episodes.delete') ? null : 'صلاحياتك لا تسمح باستعادة الحلقات المحذوفة';
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
  if (after.remoteGuest?.guestId && after.remoteGuest.guestId !== before?.remoteGuest?.guestId &&
      !(list?.('guests') || []).some(guest => guest.id === after.remoteGuest.guestId && !guest.deletedAt)) return 'ضيف النشرة غير موجود';
  if (!actor.canEdit && !approver) return 'صلاحياتك لا تسمح بتعديل قصص النشرة';
  if (before && before.bulletinId !== after.bulletinId) return 'لا يمكن نقل القصة بين النشرات؛ انسخها بدلاً من ذلك';
  if (after.clipMediaId && changed(before, after, 'clipMediaId')) {
    const airAt = plannedMediaAirAt(bulletin.date, bulletin.startTime, list?.('settings')[0]?.defaultTimezone);
    const blocker = firstMediaRightsBlocker([after.clipMediaId], list?.('media') || [], new Date(), airAt);
    if (blocker) return `لا يمكن إرفاق المادة بالرانداون: ${blocker}`;
  }
    const pending = nextApprovalStep(bulletin, before);
    if (before && after.status === 'APPROVED' && pending && !canActOnStep(pending, bulletin, actor)) return `القصة بانتظار اعتماد: ${approvalStepName(pending, bulletin)}`;
  return storyError(after) || storyStatusError(before, after, bulletin, actor);
};

const tasksPolicy: Policy = ({ auth, kind, before, after, list }) => {
  const team = auth.departmentTaskMembers?.();
  const inTeam = (task: any) => team?.has(task?.assigneeId || task?.assignedToId) === true;
  const canManage = team ? (!before || inTeam(before)) && (kind === 'delete' || inTeam(after)) : auth.can('tasks.create_assign');
  if (after && kind !== 'delete') {
    const reminder = workReminderError(after.reminderOptions, Number.isFinite(workReminderInstant(after.dueDate)));
    if (reminder) return reminder;
    const rules = list?.('settings')[0]?.taskWorkflow;
    const transition = taskTransitionError(before, after, rules, canManage);
    if (transition) return transition;
    const assigneeId = after.assigneeId || after.assignedToId;
    if (assigneeId && (before?.assigneeId || before?.assignedToId) !== assigneeId) {
      const scope = assignmentScope(auth.user, list?.('settings')[0]);
      const error = scope.errorFor((list?.('users') || []).find(u => u.id === assigneeId));
      if (error) return error;
    }
    const targets: Record<string, CollectionName> = { NEWS: 'news', EPISODE: 'episodes', PROGRAM: 'programs', BULLETIN: 'bulletins', BULLETIN_STORY: 'bulletinStories' };
    const target = Object.hasOwn(targets, after.relatedEntityType) ? targets[after.relatedEntityType] : undefined;
    if (target && (before?.relatedEntityType !== after.relatedEntityType || before?.relatedEntityId !== after.relatedEntityId)
      && !(list?.(target) || []).some((r: any) => r.id === after.relatedEntityId && !r.deletedAt)) return 'موضع التكليف غير متاح';
  }
  if (canManage) return null;
  // Assignees may progress their own tasks.
  if ((auth.can('tasks.view') || team) && kind === 'update' && taskAssignedTo(before, auth.user.id) && taskAssignedTo(after, auth.user.id) && !isSoftDelete(before, after)) {
    const protectedFields = ['title', 'description', 'assigneeId', 'assignedToId', 'assignedToName', 'dueDate', 'relatedEntityType', 'relatedEntityId', 'relatedEntityTitle', 'priority', 'reminderOptions'];
    return protectedFields.some(key => changed(before, after, key)) ? 'تغيير التكليف لمسؤولي المهام' : null;
  }
  return 'صلاحياتك لا تسمح بإدارة المهام';
};

const mediaPolicy: Policy = ({ auth, kind, before, after }) => {
  if (kind === 'create' && (after.privateMessageMedia || String(after.id).startsWith('msgmedia-'))) return 'يسجل الخادم مراجع مرفقات الرسائل';
  if (kind !== 'delete' && changed(before, after, 'privateMessageMedia')) return 'لا يمكن تغيير مرجع مرفق الرسالة';
  if (before?.privateMessageMedia && before.ownerId !== auth.user.id) return DENIED;
  if (kind !== 'delete' && before?.privateMessageMedia && (changed(before, after, 'url') || changed(before, after, 'fileUrl'))) return 'لا يمكن تغيير مصدر مرفق الرسالة';
  if (kind !== 'delete' && changed(before, after, 'rights') && !(auth.can('news.approve') || auth.can('media.delete'))) return 'تعديل حقوق البث لمن يملك صلاحية الاعتماد أو إدارة الوسائط';
  if (kind !== 'delete' && changed(before, after, 'transcript')) return 'يحفظ الخادم نتيجة التفريغ';
  if (kind !== 'delete' && changed(before, after, 'autoTranscriptionJob')) return 'يجدول الخادم التفريغ التلقائي';
  if (kind !== 'delete' && changed(before, after, 'broadcastUse')) return 'يسجل الخادم استخدام التصاريح لمرة واحدة';
  if (kind === 'delete' || isSoftDelete(before, after)) {
    const isOwner = [before?.ownerId, before?.uploadedById].includes(auth.user.id);
    return auth.can('media.delete') || (isOwner && auth.can('media.upload')) ? null : 'صلاحياتك لا تسمح بحذف الوسائط';
  }
  if (!auth.can('media.upload')) return 'صلاحياتك لا تسمح برفع الوسائط';
  // Approving a video for air (or withdrawing that approval) is an editorial decision.
  const approvalChanged = (before?.videoStatus === 'APPROVED') !== (after?.videoStatus === 'APPROVED');
  if (approvalChanged && !(auth.can('news.approve') || auth.can('media.delete'))) return 'اعتماد الفيديو للبث لمن يملك صلاحية الاعتماد';
  if (before?.rights && !(auth.can('news.approve') || auth.can('media.delete')) &&
    (changed(before, after, 'url') || changed(before, after, 'fileUrl'))) return 'تغيير مصدر مادة تحمل حقوق بث لمن يملك صلاحية الاعتماد أو إدارة الوسائط';
  return mediaEditorialError(after);
};

const notificationsPolicy: Policy = ({ auth, kind, before, after }) => {
  if (before?.category === 'news-keyword') {
    if (before.userId !== auth.user.id) return DENIED;
    if (kind === 'delete') return null;
    const allowed = new Set(['isRead', 'deletedAt']);
    return Object.keys({ ...before, ...after }).some(key => !allowed.has(key) && changed(before, after, key)) ? DENIED : null;
  }
  if (after?.category === 'news-keyword' || after?.id?.startsWith(NEWS_KEYWORD_NOTICE_PREFIX)) return DENIED;
  if (assignedWorkOnly(auth.can)) {
    if (kind === 'create' || before?.userId !== auth.user.id) return DENIED;
    if (kind === 'delete') return null;
    const allowed = new Set(['isRead', 'deletedAt']);
    return Object.keys({ ...before, ...after }).some(key => !allowed.has(key) && changed(before, after, key)) ? DENIED : null;
  }
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

const categoryReferences = referencedPolicy('categoryId', 'القسم');
const categoryPolicy: Policy = (input) => {
  const denial = categoryReferences(input);
  if (denial) return denial;
  const { before, after, kind, list } = input;
  if (kind === 'delete' || isSoftDelete(before, after)) {
    return list?.('categories').some(category => !category.deletedAt && category.parentId === before?.id) ? CATEGORY_HAS_CHILDREN : null;
  }
  if (after?.deletedAt || after?.parentId == null) return null;
  return categoryParentError(after, (list?.('categories') || []).filter(category => !category.deletedAt));
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

const activeUserIds = (list: PolicyInput['list']) => new Set<string>((list?.('users') || []).filter((u: any) => u.isActive !== false && !u.deletedAt).map((u: any) => u.id));

/** Logs are append-only: identity fields are stamped by the server, edits are rejected. */
const logPolicy: Policy = ({ kind }) => (kind === 'create' ? null : 'السجلات غير قابلة للتعديل أو الحذف');

/** The audit trail is written by the server alone (sync.ts, app.ts): a browser cannot add, edit or remove entries. */
const auditLogPolicy: Policy = () => 'سجل التدقيق يكتبه الخادم وحده';

/**
 * Shared settings: validation, plus the parts that would orphan records — a station still holding
 * colleagues or open card steps is removed through «حذف المحطة» (which moves them), and a
 * department still in use is archived, not deleted.
 */
const settingsPolicy: Policy = (input) => {
  const base = require('system.settings')(input);
  if (base) return base;
  const { kind, before, after, list } = input;
  if (kind === 'delete') return 'لا يمكن حذف إعدادات النظام';
  const invalid = settingsError(after);
  if (invalid) return invalid;
  const users = (list?.('users') || []).filter((u: any) => u && !u.deletedAt);
  const removedStations = stationsOf(before).filter((s) => !stationsOf(after).some((x) => x.id === s.id));
  for (const station of removedStations) {
    const members = users.filter((u: any) => u.stationId === station.id).length;
    const openSteps = (list?.('productionCards') || [])
      .filter((c: any) => c && !c.deletedAt && c.status === 'OPEN')
      .reduce((n: number, c: any) => n + (c.steps || []).filter((st: any) => st.stationId === station.id && isStepOpen(st)).length, 0);
    if (members || openSteps) return `في محطة «${station.name}» ${members} من الزملاء و${openSteps} مهمة مفتوحة؛ احذفها من الإعدادات مع اختيار محطة بديلة تنتقل إليها`;
  }
  const userIds = users.map((u: any) => u.id);
  const departmentsInvalid = after?.departments !== undefined ? departmentsError(after.departments, { stationIds: stationsOf(after).map((s) => s.id), userIds }) : null;
  if (departmentsInvalid) return departmentsInvalid;
  const usage = (id: string) =>
    users.filter((u: any) => departmentIdOf(u) === id).length +
    (list?.('roster') || []).filter((r: any) => r && !r.deletedAt && r.departmentId === id).length +
    (list?.('requests') || []).filter((r: any) => r && !r.deletedAt && r.departmentId === id && !['DONE', 'REJECTED', 'CANCELLED'].includes(r.status)).length;
  const inUse = removedDepartmentsInUse(departmentsOf(before), departmentsOf(after), usage)[0];
  if (inUse) return `القسم «${inUse.name}» مستخدم (${inUse.uses})؛ أرشفه بدلاً من حذفه`;
  return null;
};

export const POLICIES: Record<CollectionName, Policy> = {
  shiftHandovers: () => 'تسليم الوردية يستخدم المسار المخصص فقط',
  handoverReceipts: () => 'الاستلام يستخدم المسار المخصص فقط',
  workspacePrefs: ({ auth, before, after }) => (after || before)?.id === auth.user.id ? null : DENIED,
  personalNotes: ({ auth, kind, before, after }) => {
    if ((before && before.ownerId !== auth.user.id) || (after && after.ownerId !== auth.user.id)) return DENIED;
    if (kind === 'delete') return null;
    if (typeof after?.title !== 'string' || !after.title || after.title.length > PERSONAL_NOTE_TITLE_LIMIT ||
        typeof after.body !== 'string' || after.body.length > PERSONAL_NOTE_BODY_LIMIT) return 'عنوان الملاحظة أو نصها غير صالح';
    return null;
  },
  personalTasks: ({ auth, before, after }) =>
    (before && before.ownerId !== auth.user.id) || (after && after.ownerId !== auth.user.id) ? DENIED : null,
  users: usersPolicy,
  roles: rolesPolicy,
  news: newsPolicy,
  newsCorrections: () => 'سجل التصحيحات يكتب من الخادم فقط ولا يمكن تعديله أو حذفه',
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
  categories: categoryPolicy,
  productionPeople: ({ auth, kind, before, after, list }) => {
    if (!auth.can('system.settings')) return DENIED;
    if (kind === 'delete' || after?.deletedAt) return 'عطّل الاسم بدلاً من حذفه';
    const invalid = productionPersonError(after);
    if (invalid) return invalid;
    if (before && before.id !== after.id) return 'لا يمكن تغيير معرف الاسم';
    const name = normalizeProductionName(after.name);
    if (list?.('productionPeople').some(p => p.id !== after.id && normalizeProductionName(p.name) === name)) return 'الاسم موجود بالفعل في قوائم الإنتاج';
    return null;
  },
  sources: referencedPolicy('sourceId', 'المصدر'),
  pronunciationTerms: ({ auth, kind, after, list }) => {
    if (!auth.can('system.settings')) return DENIED;
    if (kind === 'delete') return null;
    const invalid = pronunciationError(after);
    if (invalid) return invalid;
    const other = (list?.('pronunciationTerms') || []).filter(p => p.id !== after.id && p.enabled && !p.deletedAt);
    if (after.enabled && other.some(p => normalizeArabic(p.term) === normalizeArabic(after.term))) return 'الاسم موجود بالفعل في قاموس النطق';
    if (after.enabled && other.length >= 2000) return 'الحد الأقصى 2000 اسم مفعّل';
    return null;
  },
  programTypes: (input) => {
    const base = require('system.settings')(input);
    if (base) return base;
    const { kind, before, after, list } = input;
    if (!before || !(kind === 'delete' || isSoftDelete(before, after))) return null;
    // A type still used by a programme cannot go (its programmes would lose their type).
    const inUse = (list?.('programs') || []).filter((p: any) => !p.deletedAt && p.typeId === before.id).length;
    return inUse ? `لا يمكن حذف نوع البرنامج لأن ${inUse} من البرامج تستخدمه؛ غيّر نوعها أولاً` : null;
  },
  settings: settingsPolicy,
  notifications: notificationsPolicy,
  broadcastState: require('rundown.lock_override'),
  reviewThreads: ({ auth, kind, before, after, list }) => {
    if (kind === 'delete' || after?.deletedAt) return 'لا تحذف مراجعات النص';
    const invalid = reviewThreadError(after);
    if (invalid) return invalid;
    const target = (list?.(after.collection) || []).find((r: any) => r.id === after.entityId && !r.deletedAt);
    if (!target) return 'النص المستهدف غير موجود';
    const news = after.collection === 'news';
    if (news && !auth.can('news.view')) return DENIED;
    const canPost = news ? (auth.can('news.review') || auth.can('news.edit_any') || canEditNewsContent(p => auth.can(p), auth.user.id, target)) : (auth.can('bulletins.edit') || auth.can('bulletins.approve'));
    if (!canPost) return DENIED;
    if (!before) {
      if (after.baseVersion !== target.updatedAt || !plainText(target[after.field] || '').includes(after.quote)) return 'احفظ النص الحالي أولاً ثم أضف المراجعة على نسخته المحفوظة';
      return after.resolved ? 'تبدأ المراجعة مفتوحة' : null;
    }
    const keys = ['collection', 'entityId', 'field', 'baseVersion', 'quote', 'contextBefore', 'contextAfter', 'createdById', 'createdAt'];
    if (keys.some(key => changed(before, after, key))) return 'موضع المراجعة لا يعدل بعد إنشائه';
    const canResolve = news ? (auth.can('news.review') || auth.can('news.edit_any')) : auth.can('bulletins.approve');
    const ownsMaterial = (news ? target.authorId : target.writerId) === auth.user.id;
    return !ownsMaterial && (canResolve || before.createdById === auth.user.id) ? null : 'إغلاق المراجعة لمراجعها أو المحرر المسؤول غير كاتب المادة';
  },
  comments: ({ auth, kind, before, after, list }) => {
    if (kind === 'delete' || isSoftDelete(before, after)) {
      return before?.authorId === auth.user.id || auth.can('system.settings') ? null : 'يحذف التعليق كاتبه فقط';
    }
    if (kind !== 'create') return 'التعليقات لا تُعدَّل بعد نشرها';
    if (after.threadId) {
      const thread = (list?.('reviewThreads') || []).find((t: any) => t.id === after.threadId);
      if (!thread || thread.entityId !== after.target?.id || after.target?.kind !== (thread.collection === 'news' ? 'news' : 'bulletinStory')) return 'المراجعة والرد لا يخصان النص نفسه';
      const target = (list?.(thread.collection) || []).find((r: any) => r.id === thread.entityId && !r.deletedAt);
      if (!target) return 'النص المستهدف غير موجود';
      const news = thread.collection === 'news';
      if (news && !auth.can('news.view')) return DENIED;
      const allowed = news ? (auth.can('news.review') || auth.can('news.edit_any') || canEditNewsContent(p => auth.can(p), auth.user.id, target)) : (auth.can('bulletins.edit') || auth.can('bulletins.approve'));
      if (!allowed) return DENIED;
    } else if (!auth.can('news.view')) return DENIED;
    return commentError(after);
  },
  bulletins: bulletinsPolicy,
  bulletinStories: bulletinStoriesPolicy,
  bulletinFormats: (input) => require('bulletins.manage')(input) || (input.after && !input.after.deletedAt ? formatError(input.after) : null),
  onAir: ({ auth, kind, before, after, list }) => {
    if (!canControlOnAir(auth.user, auth.can)) return 'تشغيل وضع الهواء للمخرج والكنترول فقط';
    if (kind === 'delete') return auth.can('onair.control') ? null : DENIED;
    if (!['LIVE', 'ENDED'].includes(after?.status)) return 'حالة البث غير صالحة';
    const episode = findShow(String(after?.episodeId), (c) => list?.(c) || []);
    if (!episode || after?.id !== episode.id) return 'الحلقة أو النشرة غير موجودة';
    if (!(episode.rundown || []).some((seg: any) => seg.id === after.currentSegmentId)) return 'الفقرة ليست ضمن رانداون البث';
    if (after.status === 'LIVE') {
      const session = before?.status === 'LIVE' ? { showId: episode.id, startedAt: after.startedAt } : undefined;
      const bulletin = (list?.('bulletins') || []).find((b: any) => b.id === after.episodeId);
      if (bulletin) {
        const starting = before?.status !== 'LIVE';
        const stories = (list?.('bulletinStories') || []).filter((s: any) =>
          s.bulletinId === bulletin.id && (starting || s.id === after.currentSegmentId));
        const blocker = evaluateBulletinReadiness(bulletin, stories, list?.('news') || [], list?.('media') || [], new Date(), list?.('settings')[0]?.defaultTimezone, session).find(i => i.severity === 'blocker');
        if (blocker) return `${starting ? 'النشرة غير جاهزة للبث' : 'الفقرة غير جاهزة للبث'}: ${blocker.message}`;
        if (starting && episode.rundown[0]?.id !== after.currentSegmentId) {
          return 'تغيّر ترتيب النشرة. أعد المحاولة بعد مزامنة ترتيب الفقرات.';
        }
      } else {
        const media = list?.('media') || [];
        const requests = list?.('requests') || [];
        const segments = before?.status !== 'LIVE' ? episode.rundown : episode.rundown.filter(segment => segment.id === after.currentSegmentId);
        for (const segment of segments) {
          const airAt = plannedMediaAirAt(episode.broadcastDate, episode.startTime, list?.('settings')[0]?.defaultTimezone, segment.startTimeOffset);
          const blocker = firstMediaRightsBlocker(segmentMediaIds(segment, episode.id, media, requests), media, new Date(), airAt, session);
          if (blocker) return `حقوق مواد الفقرة «${segment.title}» تمنع البث: ${blocker}`;
        }
      }
    }
    return null;
  },
  cues: ({ auth, kind, before, after, list }) => {
    if (kind === 'create') {
      if (!canControlOnAir(auth.user, auth.can) && !auth.can('tasks.intercom_broadcast')) return 'إرسال تنبيهات الهواء للمخرج والكنترول';
      if (typeof after?.message !== 'string' || !after.message.trim() || after.message.length > 300) return 'نص التنبيه غير صالح';
      if (!Array.isArray(after?.targetDepartmentIds) || !after.targetDepartmentIds.every(isDepartmentId)) return 'القسم المستهدف غير معروف';
      if (after.expiresAt !== undefined || after.targetUserId !== undefined) {
        if (after.message.length > 120) return 'اكتب توجيهاً لا يتجاوز 120 حرفاً';
        const ttl = Date.parse(after.expiresAt) - Date.now();
        if (!(ttl > 0 && ttl <= PRESENTER_INSTRUCTION_MS + 5000)) return 'انتهت مهلة إرسال التوجيه. أرسله مجدداً عند عودة الاتصال.';
        if (!after.episodeId || !findShow(after.episodeId, (c) => list?.(c) || [])) return 'التوجيه غير مرتبط بحلقة أو نشرة';
        const expected = after.targetUserId === undefined ? ['studio', 'presenters'] : ['studio'];
        if (after.targetDepartmentIds.length !== expected.length || expected.some(id => !after.targetDepartmentIds.includes(id))) return 'وجهة التوجيه غير صالحة';
        if (after.targetUserId !== undefined && !(list?.('users') || []).some(user => user.id === after.targetUserId && !user.deletedAt && user.isActive !== false && isPresenterAccount(user))) return 'حساب المذيع المحدد غير متاح';
      }
      return null;
    }
    if (kind === 'delete') return auth.can('onair.control') ? null : DENIED;
    if (!before || !isCueForUser(before, auth.user)) return DENIED;
    // Recipients may only acknowledge (the server records who and when).
    const { acks: _a, ...restBefore } = before || {};
    const { acks: _b, ...restAfter } = after || {};
    return JSON.stringify(restBefore) === JSON.stringify(restAfter) ? null : 'التنبيه لا يُعدَّل بعد إرساله';
  },
  requests: ({ auth, kind, before, after, list }) => {
    const canManage = auth.can('requests.manage');
    if (kind === 'delete' || isSoftDelete(before, after)) {
      return canManage || (before?.requesterId === auth.user.id && before?.status === 'OPEN') ? null : 'لا يمكنك حذف هذا الطلب';
    }
    if (kind === 'create' && !auth.can('requests.create')) return 'صلاحياتك لا تسمح بإرسال طلبات للأقسام';
    const denied = requestChangeError(before, after, { id: auth.user.id, departmentId: departmentIdOf(auth.user), canManage });
    if (denied) return denied;
    if (after.sourceMediaIds?.length && changed(before, after, 'sourceMediaIds')) {
      if (!any(auth, 'media.view', 'media.upload')) return 'ربط مصادر المونتاج يتطلب الوصول إلى مكتبة الوسائط';
      const existing = new Set(before?.sourceMediaIds || []);
      const media = list?.('media') || [];
      if (after.sourceMediaIds.some((id: string) => !existing.has(id) && !media.some(asset => asset.id === id && !asset.deletedAt && ['VIDEO', 'AUDIO'].includes(asset.mediaType) && (!asset.privateMessageMedia || asset.ownerId === auth.user.id)))) return 'ملف مصدر المونتاج غير متاح في مكتبة الوسائط';
    }
    const resultId = after.resultMediaId;
    const completingWithResult = after.status === 'DONE' && (before?.status !== 'DONE' || changed(before, after, 'resultMediaId'));
    if (completingWithResult && resultId != null && resultId !== '' &&
      (typeof resultId !== 'string' || !list?.('media').some(asset => asset.id === resultId && !asset.deletedAt))) {
      return 'مادة التسليم غير متاحة.';
    }
    if (completingWithResult && after.type === 'MONTAGE' && after.link?.segmentId && resultId) {
      const episode = (list?.('episodes') || []).find(item => item.id === after.link.episodeId && !item.deletedAt);
      const segment = episode?.rundown?.find((item: any) => item.id === after.link.segmentId);
      const airAt = plannedMediaAirAt(episode?.broadcastDate, episode?.startTime, list?.('settings')[0]?.defaultTimezone, segment?.startTimeOffset);
      const issue = mediaRightsIssue((list?.('media') || []).find(asset => asset.id === resultId), new Date(), airAt);
      if (issue) return `لا يمكن تسليم المادة إلى الرانداون: ${issue}`;
    }
    return null;
  },
  roster: ({ auth, kind, after }) => {
    if (!auth.can('roster.manage')) return 'صلاحياتك لا تسمح بتعديل جدول المناوبات';
    if (kind === 'delete') return null;
    if (after?.deletedAt) return null;
    return rosterEntryError(after);
  },
  // Agency items come from the feeds; the desk adds manual observations and marks what it followed up.
  wires: ({ auth, kind, before, after }) => {
    if (!auth.can('news.view') && !auth.can('news.create')) return DENIED;
    if (kind === 'delete' || isSoftDelete(before, after)) {
      return before?.manual && (before.createdById === auth.user.id || auth.can('system.settings')) ? null : 'مواد الوكالات لا تُحذف يدوياً؛ يحذف مادة الرصد كاتبها';
    }
    if (kind === 'create') {
      if (!auth.can('news.create')) return 'إضافة رصد يدوي لمن يكتب الأخبار';
      if (after?.createdById !== auth.user.id || after?.createdByName !== auth.user.fullName) return 'بيانات كاتب الرصد غير صالحة';
      return manualWireError(after);
    }
    return handledChangeError(before, after, auth.user.id);
  },
  offlineAirSessions: () => 'السجل المحلي يستورد عبر المسار المخصص ولا يعدل أو يحذف',
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
  chatPins: () => DENIED,
  messages: ({ auth, kind, after, list }) => {
    if (kind !== 'create') return 'الرسائل غير قابلة للتعديل أو الحذف';
    return sendError(after, auth.user.id, {
      users: activeUserIds(list),
      stations: new Set(stationsOf(list?.('settings')[0]).map((s) => s.id)),
      conversations: list?.('conversations') || [],
    });
  },
  conversations: ({ auth, kind, before, after, list }) => {
    if (kind === 'delete' || isSoftDelete(before, after)) return before?.ownerId === auth.user.id ? null : 'يحذف المجموعة منشئها';
    return conversationChangeError(before, after, auth.user.id, auth.can('messages.groups'), activeUserIds(list));
  },
  chatReads: ({ auth, kind, before, after }) => (kind === 'delete' ? (before?.userId === auth.user.id ? null : DENIED) : chatReadsError(after, auth.user.id)),
  activityLogs: logPolicy,
  auditLogs: auditLogPolicy,
  notificationPrefs: notificationPrefsPolicy,
  savedNewsFilters: ({ auth, kind, before, after, list }) => {
    if (before && before.ownerId !== auth.user.id) return DENIED;
    if (kind === 'delete') return null;
    if (after?.ownerId !== auth.user.id) return DENIED;
    const error = savedNewsFilterError(after);
    if (error) return error;
    if (kind === 'create' && (list?.('savedNewsFilters') || []).filter(row => row.ownerId === auth.user.id).length >= 30) return 'يمكن حفظ 30 فلترًا كحد أقصى؛ احذف فلترًا قبل إضافة آخر';
    return null;
  },
  diary: diaryPolicy,
  resources: resourcesPolicy,
  bookings: bookingsPolicy,
  productionCards: ({ auth, kind, before, after, list }) => {
    const canManage = auth.can('cards.manage');
    if (assignedWorkOnly(auth.can)) {
      if (!cardAssignedTo(before, auth.user.id)) return 'يمكنك التعامل مع التكليفات المسندة إليك فقط';
      if (Array.isArray(after?.steps) && before?.steps?.some((step: any) => step.assigneeId !== auth.user.id &&
          JSON.stringify(step) !== JSON.stringify(after.steps.find((candidate: any) => candidate?.id === step.id)))) {
        return 'لا يمكنك تغيير خطوة مسندة إلى زميل آخر';
      }
    }
    const actor = { id: auth.user.id, stationId: auth.user.stationId, managedStationIds: auth.user.managedStationIds, managedGroupIds: auth.user.managedGroupIds, role: auth.user.role, departmentId: departmentIdOf(auth.user), canManage, canWork: auth.can('cards.work') };
    const settings = list?.('settings')[0];
    const users = list?.('users') || [];
    const ctx = cardContextOf(settings, users);
    if (kind === 'delete' || isSoftDelete(before, after) || before?.deletedAt) {
      if (!canManage) return 'حذف التكليفات واستعادتها لمسؤولي التكليف';
      // A branch deletes or restores only the cards it governs (its own and those of the branches it follows).
      if (before && !canGovernCard(before, actor, ctx.stations)) return GOVERN_DENIED;
      if (kind === 'delete') return null;
    }
    const error = cardChangeError(before, after, actor, ctx);
    if (error) return error;
    const scope = assignmentScope(auth.user, settings);
    const recipients = new Set<string>();
    if (after.ownerId && after.ownerId !== before?.ownerId) recipients.add(after.ownerId);
    const previous = new Map<string, { assigneeId?: string; stationId?: string }>((before?.steps || []).map(step => [step.id, step]));
    for (const step of after.steps) {
      const prior = previous.get(step.id);
      if (step.assigneeId && step.assigneeId !== prior?.assigneeId) recipients.add(step.assigneeId);
      if (!step.assigneeId && step.stationId && step.stationId !== prior?.stationId && !scope.stations.has(step.stationId)) {
        return 'محطة التكليف خارج نطاق المحطات التي تديرها أو ترتبط بها';
      }
    }
    for (const id of recipients) {
      const denied = scope.errorFor(users.find(u => u.id === id));
      if (denied) return denied;
    }
    return null;
  },
  workflowTemplates: ({ auth, kind, before, after }) => {
    if (kind === 'delete') return auth.can('cards.manage') ? null : 'قوالب سير العمل لمسؤولي التكليف';
    return templateChangeError(before, after, auth.can('cards.manage'));
  },
};

const SUPPORT_COLLECTIONS = new Set<CollectionName>(['roles', 'users', 'settings', 'tasks', 'productionCards',
  'notifications', 'notificationPrefs', 'personalNotes', 'personalTasks', 'workspacePrefs']);

/** Read filter per collection; returning false hides the row from the user. */
export function canRead(auth: AuthContext, collection: CollectionName, data: any, lookup?: (collection: CollectionName, id: string) => any): boolean {
  if (assignedWorkOnly(auth.can)) {
    if (!SUPPORT_COLLECTIONS.has(collection)) return false;
    if (collection === 'users') return data?.id === auth.user.id;
    if (collection === 'tasks') return auth.can('tasks.view') && taskAssignedTo(data, auth.user.id);
    if (collection === 'productionCards') return auth.can('cards.view') && cardAssignedTo(data, auth.user.id);
  }
  const parentVisible = (parent: CollectionName, id: unknown) => {
    const target = typeof id === 'string' && lookup?.(parent, id);
    return !!target && canRead(auth, parent, target, lookup);
  };
  const delegated = (kind: string, id: unknown) => typeof id === 'string' && !!auth.productionAssignments?.().has(`${kind}:${id}`);
  const showVisible = (id: unknown) => parentVisible('episodes', id) || parentVisible('bulletins', id);
  switch (collection) {
    case 'shiftHandovers':
    case 'handoverReceipts': return false;
    case 'savedNewsFilters':
    case 'workspacePrefs':
    case 'personalNotes':
    case 'personalTasks':
      return data?.ownerId === auth.user.id;
    case 'news':
      return auth.can('news.view');
    case 'stories':
    case 'breaking':
      return auth.can('news.view');
    case 'programs':
      return any(auth, 'programs.view', 'programs.manage');
    case 'episodes':
      return any(auth, 'rundown.view', 'rundown.edit', 'episodes.create', 'episodes.edit') || delegated('episode', data?.id);
    case 'bulletins':
      return any(auth, 'rundown.view', 'bulletins.edit', 'bulletins.manage', 'bulletins.approve') || delegated('bulletin', data?.id);
    case 'bulletinFormats':
      return any(auth, 'rundown.view', 'bulletins.edit', 'bulletins.manage', 'bulletins.approve');
    case 'bulletinStories':
      return parentVisible('bulletins', data?.bulletinId);
    case 'onAir':
    case 'offlineAirSessions':
      return showVisible(data?.episodeId || data?.showId || data?.id);
    case 'cues':
      return !data?.expiresAt || data.fromId === auth.user.id || isCueForUser(data, auth.user);
    case 'guests':
      return any(auth, 'guests.view', 'guests.manage');
    case 'media': {
      if (!any(auth, 'media.view', 'media.upload')) return false;
      const reference: PrivateMessageMedia | undefined = data?.privateMessageMedia;
      if (!reference) return true;
      const message = lookup?.('messages', reference.messageId);
      if (message?.deletedAt || !message?.attachments?.some((attachment: { id: string }) => attachment.id === reference.uploadId)) return false;
      if (data.ownerId === auth.user.id && canReadMessage(message, auth.user.id)) return true;
      if (!reference.work || !auth.can('media.view')) return false;
      const { collection, id } = reference.work;
      const work = lookup?.(collection, id);
      if (!work || work.deletedAt || work.messageOrigin?.messageId !== reference.messageId || !messageWorkMediaIds(collection, work).includes(data.id)) return false;
      if (collection === 'requests') {
        return auth.can('requests.manage') || any(auth, 'requests.view', 'requests.create') &&
          (work.departmentId === departmentIdOf(auth.user) || work.requesterId === auth.user.id);
      }
      return canRead(auth, collection, work, lookup);
    }
    case 'tasks': {
      const team = auth.departmentTaskMembers?.();
      return team ? team.has(data?.assigneeId || data?.assignedToId) || taskAssignedTo(data, auth.user.id) : auth.can('tasks.view') || auth.can('tasks.create_assign');
    }
    case 'newsCorrections':
      const news = typeof data?.newsId === 'string' ? lookup?.('news', data.newsId) : null;
      return !!news && !news.deletedAt && auth.can('news.view') && canRead(auth, 'news', news);
    case 'pronunciationTerms':
      return any(auth, 'system.settings', 'news.view', 'episodes.view', 'rundown.presenter_teleprompter', 'bulletins.view');
    case 'reviewThreads':
      return data?.collection === 'news' ? auth.can('news.view') : parentVisible('bulletinStories', data?.entityId);
    case 'comments':
      return !data?.threadId || parentVisible('reviewThreads', data.threadId);
    case 'auditLogs':
      return auth.can('audit.view');
    case 'wires':
      return auth.can('news.view') || auth.can('news.create');
    case 'notifications':
      if (data?.category === 'news-keyword') return data.userId === auth.user.id && auth.can('news.view') && !assignedWorkOnly(auth.can);
      return !data?.userId || data.userId === auth.user.id || data.userId === 'all';
    case 'notificationPrefs':
      return data?.userId === auth.user.id;
    case 'productionCards':
    case 'workflowTemplates':
      return auth.can('cards.view');
    case 'messages':
      return canReadMessage(data, auth.user.id);
    case 'conversations':
      return Array.isArray(data?.memberIds) && data.memberIds.includes(auth.user.id);
    case 'chatReads':
      return data?.userId === auth.user.id;
    default:
      return true;
  }
}
