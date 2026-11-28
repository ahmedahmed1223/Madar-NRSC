import {
  CollectionName,
  EDIT_LOCK_TTL_MS,
} from '../shared/collections';
import type { AuthContext } from './auth';
import type { NewsroomDatabase } from './db';
import { requestTypeOf } from '../shared/production';
import { departmentIdOf } from '../shared/departments';
import {
  approvalStepsOf,
  canActOnStep,
  isApprover,
  nextApprovalStep,
  storyContentChanged,
  type StoryApproval,
} from '../shared/bulletins';
import { localStamp } from './notifications';
import { parseChannel, type ChatMessage, type Conversation } from '../shared/chat';
import { presenterReading } from '../shared/presenterTiming';

/** Thrown inside a write transaction to reject one op (the transaction rolls back). */
export class SyncReject extends Error {
  constructor(public code: 'FORBIDDEN' | 'INVALID', message: string) {
    super(message);
  }
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Requester, department, history and assignee of a request are decided by the server. */
export function stampRequest(before: any, after: any, auth: AuthContext) {
  const now = new Date().toISOString();
  const by = { byId: auth.user.id, byName: auth.user.fullName, at: now };
  if (!before) {
    const { assigneeId: _a, assigneeName: _n, resultMediaId: _r, proposedById: _proposer, proposedDueAt: _proposal, ...rest } = after;
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
    proposedById: before.proposedById,
  };
  if (after.proposedDueAt !== before.proposedDueAt) {
    next.proposedById = after.proposedDueAt ? auth.user.id : undefined;
    const note = after.proposedDueAt ? `اقتُرح موعد بديل: ${localStamp(after.proposedDueAt)}` : after.dueAt !== before.dueAt ? 'اعتُمد الموعد البديل' : 'رُفض الموعد البديل';
    next.history = [...next.history, { status: after.status, ...by, note }];
  }
  if (['DONE', 'REJECTED', 'CANCELLED'].includes(after.status) || (after.dueAt !== before.dueAt && after.proposedDueAt)) {
    next.proposedDueAt = undefined;
    next.proposedById = undefined;
  }
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
export function stampOnAir(before: any, after: any, auth: AuthContext, episode: any) {
  const now = new Date().toISOString();
  const startEntry = (segmentId: string) => {
    const segment = (episode?.rundown || []).find((s: any) => s.id === segmentId);
    return { segmentId, title: segment?.title || '', startedAt: now, reading: presenterReading(segment, episode?.presenterName) };
  };
  const base = {
    id: after.id,
    episodeId: after.episodeId,
    episodeTitle: episode?.title || '',
    programName: episode?.programName || '',
    status: after.status,
    currentSegmentId: after.currentSegmentId,
    operatorId: auth.user.id,
    operatorName: auth.user.fullName,
    ...(before?.correctionRequests?.length ? { correctionRequests: before.correctionRequests } : {}),
  };
  const starting = !before || (before.status === 'ENDED' && after.status === 'LIVE');
  if (starting) {
    return { ...base, startedAt: now, segmentStartedAt: now, log: [startEntry(after.currentSegmentId)] };
  }
  const log = [...(before.log || [])];
  const closeLast = () => {
    if (log.length && !log[log.length - 1].endedAt) log[log.length - 1] = { ...log[log.length - 1], endedAt: now };
  };
  let segmentStartedAt = before.segmentStartedAt;
  if (before.status === 'LIVE' && after.status === 'LIVE' && after.currentSegmentId !== before.currentSegmentId) {
    closeLast();
    log.push(startEntry(after.currentSegmentId));
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
export function stampBulletinStory(before: any, after: any, auth: AuthContext, bulletin: any) {
  const now = new Date().toISOString();
  const actor = { id: auth.user.id, canApprove: auth.can('bulletins.approve'), canEdit: auth.can('bulletins.edit'), role: auth.user.role };
  const steps = approvalStepsOf(bulletin);
  // Sign-offs are the server's record: the client never sets them directly.
  let approvals: StoryApproval[] = [...(before?.approvals || [])].filter((a: StoryApproval) => steps.some((s) => s.id === a.stepId));
  let status: string = before ? after.status : after.status === 'APPROVED' ? 'DRAFT' : after.status || 'DRAFT';

  // Changing the copy (by anyone but whoever gives the next sign-off) restarts the chain.
  if (before && (before.newsUpdatedAt !== after.newsUpdatedAt || (storyContentChanged(before, after) && !isApprover(bulletin, actor, before)))) {
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
  next.remoteGuest = after.remoteGuest
    ? {
        guestId: after.remoteGuest.guestId,
        confirmed: after.remoteGuest.confirmed,
        confirmedAt: after.remoteGuest.confirmed
          ? before?.remoteGuest?.confirmed && before.remoteGuest.guestId === after.remoteGuest.guestId
            ? before.remoteGuest.confirmedAt || now
            : now
          : undefined,
        check: after.remoteGuest.confirmed && before?.remoteGuest?.confirmed && before.remoteGuest.guestId === after.remoteGuest.guestId ? before.remoteGuest.check : undefined,
      }
    : undefined;
  return next;
}

export function stampCue(before: any, after: any, auth: AuthContext) {
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
export function stamp(collection: CollectionName, data: any, auth: AuthContext, ip: string | undefined) {
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

/**
 * What the server decides about a message: who may read a private one (the two people of a
 * direct conversation, or the group's members at this moment) and the facts of each attached
 * file, which must be an upload of the sender.
 */
export function stampMessage(db: NewsroomDatabase, message: any, auth: AuthContext): ChatMessage {
  const channel = parseChannel(message.channel)!;
  const to =
    channel.kind === 'dm'
      ? channel.userIds
      : channel.kind === 'group'
        ? (db.getRow('conversations', channel.id)?.d as Conversation | undefined)?.memberIds
        : undefined;
  const attachments = ((message.attachments as { id: string }[] | undefined) || []).map(({ id }) => {
    const upload = db.getUpload(id);
    if (!upload || upload.uploadedBy !== auth.user.id) throw new SyncReject('INVALID', 'المرفق غير موجود أو ليس من رفعك');
    return { id, name: upload.originalName, mimeType: upload.mimeType, size: upload.sizeBytes };
  });
  const { attachments: _a, to: _t, ref, ...rest } = message;
  return {
    ...rest,
    text: String(message.text).trim(),
    isUrgent: message.isUrgent === true || undefined,
    ...(attachments.length ? { attachments } : {}),
    ...(ref ? { ref: { kind: ref.kind, id: ref.id, title: String(ref.title).trim() } } : {}),
    ...(to ? { to: [...to] } : {}),
  };
}

/**
 * Propagates renames of reference records (categories, sources, programTypes) as system writes
 * inside the same transaction, bypassing per-story permissions and edit locks.
 */
export function propagateReferenceRename(
  db: NewsroomDatabase,
  collection: CollectionName,
  id: string,
  before: any,
  after: any
): void {
  if (collection === 'categories' && before && before.nameAr !== after.nameAr) {
    for (const target of ['news', 'stories'] as const) {
      for (const ref of db.listByJsonField(target, 'categoryId', id)) {
        if (ref.d?.categoryName !== after.nameAr) {
          db.writeRow(target, ref.id, { ...ref.d, categoryName: after.nameAr }, ref.p, null);
        }
      }
    }
  }
  if (collection === 'sources' && before && before.name !== after.name && typeof after.name === 'string') {
    for (const target of ['news', 'wires'] as const) {
      for (const ref of db.listByJsonField(target, 'sourceId', id)) {
        if (ref.d?.sourceName !== after.name) {
          db.writeRow(target, ref.id, { ...ref.d, sourceName: after.name }, ref.p, null);
        }
      }
    }
  }
  if (collection === 'programTypes' && before && before.nameAr !== after.nameAr && typeof after.nameAr === 'string') {
    for (const ref of db.listByJsonField('programs', 'typeId', id)) {
      if (ref.d?.typeName !== after.nameAr) {
        db.writeRow('programs', ref.id, { ...ref.d, typeName: after.nameAr }, ref.p, null);
      }
    }
  }
}
