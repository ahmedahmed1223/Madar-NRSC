import { EventEmitter } from 'events';
import {
  APPEND_ONLY_COLLECTIONS,
  COLLECTIONS,
  COLLECTION_NAMES,
  CollectionName,
  EDIT_LOCK_TTL_MS,
  HISTORY_COLLECTIONS,
  LOCKABLE_COLLECTIONS,
  isLockActive,
  lockIdFor,
  ENTITY_ID_PATTERN,
  EntityRow,
  LOG_BOOTSTRAP_LIMIT,
  SINGLETON_ID,
  SyncOp,
  SyncOpResult,
  isCollectionName,
} from '../shared/collections';
import type { AuthContext } from './auth';
import type { NewsroomDatabase } from './db';
import { canRead, POLICIES, WriteKind } from './policy';
import { removeUpload, uploadIdFromMedia } from './uploads';
import { DeptRequest, requestStatusName, requestTypeOf } from '../shared/production';
import { departmentIdOf } from '../shared/departments';
import { onDutyAt, RosterEntry } from '../shared/roster';
import { newId } from '../shared/ids';
import { commentLink, TeamComment } from '../shared/comments';
import { approvalStepName, approvalStepsOf, canActOnStep, findShow, isApprover, nextApprovalStep, storyContentChanged, type ApprovalStep, type StoryApproval } from '../shared/bulletins';
import { evaluatePermission, type RoleDefinition } from '../shared/rbac';
import { statusLabel } from '../shared/labels';
import { localStamp, writeNotification } from './notifications';
import type { NotificationCategory } from '../shared/notifications';
import { bookingConflicts, resourceKindName, type Booking } from '../shared/planning';

export const MAX_OPS_PER_REQUEST = 500;
export const MAX_ENTITY_BYTES = 512 * 1024;
export const MAX_CHANGES_PER_POLL = 5000;

/** Broadcasts the latest revision to connected browsers (SSE). */
export const changeBus = new EventEmitter();
changeBus.setMaxListeners(0);

