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
import { findShow, isApprover, storyContentChanged } from '../shared/bulletins';

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
  const actor = { id: auth.user.id, canApprove: auth.can('bulletins.approve'), canEdit: auth.can('bulletins.edit') };
  const next: any = {
    ...after,
    writerId: before?.writerId ?? auth.user.id,
    writerName: before?.writerName ?? auth.user.fullName,
    createdAt: before?.createdAt ?? now,
    updatedAt: now,
    status: before ? after.status : after.status === 'APPROVED' && !isApprover(bulletin, actor) ? 'DRAFT' : after.status || 'DRAFT',
    approvedById: before?.approvedById,
    approvedByName: before?.approvedByName,
    approvedAt: before?.approvedAt,
  };
  if (before?.status === 'APPROVED' && next.status === 'APPROVED' && storyContentChanged(before, after) && !isApprover(bulletin, actor)) {
    next.status = 'READY';
  }
  if (next.status === 'APPROVED' && before?.status !== 'APPROVED') {
    next.approvedById = auth.user.id;
    next.approvedByName = auth.user.fullName;
    next.approvedAt = now;
  }
  if (next.status !== 'APPROVED') {
    next.approvedById = undefined;
    next.approvedByName = undefined;
    next.approvedAt = undefined;
  }
  if (next.status !== 'DRAFT') next.returnNote = undefined;
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

  private notify(userId: string, title: string, message: string, linkUrl: string) {
    const id = newId('notif');
    this.db.writeRow(
      'notifications',
      id,
      { id, userId, title, message, type: 'TASK', linkUrl, isRead: false, createdAt: new Date().toISOString() },
      this.db.positionBounds('notifications').min - 1,
      null
    );
  }

  /** The bulletin editor hears when a story is ready; the writer hears when it comes back. */
  private notifyBulletinStory(before: any, after: any, auth: AuthContext) {
    if (before?.status === after.status) return;
    const bulletin = this.db.getRow('bulletins', String(after.bulletinId))?.d;
    if (!bulletin) return;
    const link = `/bulletins/${bulletin.id}`;
    if (after.status === 'READY' && bulletin.editorId && bulletin.editorId !== auth.user.id) {
      this.notify(bulletin.editorId, `قصة جاهزة للاعتماد: ${after.slug}`, `${bulletin.title} — ${after.writerName || auth.user.fullName}`, link);
    }
    if (after.status === 'DRAFT' && before?.status && after.writerId && after.writerId !== auth.user.id) {
      this.notify(after.writerId, `أُعيدت قصة للتعديل: ${after.slug}`, `${bulletin.title}${after.returnNote ? ` — ${after.returnNote}` : ''}`, link);
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
      const id = newId('notif');
      this.db.writeRow(
        'notifications',
        id,
        { id, userId, title, message: `«${c.target.title}»: ${c.text.slice(0, 140)}`, type: 'SYSTEM', linkUrl: commentLink(c.target), isRead: false, createdAt: now },
        this.db.positionBounds('notifications').min - 1,
        null
      );
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
      const id = newId('notif');
      this.db.writeRow(
        'notifications',
        id,
        {
          id,
          userId,
          title,
          message: `${after.title} — ${after.requesterName}${after.link?.title ? ` (${after.link.title})` : ''}`,
          type: 'TASK',
          linkUrl: '/requests',
          isRead: false,
          createdAt: now,
        },
        this.db.positionBounds('notifications').min - 1,
        null
      );
    }
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
        const row = this.db.writeRow(collection, id, after, position, auth.user.id);
        if (collection === 'requests' && !after.deletedAt) this.notifyRequest(before, after, auth);
        if (collection === 'comments' && !before && !after.deletedAt) this.notifyComment(after, auth);
        if (collection === 'bulletinStories' && !after.deletedAt) this.notifyBulletinStory(before, after, auth);
        if (collection === 'bulletins' && !after.deletedAt && after.editorId && after.editorId !== before?.editorId && after.editorId !== auth.user.id) {
          this.notify(after.editorId, `أنت محرر النشرة: ${after.title}`, `${after.date} ${after.startTime} — تعتمد قصصها قبل الهواء`, '/bulletins');
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
          if (after.isActive === false || after.deletedAt) this.db.deleteUserSessions(id);
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