/** Thrown inside a write transaction to reject one op (the transaction rolls back). */
class SyncReject extends Error {
  constructor(public code: 'FORBIDDEN' | 'INVALID', message: string) {
    super(message);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Requester, department, history and assignee of a request are decided by the server. */
function stampRequest(before: any, after: any, auth: AuthContext) {
  const now = new Date().toISOString();
  const by = { byId: auth.user.id, byName: auth.user.fullName, at: now };
  if (!before) {
    const { assigneeId: _a, assigneeName: _n, resultMediaId: _r, ...rest } = after;
    return {
      ...rest,
      status: 'OPEN',
      priority: after.priority === 'URGENT' ? 'URGENT' : 'NORMAL',
      departmentId: requestTypeOf(after.type)?.departmentId ?? after.departmentId,
      requesterId: auth.user.id,
      requesterName: auth.user.fullName,
      requesterDepartmentId: departmentIdOf(auth.user),
      createdAt: now,
      updatedAt: now,
      history: [{ status: 'OPEN', ...by }],
    };
  }
  const next: any = {
    ...after,
    requesterId: before.requesterId,
    requesterName: before.requesterName,
    requesterDepartmentId: before.requesterDepartmentId,
    departmentId: before.departmentId,
    createdAt: before.createdAt,
    updatedAt: now,
    history: before.history || [],
    assigneeId: before.assigneeId,
    assigneeName: before.assigneeName,
    addressedToId: before.addressedToId,
    addressedToName: before.addressedToName,
  };
  if (after.status !== before.status) {
    next.history = [...next.history, { status: after.status, ...by, note: after.status === 'REJECTED' ? after.resolution : undefined }];
    if (after.status === 'ACCEPTED' && before.status === 'OPEN') {
      next.assigneeId = auth.user.id;
      next.assigneeName = auth.user.fullName;
    }
    if (after.status === 'OPEN') {
      next.assigneeId = undefined;
      next.assigneeName = undefined;
    }
    if ((after.status === 'DONE' || after.status === 'REJECTED') && !next.assigneeId) {
      next.assigneeId = auth.user.id;
      next.assigneeName = auth.user.fullName;
    }
  }
  return next;
}

/** Live timings use server time so every screen counts down from the same moment. */
function stampOnAir(before: any, after: any, auth: AuthContext, episode: any) {
  const now = new Date().toISOString();
  const title = (segmentId: string) => (episode?.rundown || []).find((s: any) => s.id === segmentId)?.title || '';
  const base = {
    id: after.id,
    episodeId: after.episodeId,
    episodeTitle: episode?.title || '',
    programName: episode?.programName || '',
    status: after.status,
    currentSegmentId: after.currentSegmentId,
    operatorId: auth.user.id,
    operatorName: auth.user.fullName,
  };
  const starting = !before || (before.status === 'ENDED' && after.status === 'LIVE');
  if (starting) {
    return { ...base, startedAt: now, segmentStartedAt: now, log: [{ segmentId: after.currentSegmentId, title: title(after.currentSegmentId), startedAt: now }] };
  }
  const log = [...(before.log || [])];
  const closeLast = () => {
    if (log.length && !log[log.length - 1].endedAt) log[log.length - 1] = { ...log[log.length - 1], endedAt: now };
  };
  let segmentStartedAt = before.segmentStartedAt;
  if (before.status === 'LIVE' && after.status === 'LIVE' && after.currentSegmentId !== before.currentSegmentId) {
    closeLast();
    log.push({ segmentId: after.currentSegmentId, title: title(after.currentSegmentId), startedAt: now });
    segmentStartedAt = now;
  }
  let endedAt = before.endedAt;
  if (before.status === 'LIVE' && after.status === 'ENDED') {
    closeLast();
    endedAt = now;
  }
  return { ...base, startedAt: before.startedAt, segmentStartedAt, endedAt, log };
}

/**
 * Server-owned story fields: the writer, and the approval. Editing the copy of an approved
 * story sends it back for approval unless the approver made the edit.
 */
function stampBulletinStory(before: any, after: any, auth: AuthContext, bulletin: any) {
  const now = new Date().toISOString();
  const actor = { id: auth.user.id, canApprove: auth.can('bulletins.approve'), canEdit: auth.can('bulletins.edit'), role: auth.user.role };
  const steps = approvalStepsOf(bulletin);
  // Sign-offs are the server's record: the client never sets them directly.
  let approvals: StoryApproval[] = [...(before?.approvals || [])].filter((a: StoryApproval) => steps.some((s) => s.id === a.stepId));
  let status: string = before ? after.status : after.status === 'APPROVED' ? 'DRAFT' : after.status || 'DRAFT';

  // Changing the copy (by anyone but whoever gives the next sign-off) restarts the chain.
  if (before && ((before.newsUpdatedAt !== after.newsUpdatedAt) || (storyContentChanged(before, after) && !isApprover(bulletin, actor, before)))) {
    approvals = [];
    if (status === 'APPROVED') status = 'READY';
  }
  if (status === 'DRAFT') approvals = [];

  if (status === 'APPROVED' && (before?.status !== 'APPROVED' || nextApprovalStep(bulletin, { approvals }))) {
    const next = nextApprovalStep(bulletin, { approvals });
    if (next && canActOnStep(next, bulletin, actor)) {
      approvals = [...approvals, { stepId: next.id, byId: auth.user.id, byName: auth.user.fullName, at: now }];
      // More sign-offs to come: the story waits (ready) for the next approver.
      if (nextApprovalStep(bulletin, { approvals })) status = 'READY';
    }
    // Otherwise it stays «APPROVED» here so the policy refuses it, naming the pending step.
  }

  const next: any = {
    ...after,
    status,
    approvals,
    writerId: before?.writerId ?? auth.user.id,
    writerName: before?.writerName ?? auth.user.fullName,
    createdAt: before?.createdAt ?? now,
    updatedAt: now,
    approvedById: before?.approvedById,
    approvedByName: before?.approvedByName,
    approvedAt: before?.approvedAt,
  };
  if (status === 'APPROVED' && before?.status !== 'APPROVED') {
    next.approvedById = auth.user.id;
    next.approvedByName = auth.user.fullName;
    next.approvedAt = now;
  }
  if (status !== 'APPROVED') {
    next.approvedById = undefined;
    next.approvedByName = undefined;
    next.approvedAt = undefined;
  }
  if (status !== 'DRAFT') next.returnNote = undefined;
  return next;
}

function stampCue(before: any, after: any, auth: AuthContext) {
  const now = new Date().toISOString();
  if (!before) {
    return {
      ...after,
      message: String(after.message || '').trim(),
      level: ['info', 'standby', 'urgent'].includes(after.level) ? after.level : 'info',
      fromId: auth.user.id,
      fromName: auth.user.fullName,
      createdAt: now,
      acks: [],
    };
  }
  const acks = [...(before.acks || [])];
  if (!acks.some((a: any) => a.userId === auth.user.id)) acks.push({ userId: auth.user.id, userName: auth.user.fullName, at: now });
  return { ...before, acks };
}

/** Server-authoritative fields: clients cannot forge who did what, from where, or when. */
function stamp(collection: CollectionName, data: any, auth: AuthContext, ip: string | undefined) {
  const now = new Date().toISOString();
  if (collection === 'auditLogs') {
    return {
      ...data,
      userId: auth.user.id,
      userName: auth.user.fullName,
      userRole: auth.user.role,
      ipAddress: ip ?? 'unknown',
      timestamp: now,
    };
  }
  if (collection === 'messages') {
    return { ...data, userId: auth.user.id, userName: auth.user.fullName, userRole: auth.user.role, userAvatar: auth.user.avatarUrl, timestamp: now };
  }
  if (collection === 'editLocks') {
    return {
      id: data.id,
      collection: data.collection,
      entityId: data.entityId,
      userId: auth.user.id,
      userName: auth.user.fullName,
      acquiredAt: now,
      expiresAt: new Date(Date.now() + EDIT_LOCK_TTL_MS).toISOString(),
    };
  }
  if (collection === 'broadcastState') {
    return data.liveLock
      ? { ...data, lockedById: auth.user.id, lockedByName: auth.user.fullName, lockedAt: now }
      : { liveLock: false };
  }
  if (collection === 'activityLogs') {
    return {
      ...data,
      userId: auth.user.id,
      userName: auth.user.fullName,
      userRole: auth.user.role,
      userAvatar: auth.user.avatarUrl,
      timestamp: now,
    };
  }
  return data;
}

export class SyncService {
  constructor(private db: NewsroomDatabase, private dataDir: string, private newsActiveDays = 0) {}

  private listData = (c: CollectionName) => this.db.listCollection(c).map((r) => r.d);

  private visible(auth: AuthContext, row: EntityRow): boolean {
    return row.deleted ? true : canRead(auth, row.c, row.d);
  }

  private notify(userId: string, title: string, message: string, linkUrl: string, category: NotificationCategory = 'assignment', urgent = false) {
    writeNotification(this.db, { userId, title, message, linkUrl, category, urgent, type: 'TASK' });
  }

  /** Server-side audit trail for the main records: who created, changed status, deleted or restored what. */
  private auditLifecycle(collection: CollectionName, before: any, after: any, auth: AuthContext, ip?: string) {
    const NAMES: Partial<Record<CollectionName, string>> = {
      news: 'NEWS', stories: 'STORY', programs: 'PROGRAM', episodes: 'EPISODE', bulletins: 'BULLETIN', guests: 'GUEST',
        media: 'MEDIA', tasks: 'TASK', diary: 'DIARY', bookings: 'BOOKING', resources: 'RESOURCE', requests: 'REQUEST', bulletinFormats: 'BULLETIN_FORMAT', settings: 'SETTINGS',
    };
    const entity = NAMES[collection];
    if (!entity || !after) return;
    const title = after.title || after.name || after.fullName || after.slug || after.id;
    let action = '';
    let severity = 'INFO';
    let details = '';
    if (collection === 'settings') {
      const keys = ['organizationName', 'organizationNameEn', 'primaryChannelName', 'defaultTimezone', 'dateTime', 'defaultSegmentDurationSeconds', 'defaultNewsPriority', 'breakingDurationHours', 'newsTemplates'];
      const changes = keys.filter(key => JSON.stringify(before?.[key]) !== JSON.stringify(after[key])).map(key => ({ field: key, before: before?.[key] ?? null, after: after[key] ?? null }));
      if (!changes.length) return;
      [action, details] = ['SETTINGS_UPDATE', JSON.stringify(changes)];
    } else if (!before) [action, details] = ['CREATE', `إنشاء: ${title}`];
    else if (after.deletedAt && !before.deletedAt) [action, severity, details] = ['DELETE', 'WARNING', `نقل إلى المحذوفات: ${title}`];
    else if (!after.deletedAt && before.deletedAt) [action, details] = ['RESTORE', `استعادة: ${title}`];
    else if (before.status !== after.status && after.status) {
      if (collection === 'news' && after.status === 'PUBLISHED') [action, details] = ['PUBLISH', `نشر: ${title}`];
      else if (collection === 'news' && before.status === 'PUBLISHED') [action, severity, details] = ['UNPUBLISH', 'WARNING', `إلغاء نشر: ${title}`];
      else [action, details] = ['STATUS_CHANGE', `${title}: ${statusLabel(before.status)} ← ${statusLabel(after.status)}`];
    } else return;
    const id = newId('aud');
    this.db.writeRow(
      'auditLogs',
      id,
      { id, userId: auth.user.id, userName: auth.user.fullName, userRole: auth.user.role, actionType: action, targetEntity: entity, targetId: after.id, severity, details, ipAddress: ip ?? 'unknown', timestamp: new Date().toISOString() },
      this.db.positionBounds('auditLogs').min - 1,
      null
    );
  }

  /** Who can give this sign-off (for notifications). */
  private approversFor(step: ApprovalStep, bulletin: any): string[] {
    if (step.kind === 'USER') return step.userId ? [step.userId] : [];
    if (step.kind === 'BULLETIN_EDITOR' && bulletin.editorId) return [bulletin.editorId];
    const roles = this.listData('roles') as RoleDefinition[];
    return this.listData('users')
      .filter((u: any) => u.isActive !== false && !u.deletedAt)
      .filter((u: any) => (step.kind === 'ROLE' ? u.role === step.roleCode : evaluatePermission(u, 'bulletins.approve', roles)))
      .map((u: any) => u.id)
      .slice(0, 20);
  }

  /** Whoever gives the next sign-off hears when a story waits for them; the writer hears when it comes back. */
  private notifyBulletinStory(before: any, after: any, auth: AuthContext) {
    const bulletin = this.db.getRow('bulletins', String(after.bulletinId))?.d;
    if (!bulletin) return;
    const link = `/bulletins/${bulletin.id}`;
    const approvalsGrew = (after.approvals?.length || 0) > (before?.approvals?.length || 0);
    if (after.status === 'READY' && (before?.status !== 'READY' || approvalsGrew)) {
      const next = nextApprovalStep(bulletin, after);
      if (next) {
        const progress = approvalsGrew ? ` (اعتمدها ${auth.user.fullName}، بانتظارك الآن)` : '';
        for (const userId of this.approversFor(next, bulletin)) {
          if (userId === auth.user.id) continue;
          this.notify(userId, `قصة بانتظار اعتمادك: ${after.slug}`, `${bulletin.title} — ${approvalStepName(next, bulletin)}${progress}`, link, 'bulletin');
        }
      }
    }
    if (before?.status === after.status) return;
    if (after.status === 'DRAFT' && before?.status && after.writerId && after.writerId !== auth.user.id) {
      this.notify(after.writerId, `أُعيدت قصة للتعديل: ${after.slug}`, `${bulletin.title}${after.returnNote ? ` — ${after.returnNote}` : ''}`, link, 'bulletin');
    }
    if (after.status === 'APPROVED' && after.writerId && after.writerId !== auth.user.id) {
      this.notify(after.writerId, `اعتُمدت قصتك: ${after.slug}`, bulletin.title, link, 'bulletin');
    }
  }

  /** Mentioned colleagues, and the story's author, hear about a new comment. */
  private notifyComment(c: TeamComment, auth: AuthContext) {
    const recipients = new Map<string, string>();
    c.mentions.forEach((id) => recipients.set(id, `${c.authorName} أشار إليك`));
    if (c.target.kind === 'news') {
      const authorId = this.db.getRow('news', c.target.id)?.d?.authorId;
      if (authorId && !recipients.has(authorId)) recipients.set(authorId, `تعليق جديد من ${c.authorName} على خبرك`);
    }
    recipients.delete(auth.user.id);
    const now = new Date().toISOString();
    for (const [userId, title] of recipients) {
      writeNotification(this.db, { userId, title, message: `«${c.target.title}»: ${c.text.slice(0, 140)}`, linkUrl: commentLink(c.target), category: 'mention', type: 'SYSTEM' });
    }
  }

  /** Tells the right people about a request: the target department's on-duty staff, or the requester. */
  private notifyRequest(before: any, after: DeptRequest, auth: AuthContext) {
    const type = requestTypeOf(after.type);
    const recipients = new Set<string>();
    let title = '';
    if (!before && after.addressedToId) {
      recipients.add(after.addressedToId);
      title = `${after.priority === 'URGENT' ? 'عاجل — ' : ''}تكليف ${type?.name || ''} باسمك`;
    } else if (!before) {
      const onDuty = onDutyAt(this.listData('roster') as RosterEntry[], Date.now(), after.departmentId).map((e) => e.userId);
      const members = this.listData('users')
        .filter((u: any) => u.isActive !== false && departmentIdOf(u) === after.departmentId)
        .map((u: any) => u.id);
      (onDuty.length ? onDuty : members).forEach((id) => recipients.add(id));
      title = `${after.priority === 'URGENT' ? 'عاجل — ' : ''}طلب ${type?.name || ''} جديد`;
    } else if (before.status !== after.status) {
      recipients.add(after.requesterId);
      if (after.status === 'CANCELLED' && after.assigneeId) recipients.add(after.assigneeId);
      title = `طلب ${type?.name || ''}: ${requestStatusName(after.status)}`;
    } else {
      return;
    }
    recipients.delete(auth.user.id);
    const now = new Date().toISOString();
    for (const userId of recipients) {
      writeNotification(this.db, {
        userId,
        title,
        message: `${after.title} — ${after.requesterName}${after.link?.title ? ` (${after.link.title})` : ''}`,
        linkUrl: '/requests',
        category: after.addressedToId && !before ? 'assignment' : 'request',
        urgent: after.priority === 'URGENT',
        type: 'TASK',
      });
    }
  }

  /** The writer hears when an editor sends a story back, approves, publishes or rejects it. */
  private notifyNewsWorkflow(before: any, after: any, auth: AuthContext) {
    if (!before || before.status === after.status || !after.authorId || after.authorId === auth.user.id) return;
    const note = [...(after.workflowLogs || [])].reverse().find((l: any) => l.toStatus === after.status)?.comment;
    const titles: Record<string, string> = {
      NEEDS_REVISION: 'أُعيد خبرك للتعديل',
      APPROVED: 'اعتُمد خبرك',
      PUBLISHED: 'نُشر خبرك',
      SCHEDULED: 'جُدول نشر خبرك',
      REJECTED: 'رُفض خبرك',
    };
    const title = titles[after.status];
    if (!title) return;
    writeNotification(this.db, {
      userId: after.authorId,
      title: `${title} — ${auth.user.fullName}`,
      message: `«${after.title}»${note ? `: ${String(note).slice(0, 200)}` : ''}`,
      linkUrl: `/news/${after.id}`,
      category: 'news',
      type: after.status === 'NEEDS_REVISION' || after.status === 'REJECTED' ? 'NEWS_REJECTED' : 'NEWS_APPROVED',
    });
  }

  /** Newly assigned colleagues hear about a diary entry; everyone assigned hears when its time moves. */
  private notifyDiary(before: any, after: any, auth: AuthContext) {
    const prev = new Set<string>(before?.assigneeIds || []);
    const moved = before && (before.date !== after.date || before.startTime !== after.startTime);
    for (const userId of after.assigneeIds || []) {
      if (userId === auth.user.id) continue;
      const isNew = !prev.has(userId);
      if (!isNew && !moved) continue;
      writeNotification(this.db, {
        userId,
        title: isNew ? `تكليف بتغطية: ${after.title}` : `تغيّر موعد: ${after.title}`,
        message: `${after.date}${after.startTime ? ` ${after.startTime}` : ''}${after.location ? ` — ${after.location}` : ''} (${auth.user.fullName})`,
        linkUrl: `/diary/${after.id}`,
        category: 'diary',
        urgent: after.priority === 'HIGH',
      });
    }
  }

  /** The person using a booked resource hears about it (unless they booked it themselves). */
  private notifyBooking(before: any, after: Booking, auth: AuthContext) {
    const who = after.assigneeId;
    if (!who || who === auth.user.id) return;
    const changed = !before || before.assigneeId !== who || before.start !== after.start || before.end !== after.end || before.status !== after.status;
    if (!changed) return;
    const resource = this.db.getRow('resources', after.resourceId)?.d;
    const when = `${localStamp(after.start)}–${localStamp(after.end, false)}`;
    writeNotification(this.db, {
      userId: who,
      title: after.status === 'CANCELLED' ? `أُلغي حجز: ${resource?.name || ''}` : `${before ? 'تعديل حجز' : 'حجز باسمك'}: ${resource?.name || resourceKindName(resource?.kind)}`,
      message: `${after.title} — ${when} (${auth.user.fullName})`,
      linkUrl: `/bookings/${after.id}`,
      category: 'booking',
    });
  }

  bootstrap(auth: AuthContext) {
    const rev = this.db.currentRev();
    const collections: Partial<Record<CollectionName, EntityRow[]>> = {};
    for (const name of COLLECTION_NAMES) {
      let rows: EntityRow[];
      if (APPEND_ONLY_COLLECTIONS.has(name)) {
        // Logs are ordered newest first (lowest position); only ship the recent window.
        rows = this.db.listCollection(name, { limit: LOG_BOOTSTRAP_LIMIT });
      } else if (name === 'news' && this.newsActiveDays > 0) {
        // Old finished news stays on the server (archive search) instead of every browser.
        rows = this.db.listActiveNews(new Date(Date.now() - this.newsActiveDays * 24 * 60 * 60 * 1000).toISOString());
      } else {
        rows = this.db.listCollection(name);
      }
      collections[name] = rows.filter((r) => canRead(auth, name, r.d));
    }
    return { rev, collections };
  }

  changes(auth: AuthContext, since: number) {
    const rev = this.db.currentRev();
    if (since < this.db.tombstoneFloor() || since > rev) return { rev, reset: true as const };
    const { rows, truncated } = this.db.changesSince(since, MAX_CHANGES_PER_POLL);
    if (truncated) return { rev, reset: true as const };
    // Writes are synchronous in this process, so `rev` is consistent with `rows`.
    return {
      rev,
      reset: false as const,
      changes: rows.filter((r) => this.visible(auth, r)),
    };
  }

  /**
   * Apply a batch of writes. Each op is validated and authorized independently and
   * runs in its own transaction; one rejected op never blocks the others.
   */
  apply(auth: AuthContext, ops: SyncOp[], ip?: string): SyncOpResult[] {
    const results = ops.map((op) => this.applyOne(auth, op, ip));
    if (results.some((r) => r.ok)) changeBus.emit('rev', this.db.currentRev());
    return results;
  }

  private applyOne(auth: AuthContext, op: SyncOp, ip?: string): SyncOpResult {
    if (!isPlainObject(op) || !isCollectionName(op.c) || !['upsert', 'delete'].includes(op.op)) {
      return { ok: false, code: 'INVALID', message: 'عملية مزامنة غير صالحة' };
    }
    const collection = op.c;
    const id = COLLECTIONS[collection].kind === 'singleton' ? SINGLETON_ID : op.id;
    if (typeof id !== 'string' || !ENTITY_ID_PATTERN.test(id)) {
      return { ok: false, code: 'INVALID', message: 'معرّف غير صالح' };
    }

    try {
      return this.db.transaction(() => {
        const current = this.db.getRow(collection, id);
        const before = current?.d ?? null;

        // Story locks: nobody else may change or delete a story while its editor holds the lock.
        if (LOCKABLE_COLLECTIONS.has(collection) && current) {
          const lock = this.db.getRow('editLocks', lockIdFor(collection, id))?.d;
          if (isLockActive(lock) && lock.userId !== auth.user.id) {
            return {
              ok: false,
              code: 'CONFLICT',
              message: `${collection === 'episodes' ? 'الحلقة' : collection === 'bulletinStories' ? 'قصة النشرة' : 'الخبر'} قيد التحرير الآن لدى ${lock.userName}، لا يمكن حفظ تغييرات عليها حتى ينتهي`,
              current,
            } as SyncOpResult;
          }
        }

        const liveLocked = !!this.db.getRow('broadcastState', SINGLETON_ID)?.d?.liveLock;
        const lockBlocks = (after: any) =>
          liveLocked && (collection === 'episodes' || collection === 'programs') && (op.op === 'delete' || (after?.deletedAt && !current?.d?.deletedAt));
        if (lockBlocks(op.d)) {
          return { ok: false, code: 'FORBIDDEN', message: 'قفل البث المباشر مفعّل: لا يمكن حذف البرامج أو الحلقات حتى يُرفع القفل', current } as SyncOpResult;
        }

        if (op.op === 'delete') {
          if (!current) return { ok: true, row: { c: collection, id, v: 0, p: 0, deleted: true } } as SyncOpResult;
          const denied = POLICIES[collection]({ auth, collection, kind: 'delete', before, after: null, list: this.listData });
          if (denied) return { ok: false, code: 'FORBIDDEN', message: denied, current } as SyncOpResult;
          if (collection === 'users') {
            this.db.deleteCredentials(id);
            this.db.deleteUserSessions(id);
            this.db.deleteUserPushSubscriptions(id);
          }
          const uploadId = collection === 'media' ? uploadIdFromMedia(before) : null;
          if (uploadId) removeUpload(this.db, this.dataDir, uploadId);
          const row = this.db.deleteRow(collection, id, auth.user.id)!;
          return { ok: true, row } as SyncOpResult;
        }

        if (!isPlainObject(op.d)) return { ok: false, code: 'INVALID', message: 'بيانات غير صالحة' } as SyncOpResult;
        const size = Buffer.byteLength(JSON.stringify(op.d));
        if (size > MAX_ENTITY_BYTES) return { ok: false, code: 'INVALID', message: 'حجم السجل يتجاوز الحد المسموح' } as SyncOpResult;

        const kind: WriteKind = current ? 'update' : 'create';
        if (current && op.baseV !== undefined && op.baseV !== current.v) {
          return {
            ok: false,
            code: 'CONFLICT',
            message: 'تم تعديل هذا السجل من مستخدم آخر، تم تحميل أحدث نسخة',
            current,
          } as SyncOpResult;
        }
        if (current && op.baseV === undefined && !APPEND_ONLY_COLLECTIONS.has(collection)) {
          // Client thought this was new but the id already exists (created elsewhere).
          return { ok: false, code: 'CONFLICT', message: 'السجل موجود مسبقاً', current } as SyncOpResult;
        }

        let after: any = { ...op.d };
        if (COLLECTIONS[collection].kind === 'list') after.id = id;
        after = stamp(collection, after, auth, ip);
        if (collection === 'requests' && !after.deletedAt) {
          after = stampRequest(before, after, auth);
          if (!before && after.addressedToId) {
            // A named colleague must be a real, active member of the receiving department.
            const member = this.db.getRow('users', String(after.addressedToId))?.d;
            if (!member || member.isActive === false || departmentIdOf(member) !== after.departmentId) {
              throw new SyncReject('INVALID', 'الزميل المختار ليس من القسم المنفذ للطلب');
            }
            after = { ...after, addressedToName: member.fullName };
          }
        }
        if (collection === 'onAir') after = stampOnAir(before, after, auth, findShow(String(after.episodeId), this.listData));
        if (collection === 'bulletins' && !after.deletedAt) {
          // The editor's name comes from the directory, never from the client.
          const editor = after.editorId ? this.db.getRow('users', String(after.editorId))?.d : null;
          if (after.editorId && (!editor || editor.isActive === false)) throw new SyncReject('INVALID', 'محرر النشرة غير موجود أو موقوف');
          after = { ...after, editorName: editor?.fullName, createdAt: before?.createdAt ?? after.createdAt ?? new Date().toISOString() };
        }
        if (collection === 'bulletinStories' && !after.deletedAt) {
          const bulletin = this.db.getRow('bulletins', String(after.bulletinId))?.d;
          after = stampBulletinStory(before, after, auth, bulletin);
        }
        if (collection === 'cues') after = stampCue(before, after, auth);
          if (collection === 'tasks') {
            const member = this.db.getRow('users', String(after.assigneeId))?.d;
            after = { ...after, creatorId: before?.creatorId || auth.user.id, creatorName: before?.creatorName || auth.user.fullName, createdAt: before?.createdAt || new Date().toISOString(), assigneeName: member?.fullName || after.assigneeName };
          }
          if (collection === 'reviewThreads') {
            const now = new Date().toISOString();
            after = { ...after, createdById: before?.createdById || auth.user.id, createdAt: before?.createdAt || now,
              resolvedById: after.resolved ? (before?.resolved && before.resolvedById || auth.user.id) : undefined,
              resolvedAt: after.resolved ? (before?.resolved && before.resolvedAt || now) : undefined };
          }
          if (collection === 'comments' && !before && !after.deletedAt) {
          const known = new Set(this.listData('users').filter((u: any) => u.isActive !== false).map((u: any) => u.id));
          after = {
            ...after,
            text: String(after.text).trim(),
            mentions: [...new Set<string>((after.mentions || []).filter((id: string) => known.has(id) && id !== auth.user.id))],
            authorId: auth.user.id,
            authorName: auth.user.fullName,
            createdAt: new Date().toISOString(),
          };
        }
        if (collection === 'roster' && !after.deletedAt) {
          // The person on duty must be a real, active colleague; their name comes from the server.
          const member = this.db.getRow('users', String(after.userId))?.d;
          if (!member || member.isActive === false) {
            return { ok: false, code: 'INVALID', message: 'الموظف غير موجود أو موقوف' } as SyncOpResult;
          }
          after = { ...after, userName: member.fullName, createdBy: before?.createdBy ?? auth.user.id };
        }
        if (collection === 'media') {
          // Ownership decides who may delete a file, so it is set by the server and never changes.
          const owner = kind === 'create'
            ? { id: auth.user.id, name: auth.user.fullName }
            : { id: before?.ownerId ?? before?.uploadedById, name: before?.ownerName ?? before?.uploadedByName };
          after = { ...after, ownerId: owner.id, ownerName: owner.name, uploadedById: owner.id, uploadedByName: owner.name };
        }

        if (collection === 'diary' || collection === 'resources' || collection === 'bookings') {
          const now = new Date().toISOString();
          after = { ...after, createdAt: before?.createdAt ?? now, updatedAt: now };
          if (collection === 'diary') after = { ...after, createdById: before?.createdById ?? auth.user.id, createdByName: before?.createdByName ?? auth.user.fullName };
          if (collection === 'bookings') {
            after = { ...after, bookedById: before?.bookedById ?? auth.user.id, bookedByName: before?.bookedByName ?? auth.user.fullName };
            if (!after.assigneeId) after.assigneeId = after.bookedById;
          }
        }
        if (collection === 'notificationPrefs') after = { ...after, updatedAt: new Date().toISOString() };

        const denied = POLICIES[collection]({ auth, collection, kind, before, after, list: this.listData });
        if (denied) return { ok: false, code: 'FORBIDDEN', message: denied, current } as SyncOpResult;

        if (collection === 'users') {
          // 2FA status is owned by the server (enrolment endpoints), never by the client.
          after.twoFactorEnabled = !!this.db.getCredentials(id)?.totpEnabled;
          const invalid = this.validateUser(id, after);
          if (invalid) return { ok: false, code: 'INVALID', message: invalid, current } as SyncOpResult;
        }

        let position = typeof op.p === 'number' && Number.isFinite(op.p) ? op.p : undefined;
        if (position === undefined) {
          if (current) position = current.p;
          else position = this.db.positionBounds(collection).max + 1;
        }
        if (APPEND_ONLY_COLLECTIONS.has(collection) && !current) {
          // Newest entries first regardless of what the client asked for.
          position = this.db.positionBounds(collection).min - 1;
        }

        if (current && HISTORY_COLLECTIONS.has(collection)) {
          this.db.recordHistory(collection, id, current.v, current.d, auth.user.id, auth.user.fullName);
        }
        if (collection === 'bookings' && !after.deletedAt) {
          // Checked inside the write transaction so two desks cannot book the same slot at once.
          const resource = this.db.getRow('resources', String(after.resourceId))?.d;
          if (!resource || resource.deletedAt) throw new SyncReject('INVALID', 'المورد غير موجود');
          if (resource.isActive === false && (!before || before.resourceId !== after.resourceId)) throw new SyncReject('INVALID', `${resource.name} خارج الخدمة حالياً`);
          const clash = bookingConflicts(after, this.listData('bookings') as Booking[])[0];
          if (clash) {
            throw new SyncReject('INVALID', `${resource.name} محجوز في هذا الوقت: «${clash.title}» (${localStamp(clash.start)}–${localStamp(clash.end, false)}) باسم ${clash.bookedByName || 'زميل'}`);
          }
        }
        if (collection === 'diary' && !after.deletedAt && (after.assigneeIds || []).length) {
          const known = new Set(this.listData('users').filter((u: any) => u.isActive !== false).map((u: any) => u.id));
          if ((after.assigneeIds as string[]).some((uid) => !known.has(uid))) throw new SyncReject('INVALID', 'أحد المكلفين غير موجود أو موقوف');
        }

        const row = this.db.writeRow(collection, id, after, position, auth.user.id);
        if (collection === 'requests' && !after.deletedAt) this.notifyRequest(before, after, auth);
          if (collection === 'tasks' && !after.deletedAt) {
            const assigned = after.assigneeId && after.assigneeId !== before?.assigneeId;
            const deadline = before && after.dueDate !== before.dueDate;
            const status = before && after.status !== before.status && ['BLOCKED', 'IN_REVIEW', 'DONE', 'COMPLETED'].includes(after.status);
            const recipients = new Set<string>();
            if ((assigned || deadline) && after.assigneeId) recipients.add(after.assigneeId);
            if (status && after.creatorId) recipients.add(after.creatorId);
            for (const uid of recipients) if (uid !== auth.user.id) this.notify(uid, assigned ? 'مهمة تحريرية جديدة مسندة إليك' : `تحديث التكليف: ${after.title}`, `${after.title} — ${after.status}`, '/tasks', 'assignment');
          }
        if (collection === 'comments' && !before && !after.deletedAt) this.notifyComment(after, auth);
        if (collection === 'bulletinStories' && !after.deletedAt) this.notifyBulletinStory(before, after, auth);
        this.auditLifecycle(collection, before, after, auth, ip);
        if (collection === 'news' && !after.deletedAt) this.notifyNewsWorkflow(before, after, auth);
        if (collection === 'diary' && !after.deletedAt) this.notifyDiary(before, after, auth);
        if (collection === 'bookings' && !after.deletedAt) this.notifyBooking(before, after, auth);
        if (collection === 'bulletins' && !after.deletedAt && after.editorId && after.editorId !== before?.editorId && after.editorId !== auth.user.id) {
          this.notify(after.editorId, `أنت محرر النشرة: ${after.title}`, `${after.date} ${after.startTime} — تعتمد قصصها قبل الهواء`, `/bulletins/${after.id}`, 'bulletin');
        }
        if (collection === 'onAir') {
          // The episode (or bulletin) follows the live state: on air while live, broadcast once ended.
          const ep = this.db.getRow('episodes', String(after.episodeId));
          const status = after.status === 'LIVE' ? 'ON_AIR' : 'BROADCASTED';
          if (ep && ep.d.status !== status) {
            this.db.writeRow('episodes', ep.id, { ...ep.d, status, updatedAt: new Date().toISOString() }, ep.p, null);
          }
          const bul = this.db.getRow('bulletins', String(after.episodeId));
          const bulStatus = after.status === 'LIVE' ? 'ON_AIR' : 'DONE';
          if (bul && bul.d.status !== bulStatus) {
            this.db.writeRow('bulletins', bul.id, { ...bul.d, status: bulStatus, updatedAt: new Date().toISOString() }, bul.p, null);
          }
        }

        if (collection === 'media') {
          // Only the uploader's own files may be attached, and each upload to a single record.
          const uploadId = uploadIdFromMedia(after);
          if (uploadId && uploadId !== uploadIdFromMedia(before)) {
            const upload = this.db.getUpload(uploadId);
            if (!upload) throw new SyncReject('INVALID', 'الملف المرفوع غير موجود');
            if (upload.uploadedBy !== auth.user.id && !auth.can('media.delete')) throw new SyncReject('FORBIDDEN', 'لا يمكنك إرفاق ملف رفعه مستخدم آخر');
          }
        }

        // Category renames are propagated by the server (system write): the renamer may lack
        // rights on every story, and stories may be locked by their editors.
        if (collection === 'categories' && before && before.nameAr !== after.nameAr) {
          for (const newsRow of this.db.listCollection('news')) {
            if (newsRow.d?.categoryId === id && newsRow.d.categoryName !== after.nameAr) {
              this.db.writeRow('news', newsRow.id, { ...newsRow.d, categoryName: after.nameAr }, newsRow.p, null);
            }
          }
        }

        if (collection === 'users') {
          if (before && before.email !== after.email) this.db.updateCredentialEmail(id, String(after.email).toLowerCase());
          if (after.isActive === false || after.deletedAt) {
            this.db.deleteUserSessions(id);
            this.db.deleteUserPushSubscriptions(id);
          }
        }
        return { ok: true, row } as SyncOpResult;
      });
    } catch (err: any) {
      if (err instanceof SyncReject) return { ok: false, code: err.code, message: err.message, current: this.db.getRow(collection, id) };
      if (String(err?.message).includes('UNIQUE constraint failed: user_credentials.email')) {
        return { ok: false, code: 'INVALID', message: 'البريد الإلكتروني مستخدم لحساب آخر' };
      }
      throw err;
    }
  }

  private validateUser(id: string, user: any): string | null {
    if (typeof user.email !== 'string' || !/^\S+@\S+\.\S+$/.test(user.email)) return 'البريد الإلكتروني غير صالح';
    if (typeof user.fullName !== 'string' || !user.fullName.trim()) return 'اسم المستخدم مطلوب';
    const owner = this.db.findUserIdByEmail(user.email);
    if (owner && owner !== id) return 'البريد الإلكتروني مستخدم لحساب آخر';
    return null;
  }
}
