import { EventEmitter } from 'events';
import { createHash } from 'node:crypto';
import {
  APPEND_ONLY_COLLECTIONS,
  COLLECTIONS,
  COLLECTION_NAMES,
  CollectionName,
  EDIT_LOCK_TTL_MS,
  HISTORY_COLLECTIONS,
  LOCKABLE_COLLECTIONS,
  MERGE_COLLECTIONS,
  MERGE_HISTORY_KEEP,
  isLockActive,
  lockIdFor,
  ENTITY_ID_PATTERN,
  EntityRow,
  LOG_BOOTSTRAP_LIMIT,
  COLLECTION_PAGE_LIMIT,
  PAGED_BOOTSTRAP_COLLECTIONS,
  PAGED_BOOTSTRAP_LIMIT,
  MESSAGE_BOOTSTRAP_LIMIT,
  MESSAGE_BOOTSTRAP_SCAN,
  SINGLETON_ID,
  SyncOp,
  SyncOpResult,
  isCollectionName,
  isPrivateRecord,
} from '../shared/collections';
import { buildAuthContext, type AuthContext } from './auth';
import type { CollectionPagePosition, NewsroomDatabase } from './db';
import { canRead, POLICIES, WriteKind } from './policy';
import { mediaUploadIsTrashed, removeUnreferencedMediaUpload, uploadIdFromMedia } from './uploads';
import { DeptRequest, requestStatusName, requestTypeOf } from '../shared/production';
import { supportTrack } from '../shared/trackSupport';
import { sanitizeWorkSections } from '../shared/workContext';
import { preparePersonalTask } from '../shared/personalTasks';
import { normalizeTaskStatus, stampTaskWorkflow } from '../shared/taskWorkflow';
import { captureBroadcastPlan } from './broadcastArchive';
import { stampBulletinMediaReview } from './bulletinMediaReview';
import { reconcileBulletinStory } from './bulletinStoryVersions';
import { cueBulletinExclusion } from './bulletinLiveExclusions';
import { notifyBulletinSourceCorrections } from './bulletinSourceCorrectionNotices';
import { stampGuestBookingTimes } from '../shared/coverageOverlap';
import { updateWorkReminders } from './workReminders';
import { assignedWorkOnly, taskAssigneeId } from '../shared/assignedWork';
import { departmentTaskIds } from './departmentWork';
import { departmentIdOf, departmentsOf, findDepartmentId } from '../shared/departments';
import { onDutyAt, RosterEntry } from '../shared/roster';
import { newId } from '../shared/ids';
import { commentLink, TeamComment } from '../shared/comments';
import { approvalStepName, approvalStepsOf, canActOnStep, findShow, isApprover, nextApprovalStep, storyContentChanged, type ApprovalStep, type StoryApproval } from '../shared/bulletins';
import { evaluatePermission, type RoleDefinition } from '../shared/rbac';
import { statusLabel } from '../shared/labels';
import { alertForNewsKeywords, localStamp, writeNotification } from './notifications';
import type { NotificationCategory } from '../shared/notifications';
import { bookingConflicts, resourceKindName, type Booking } from '../shared/planning';
import { mergeCardChanges, stepTypesOf } from '../shared/productionCards';
import { publishMessageWorkAttachments, readableActionMessage } from './messageActions';
import { messageActionOrigin } from '../shared/messageActions';
import { recordOneTimeMediaUse } from './mediaUsage';
import { newAutoTranscriptionJob } from './autoMediaTranscription';
import { archiveRemovedStations, managedScopeError, rememberStationSettings, stationGroupsOf, stationsArchiveOf, stationsOf } from '../shared/stations';
import { applyDepartmentSettings, departmentHead } from '../shared/departments';
import { roleAuditEntries, settingsAuditEntries, userAuditEntries, type AuditEntryDraft } from '../shared/auditTrail';
import { mergeCardOutputs } from './cardConsolidation';
import { stampWorkflowPublication } from '../shared/workflowPublication';
import { cardWorkflowAccess, cardWorkflowTrack, workflowAccess } from '../shared/workflowAccess';
import { WORKFLOW_TRACKS } from '../shared/workflowTracks';
import { cardNotices, stampCard, type CardNoticeContext } from './cards';
import { parseChannel, type ChatMessage, type Conversation } from '../shared/chat';
import { prepareDigitalPackage } from '../shared/digitalPublishing';
import { presenterReading } from '../shared/presenterTiming';
import { moduleForLink, moduleForRecord, MODULE_UNAVAILABLE } from '../shared/moduleAccess';
import { moduleAvailability, moduleAllowed, moduleAllowedForUser, moduleAllowsRecord } from './moduleAccess';
import { linkedMediaAsset, linkedMediaIds } from './linkedMedia';
import { matchesQuery } from '../shared/search';
import { episodeGuestList, guestKey } from '../shared/episodePlan';
import { isTrashCollection, type TrashCollection } from '../shared/trash';
import { canRestoreTrashRecord, trashScope } from './trash';

export const MAX_OPS_PER_REQUEST = 500;
export const MAX_ENTITY_BYTES = 512 * 1024;

function decodeCollectionCursor(cursor: string | null): CollectionPagePosition | null | undefined {
  if (cursor === null) return null;
  const separator = cursor.indexOf('~');
  if (separator <= 0 || separator === cursor.length - 1) return undefined;
  const position = Number(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  if (!Number.isFinite(position) || !ENTITY_ID_PATTERN.test(id)) return undefined;
  return { position, id };
}

export function isValidCollectionPageCursor(cursor: string): boolean {
  return decodeCollectionCursor(cursor) !== undefined && cursor.length <= 200;
}

function encodeCollectionCursor(position: CollectionPagePosition): string {
  return `${position.position}~${position.id}`;
}
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
function stampOnAir(before: any, after: any, auth: AuthContext, episode: any) {
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
  next.remoteGuest = after.remoteGuest ? {
    guestId: after.remoteGuest.guestId,
    confirmed: after.remoteGuest.confirmed,
    confirmedAt: after.remoteGuest.confirmed
      ? (before?.remoteGuest?.confirmed && before.remoteGuest.guestId === after.remoteGuest.guestId ? before.remoteGuest.confirmedAt || now : now)
      : undefined,
    check: after.remoteGuest.confirmed && before?.remoteGuest?.confirmed && before.remoteGuest.guestId === after.remoteGuest.guestId ? before.remoteGuest.check : undefined,
  } : undefined;
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

// These rows all carry working content or parent-specific broadcast state.
const PRODUCTION_READ_BOUND = new Set<CollectionName>(['programs', 'episodes', 'bulletins', 'bulletinStories', 'onAir', 'offlineAirSessions']);
const SUPPORT_WRITES = new Set<CollectionName>(['users', 'tasks', 'productionCards', 'notifications', 'notificationPrefs', 'personalNotes', 'personalTasks', 'workspacePrefs']);

export class SyncService {
  constructor(private db: NewsroomDatabase, private dataDir: string, private newsActiveDays = 0, private autoMedia?: { video: boolean }) {}

  private bootstrapRows = { rev: -1, generation: -1, rows: new Map<CollectionName, EntityRow[]>() };
  private listData = (c: CollectionName) => this.db.listCollection(c).map((r) => r.d);
  private lookup = (c: CollectionName, id: string) => this.db.getRow(c, id)?.d;

  private accessRevision(auth: AuthContext): string {
    const legacy = { view: auth.can('cards.view'), manage: auth.can('cards.manage'), work: auth.can('cards.work') };
    const rights = WORKFLOW_TRACKS.map(track => workflowAccess(auth.user, track, legacy));
    const restrictedWorker = rights.some(track => !track.view) && rights.some(track => track.canWork);
    const limited = assignedWorkOnly(auth.can);
    const ownedIds = limited || restrictedWorker ? this.db.assignedWorkIds(auth.user.id) : [];
    const assigned = limited ? ownedIds : [];
    // A named step can reveal just one card from the opposite track. Drop it on re-assignment.
    const sharedCards = restrictedWorker ? ownedIds.filter(key => {
      if (!key.startsWith('productionCards:')) return false;
      const card = this.lookup('productionCards', key.slice('productionCards:'.length));
      return card && !workflowAccess(auth.user, cardWorkflowTrack(card), legacy).view && cardWorkflowAccess(auth.user, card, legacy).view;
    }) : [];
    const team = auth.departmentTaskMembers?.();
    const teamTasks = team ? departmentTaskIds(this.db, auth.user.id, team) : null;
    const access = JSON.stringify([[...auth.permissions].sort(), [...auth.productionAssignments?.() || []].sort(), assigned, teamTasks, moduleAvailability(auth), auth.user.stationId, auth.user.departmentId,
      WORKFLOW_TRACKS.map(track => auth.user.workflowRoles?.[track]), rights, sharedCards, this.lookup('settings', SINGLETON_ID)?.moduleAccess,
      !moduleAllowed(auth, 'media') && auth.can('media.view') ? [...linkedMediaIds(this.db, auth)].sort() : null]);
    return createHash('sha256').update(access).digest('base64url');
  }

  private visible(auth: AuthContext, row: EntityRow): boolean {
    if (row.c === 'media' && !moduleAllowed(auth, 'media')) {
      return row.deleted ? auth.can('media.view') && linkedMediaIds(this.db, auth).has(row.id) : !!linkedMediaAsset(this.db, auth, row.id);
    }
    if (row.c === 'shiftHandovers' || row.c === 'handoverReceipts') return false;
    if (isPrivateRecord(row.c) && row.deleted) return this.db.privateRecordOwner(row.c, row.id) === auth.user.id;
    // A changed assigned-work scope prompts a fresh bootstrap; no hidden IDs travel as tombstones.
    if (row.deleted && assignedWorkOnly(auth.can)) return false;
    if (row.deleted && row.c === 'tasks' && auth.departmentTaskMembers?.()) return false;
    if (row.deleted) {
      const module = moduleForRecord(row.c, row.id, row.d, id => !!this.lookup('episodes', id));
      return !module || moduleAllowed(auth, module, row.d?.stationId);
    }
    return canRead(auth, row.c, row.d, this.lookup);
  }

  private readableRow(auth: AuthContext, row: EntityRow): EntityRow {
    if (row.c === 'settings' && row.d?.moduleAccess && !auth.can('system.settings')) {
      const { moduleAccess: _moduleAccess, ...settings } = row.d;
      return { ...row, d: settings };
    }
    if (row.c !== 'guests' || row.deleted || auth.can('guests.manage')) return row;
    const { phone: _phone, email: _email, notes: _notes, ...profile } = row.d;
    return { ...row, d: profile };
  }

  private canPageCollection(auth: AuthContext, collection: CollectionName): boolean {
    if (collection === 'guests') return auth.can('guests.view') || auth.can('guests.manage');
    if (collection === 'tasks') return moduleAllowed(auth, 'tasks') && (auth.can('tasks.view') || auth.can('tasks.create_assign') || !!auth.departmentTaskMembers?.());
    if (collection === 'episodes') {
      return moduleAllowed(auth, 'programmes') &&
        (auth.can('rundown.view') || auth.can('rundown.edit') || auth.can('episodes.create') || auth.can('episodes.edit') || !!auth.productionAssignments?.().size);
    }
    return false;
  }

  private matchesCollectionSearch(auth: AuthContext, collection: CollectionName, data: any, query: string): boolean {
    if (!query) return true;
    if (data?.deletedAt) return false;
    if (collection === 'guests') return matchesQuery(query, data.fullName, data.organization, data.jobTitle, data.specialty, ...(auth.can('guests.manage') ? [data.email, data.phone] : []));
    if (collection === 'tasks') return matchesQuery(query, data.title, data.description, data.assigneeName, data.assignedToName, data.relatedEntityTitle);
    if (collection === 'episodes') return matchesQuery(query, data.title, data.programName, data.presenterName, data.producerName, data.studioName, String(data.episodeNumber ?? ''));
    return false;
  }

  private nextVisibleExists(auth: AuthContext, collection: CollectionName, cursor: CollectionPagePosition | null): boolean {
    let after = cursor;
    while (true) {
      const rows = this.db.listCollectionPageAfter(collection, after, COLLECTION_PAGE_LIMIT);
      if (!rows.length) return false;
      if (rows.some(row => this.visible(auth, row))) return true;
      const last = rows[rows.length - 1];
      after = { position: last.p, id: last.id };
    }
  }

  private readCollectionPage(auth: AuthContext, collection: CollectionName, cursor: string | null, limit: number, query = '') {
    if (!this.canPageCollection(auth, collection)) {
      return { rows: [] as EntityRow[], cursor: null, hasMore: false };
    }
    const after = decodeCollectionCursor(cursor);
    if (after === undefined) return { rows: [] as EntityRow[], cursor, hasMore: false };
    if (query) {
      const matches = this.db.listCollection(collection)
        .filter(row => this.visible(auth, row) &&
          (!after || row.p > after.position || (row.p === after.position && row.id > after.id)) &&
          this.matchesCollectionSearch(auth, collection, row.d, query));
      const page = matches.slice(0, limit);
      const rows = page.map(row => this.readableRow(auth, row));
      const last = page[page.length - 1];
      const nextCursor = last ? encodeCollectionCursor({ position: last.p, id: last.id }) : cursor;
      return { rows, cursor: nextCursor, hasMore: matches.length > page.length };
    }

    const rows: EntityRow[] = [];
    let scanAfter = after;
    while (rows.length < limit) {
      const batch = this.db.listCollectionPageAfter(collection, scanAfter, COLLECTION_PAGE_LIMIT);
      if (!batch.length) break;
      for (const row of batch) {
        scanAfter = { position: row.p, id: row.id };
        if (!this.visible(auth, row)) continue;
        rows.push(this.readableRow(auth, row));
        if (rows.length === limit) break;
      }
      if (rows.length < limit && batch.length < COLLECTION_PAGE_LIMIT) break;
    }
    const last = rows[rows.length - 1];
    const nextCursor = last ? encodeCollectionCursor({ position: last.p, id: last.id }) : cursor;
    const decodedNext = decodeCollectionCursor(nextCursor);
    return { rows, cursor: nextCursor, hasMore: decodedNext !== undefined && this.nextVisibleExists(auth, collection, decodedNext) };
  }

  private notify(userId: string, title: string, message: string, linkUrl: string, category: NotificationCategory = 'assignment', urgent = false, senderId?: string) {
    const module = moduleForLink(linkUrl);
    if (module && !moduleAllowedForUser(this.db, module, userId)) return;
    writeNotification(this.db, { userId, title, message, linkUrl, category, urgent, type: 'TASK', senderId });
  }

  /** Colleagues as card notices need them: station, role, department and what they may do on cards. */
  private cardPeople(settings: any): CardNoticeContext {
    const roles = this.listData('roles') as RoleDefinition[];
    const departments = departmentsOf(settings);
    const people = this.listData('users')
      .filter((u: any) => u && u.isActive !== false && !u.deletedAt)
      .map((u: any) => ({
        id: u.id,
        stationId: u.stationId,
        managedStationIds: u.managedStationIds,
        managedGroupIds: u.managedGroupIds,
        role: u.role,
        departmentId: findDepartmentId(u, departments),
        canManage: evaluatePermission(u, 'cards.manage', roles, departments),
        canWork: evaluatePermission(u, 'cards.work', roles, departments),
      }));
    return { people, stations: stationsOf(settings) };
  }

  /** A deleted card leaves no unread notices behind: they point at nothing. */
  private settleCardNotifications(cardId: string) {
    const link = `/cards/${cardId}`;
    for (const row of this.db.listCollection('notifications')) {
      if (row.d && row.d.linkUrl === link && !row.d.isRead) this.db.writeRow('notifications', row.id, { ...row.d, isRead: true }, row.p, null);
    }
  }

  /** Server-side audit trail for the main records: who created, changed status, deleted or restored what. */
  private auditLifecycle(collection: CollectionName, before: any, after: any, auth: AuthContext, ip?: string) {
    const NAMES: Partial<Record<CollectionName, string>> = {
      news: 'NEWS', stories: 'STORY', programs: 'PROGRAM', episodes: 'EPISODE', bulletins: 'BULLETIN', guests: 'GUEST',
        media: 'MEDIA', tasks: 'TASK', diary: 'DIARY', bookings: 'BOOKING', resources: 'RESOURCE', requests: 'REQUEST', productionCards: 'PRODUCTION_CARD', bulletinFormats: 'BULLETIN_FORMAT',
    };
    const entity = NAMES[collection];
    if (!entity || !after) return;
    const title = after.title || after.name || after.fullName || after.slug || after.id;
    let action = '';
    let severity = 'INFO';
    let details = '';
    if (!before) [action, details] = ['CREATE', `إنشاء: ${title}`];
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

  private writeAudit(entries: AuditEntryDraft[], auth: AuthContext, ip?: string) {
    for (const entry of entries) {
      const id = newId('aud');
      this.db.writeRow(
        'auditLogs',
        id,
        { id, userId: auth.user.id, userName: auth.user.fullName, userRole: auth.user.role, ...entry, ipAddress: ip ?? 'unknown', timestamp: new Date().toISOString() },
        this.db.positionBounds('auditLogs').min - 1,
        null
      );
    }
  }

  /**
   * Server-side audit of administration: accounts (role, exceptions, suspension, station,
   * department), roles (permissions and screens), settings, stations, departments and the live lock,
   * each with a readable «before ← after». Written after the change was accepted, in the same transaction.
   */
  private auditAdministration(collection: CollectionName, before: any, after: any, auth: AuthContext, ip?: string) {
    const settings = this.db.getRow('settings', SINGLETON_ID)?.d;
    const ctx = () => ({ roles: this.listData('roles') as RoleDefinition[], stations: stationsOf(settings), groups: stationGroupsOf(settings) });
    if (collection === 'users') this.writeAudit(userAuditEntries(before, after, ctx()), auth, ip);
    else if (collection === 'roles') this.writeAudit(roleAuditEntries(before, after), auth, ip);
    else if (collection === 'settings' && after) this.writeAudit(settingsAuditEntries(before, after), auth, ip);
    else if (collection === 'broadcastState' && !!before?.liveLock !== !!after?.liveLock) {
      this.writeAudit([{ actionType: after?.liveLock ? 'BROADCAST_LOCK' : 'BROADCAST_UNLOCK', targetEntity: 'BROADCAST', targetId: 'live-lock', severity: 'WARNING', details: after?.liveLock ? 'تفعيل قفل البث المباشر' : 'رفع قفل البث المباشر' }], auth, ip);
    }
  }

  /** Who can give this sign-off (for notifications). */
  private approversFor(step: ApprovalStep, bulletin: any): string[] {
    if (step.kind === 'USER') return step.userId ? [step.userId] : [];
    if (step.kind === 'BULLETIN_EDITOR' && bulletin.editorId) return [bulletin.editorId];
    const roles = this.listData('roles') as RoleDefinition[];
    return this.listData('users')
      .filter((u: any) => u.isActive !== false && !u.deletedAt)
      .filter((u: any) => (step.kind === 'ROLE' ? u.role === step.roleCode : evaluatePermission(u, 'bulletins.approve', roles, departmentsOf(this.db.getRow('settings', SINGLETON_ID)?.d))))
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

  /**
   * What the server decides about a message: who may read a private one (the two people of a
   * direct conversation, or the group's members at this moment) and the facts of each attached
   * file, which must be an upload of the sender.
   */
  private stampMessage(message: any, auth: AuthContext): ChatMessage {
    const channel = parseChannel(message.channel)!;
    const to =
      channel.kind === 'dm'
        ? channel.userIds
        : channel.kind === 'group'
          ? (this.db.getRow('conversations', channel.id)?.d as Conversation | undefined)?.memberIds
          : undefined;
    const attachments = ((message.attachments as { id: string }[] | undefined) || []).map(({ id }) => {
      const upload = this.db.getUpload(id);
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

  /** People of a private conversation hear about a new message: once per conversation until they read it, and always when it is urgent. */
  private notifyMessage(message: ChatMessage) {
    if (!message.to) return;
    const channel = parseChannel(message.channel)!;
    const linkUrl = `/messages/${encodeURIComponent(message.channel)}`;
    const waiting = new Set(this.listData('notifications').filter((n: any) => n.linkUrl === linkUrl && !n.isRead).map((n: any) => n.userId));
    const group = channel.kind === 'group' ? (this.db.getRow('conversations', channel.id)?.d as Conversation | undefined)?.name : undefined;
    const body = message.text || (message.attachments?.length ? `أرسل ${message.attachments.length === 1 ? 'ملفاً' : 'ملفات'}: ${message.attachments.map((a) => a.name).join('، ')}` : '');
    for (const userId of message.to) {
      if (userId === message.userId || (waiting.has(userId) && !message.isUrgent)) continue;
      this.notify(userId, group ? `${group}: ${message.userName}` : `رسالة من ${message.userName}`, body.slice(0, 200), linkUrl, 'message', message.isUrgent === true, message.userId);
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
    } else if (before && supportTrack(after.type) && before.addressedToId !== after.addressedToId && after.addressedToId) {
      recipients.add(after.addressedToId);
      recipients.add(after.requesterId);
      title = `أُعيد توجيه طلب المساندة إلى ${after.addressedToName}`;
    } else if (!before) {
      const onDuty = onDutyAt(this.listData('roster') as RosterEntry[], Date.now(), after.departmentId).map((e) => e.userId);
      const members = this.listData('users')
        .filter((u: any) => u.isActive !== false && departmentIdOf(u) === after.departmentId)
        .map((u: any) => u.id);
      (onDuty.length ? onDuty : members).forEach((id) => recipients.add(id));
      // The head of the department (or of the department above it) always hears about new requests.
      const head = departmentHead(after.departmentId);
      if (head && this.db.getRow('users', head)?.d?.isActive !== false) recipients.add(head);
      title = `${after.priority === 'URGENT' ? 'عاجل — ' : ''}طلب ${type?.name || ''} جديد`;
    } else if (before.status !== after.status) {
      recipients.add(after.requesterId);
      if (after.status === 'CANCELLED' && after.assigneeId) recipients.add(after.assigneeId);
      title = `طلب ${type?.name || ''}: ${requestStatusName(after.status)}`;
    } else if ((before.proposedDueAt || null) !== (after.proposedDueAt || null)) {
      if (after.proposedDueAt) {
        recipients.add(after.requesterId);
        title = 'اقتراح موعد بديل لتسليم الطلب';
      } else if (before.proposedById) {
        recipients.add(before.proposedById);
        title = after.dueAt === before.proposedDueAt ? 'اعتُمد الموعد البديل للطلب' : 'أُغلق اقتراح الموعد البديل';
      }
    } else {
      return;
    }
    recipients.delete(auth.user.id);
    for (const userId of recipients) {
      writeNotification(this.db, {
        userId,
        title,
        message: `${after.title} — ${after.requesterName}${after.link?.title ? ` (${after.link.title})` : ''}`,
        linkUrl: `/requests/${encodeURIComponent(after.id)}`,
        senderId: auth.user.id,
        category: after.addressedToId && !before ? 'assignment' : 'request',
        urgent: after.priority === 'URGENT',
        type: 'TASK',
      });
    }
  }

  /** The writer hears when an editor sends a story back, approves, publishes or rejects it. */
  private notifyNewsWorkflow(before: any, after: any, auth: AuthContext) {
    // A quality pass reaches the approvers: the story is ready for their decision.
    const passes = (logs: any[] | undefined) => (logs || []).filter((l: any) => l?.action === 'QUALITY_PASSED').length;
    if (before && passes(after.workflowLogs) > passes(before.workflowLogs) && after.status === 'UNDER_REVIEW') {
      const roles = auth.roles;
      for (const row of this.db.listCollection('users')) {
        const u = row.d;
        if (!u || u.id === auth.user.id || u.isActive === false || u.deletedAt || !evaluatePermission(u, 'news.approve', roles, departmentsOf(this.db.getRow('settings', SINGLETON_ID)?.d))) continue;
        writeNotification(this.db, {
          userId: u.id,
          title: `اجتاز التدقيق وينتظر الاعتماد — ${auth.user.fullName}`,
          message: `«${after.title}»`,
          linkUrl: `/news/${after.id}`,
          category: 'news',
        });
      }
    }
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

  /** Departments, station groups and the station archive follow the stored settings (shared helpers read them). */
  private applySettings() {
    const settings = this.db.getRow('settings', SINGLETON_ID)?.d;
    applyDepartmentSettings(settings);
    rememberStationSettings(settings);
  }

  bootstrap(auth: AuthContext) {
    this.applySettings();
    const rev = this.db.currentRev();
    if (this.bootstrapRows.rev !== rev || this.bootstrapRows.generation !== this.db.generation) {
      this.bootstrapRows = { rev, generation: this.db.generation, rows: new Map() };
    }
    const snapshotRows = (name: CollectionName, limit?: number) => {
      let rows = this.bootstrapRows.rows.get(name);
      if (!rows) {
        rows = this.db.listCollection(name, { limit });
        this.bootstrapRows.rows.set(name, rows);
      }
      return rows;
    };
    const collections: Partial<Record<CollectionName, EntityRow[]>> = {};
    const windows: Partial<Record<CollectionName, { cursor: string | null; hasMore: boolean }>> = {};
    for (const name of COLLECTION_NAMES) {
      let rows: EntityRow[];
      if (PAGED_BOOTSTRAP_COLLECTIONS.has(name)) {
        const page = this.readCollectionPage(auth, name, null, PAGED_BOOTSTRAP_LIMIT);
        rows = page.rows;
        windows[name] = { cursor: page.cursor, hasMore: page.hasMore };
      } else if (name === 'messages') {
        // The newest messages this user may read; most rows of a busy newsroom are other people's conversations.
        rows = snapshotRows(name, MESSAGE_BOOTSTRAP_SCAN).filter((r) => canRead(auth, name, r.d)).slice(0, MESSAGE_BOOTSTRAP_LIMIT);
      } else if (isPrivateRecord(name)) {
        rows = this.db.listPrivateRecords(name, auth.user.id);
      } else if (APPEND_ONLY_COLLECTIONS.has(name)) {
        // Logs are ordered newest first (lowest position); only ship the recent window.
        rows = name === 'auditLogs' && !auth.can('audit.view') ? [] : snapshotRows(name, LOG_BOOTSTRAP_LIMIT);
      } else if (name === 'news' && this.newsActiveDays > 0) {
        // Old finished news stays on the server (archive search) instead of every browser.
        rows = this.db.listActiveNews(new Date(Date.now() - this.newsActiveDays * 24 * 60 * 60 * 1000).toISOString());
      } else {
        rows = snapshotRows(name);
      }
      collections[name] = rows.filter((r) => this.visible(auth, r)).map((r) => this.readableRow(auth, r));
    }
    return { rev, access: this.accessRevision(auth), modules: moduleAvailability(auth), collections, windows };
  }

  collectionPage(auth: AuthContext, collection: CollectionName, cursor: string | null, limit = COLLECTION_PAGE_LIMIT, query = '') {
    this.applySettings();
    if (!PAGED_BOOTSTRAP_COLLECTIONS.has(collection)) return null;
    if (!this.canPageCollection(auth, collection)) return null;
    if (cursor !== null && !isValidCollectionPageCursor(cursor)) return null;
    return this.readCollectionPage(auth, collection, cursor, limit, query);
  }

  episodeSummaries(auth: AuthContext) {
    const available = this.canPageCollection(auth, 'episodes');
    const canSummarizePrograms = auth.can('programs.view') || auth.can('programs.manage');
    const canSummarizeGuests = auth.can('guests.view') || auth.can('guests.manage');
    const programCounts: Record<string, number> = Object.create(null);
    const guestSummaries: Record<string, {
      totalAppearances: number;
      lastAppearanceDate?: string;
      appearanceHistory: { episodeId: string; episodeTitle: string; programName: string; date: string }[];
      monthlyAppearanceCounts: Record<string, number>;
    }> = Object.create(null);
    if (!available) return { available, programCounts, guestSummaries };

    const deletedPrograms = new Set(this.db.listCollection('programs')
      .filter(row => row.d?.deletedAt)
      .map(row => row.id));
    for (const row of this.db.listCollection('episodes')) {
      const episode = row.d;
      if (!this.visible(auth, row) || episode?.deletedAt || deletedPrograms.has(episode?.programId)) continue;

      if (canSummarizePrograms && episode.programId) {
        programCounts[episode.programId] = (programCounts[episode.programId] || 0) + 1;
      }

      if (!canSummarizeGuests) continue;
      const guestIds = new Set<string>();
      for (const booking of episodeGuestList(episode)) {
        const id = guestKey(booking);
        if (typeof id === 'string' && id) guestIds.add(id);
      }
      for (const id of guestIds) {
        const summary = guestSummaries[id] || {
          totalAppearances: 0,
          appearanceHistory: [],
          monthlyAppearanceCounts: {},
        };
        const date = typeof episode.broadcastDate === 'string' ? episode.broadcastDate : '';
        summary.totalAppearances += 1;
        if (date) {
          summary.monthlyAppearanceCounts[date.slice(0, 7)] = (summary.monthlyAppearanceCounts[date.slice(0, 7)] || 0) + 1;
          if (!summary.lastAppearanceDate || date > summary.lastAppearanceDate) summary.lastAppearanceDate = date;
        }
        summary.appearanceHistory.push({
          episodeId: row.id,
          episodeTitle: episode.title || '',
          programName: episode.programName || '',
          date,
        });
        guestSummaries[id] = summary;
      }
    }

    for (const summary of Object.values(guestSummaries)) {
      summary.appearanceHistory.sort((a, b) => b.date.localeCompare(a.date) || b.episodeId.localeCompare(a.episodeId));
      summary.appearanceHistory = summary.appearanceHistory.slice(0, 5);
    }
    return { available, programCounts, guestSummaries };
  }

  changes(auth: AuthContext, since: number, knownAccess?: string) {
    const rev = this.db.currentRev();
    if (knownAccess !== undefined && knownAccess !== this.accessRevision(auth)) return { rev, reset: true as const };
    if (since < this.db.tombstoneFloor() || since > rev) return { rev, reset: true as const };
    const { rows, truncated } = this.db.changesSince(since, MAX_CHANGES_PER_POLL);
    if (truncated) return { rev, reset: true as const };
    // Writes are synchronous in this process, so `rev` is consistent with `rows`.
    return {
      rev,
      reset: false as const,
      changes: rows.flatMap((r): EntityRow[] => {
        if (this.visible(auth, r)) return [this.readableRow(auth, r)];
        if (r.c === 'requests' && supportTrack(r.d?.type) && r.d.history?.some((entry: { redirectedFromId?: string }) => entry.redirectedFromId === auth.user.id)) {
          return [{ c: r.c, id: r.id, v: r.v, p: r.p, deleted: true }];
        }
        // Someone removed from a group stops seeing it: their browser is told the row is gone
        // (only its random id travels), instead of keeping a group they can no longer write to.
        return r.c === 'conversations' && !assignedWorkOnly(auth.can) ? [{ c: r.c, id: r.id, v: r.v, p: r.p, deleted: true }] : [];
      }),
    };
  }

  /**
   * Apply a batch of writes. Each op is validated and authorized independently and
   * runs in its own transaction; one rejected op never blocks the others.
   */
  apply(auth: AuthContext, ops: SyncOp[], ip?: string): SyncOpResult[] {
    this.applySettings();
    const results = ops.map((op): SyncOpResult => {
      const result = this.applyOne(auth, op, ip);
      if (result.ok && ['settings', 'roles', 'users'].includes(op.c)) auth = buildAuthContext(this.db, this.db.getRow('users', auth.user.id)?.d || auth.user, auth.sessionId);
      if (result.ok === false && result.current && !this.visible(auth, result.current)) {
        return { ok: false, code: 'FORBIDDEN', message: 'لا يمكن الوصول إلى هذا السجل' };
      }
      if (result.ok === false && result.current) return { ...result, current: this.readableRow(auth, result.current) };
      return result;
    });
    if (ops.some((op) => op?.c === 'settings')) this.applySettings();
    if (results.some((r) => r.ok)) changeBus.emit('rev', this.db.currentRev());
    return results;
  }

  consolidateCards(auth: AuthContext, id: string, choice: Parameters<typeof mergeCardOutputs>[3], ip?: string) {
    this.applySettings();
    mergeCardOutputs(this.db, auth, id, choice, op => this.applyOne(auth, op, ip));
    changeBus.emit('rev', this.db.currentRev());
  }

  createAccount(auth: AuthContext, id: string, profile: Record<string, unknown>, attachCredentials: () => void, ip?: string): SyncOpResult {
    this.applySettings();
    const result = this.db.transaction(() => {
      const created = this.applyOne(auth, { c: 'users', op: 'upsert', id, d: profile }, ip);
      if (created.ok) attachCredentials();
      return created;
    });
    if (result.ok) changeBus.emit('rev', this.db.currentRev());
    return result;
  }

  restoreTrash(auth: AuthContext, collection: TrashCollection, id: string, baseV: number, ip?: string): SyncOpResult {
    this.applySettings();
    const result = this.applyOne(auth, { c: collection, id, op: 'upsert', baseV, d: {} }, ip, true);
    if (result.ok) changeBus.emit('rev', this.db.currentRev());
    return result;
  }

  private applyOne(auth: AuthContext, op: SyncOp, ip?: string, restore = false): SyncOpResult {
    if (!isPlainObject(op) || !isCollectionName(op.c) || !['upsert', 'delete'].includes(op.op)) {
      return { ok: false, code: 'INVALID', message: 'عملية مزامنة غير صالحة' };
    }
    const collection = op.c;
    if (collection === 'newsCorrections') return { ok: false, code: 'FORBIDDEN', message: 'سجل التصحيحات يكتب من الخادم فقط' };
    const id = COLLECTIONS[collection].kind === 'singleton' ? SINGLETON_ID : op.id;
    if (typeof id !== 'string' || !ENTITY_ID_PATTERN.test(id)) {
      return { ok: false, code: 'INVALID', message: 'معرّف غير صالح' };
    }

    try {
      return this.db.transaction(() => {
        if (assignedWorkOnly(auth.can) && !SUPPORT_WRITES.has(collection)) {
          return { ok: false, code: 'FORBIDDEN', message: 'يقتصر هذا الحساب على العمل المسند له' } as SyncOpResult;
        }
        const current = this.db.getRow(collection, id);
        if (collection === 'shiftHandovers' || collection === 'handoverReceipts') return { ok: false, code: 'FORBIDDEN', message: 'استخدم مسار تسليم الوردية المخصص' } as SyncOpResult;
        const before = current?.d ?? null;
        if (collection === 'media' && before?.deletedAt && !restore && op.op === 'upsert') {
          return { ok: false, code: 'FORBIDDEN', message: 'استعد المادة من سلة المحذوفات قبل تعديلها' } as SyncOpResult;
        }
        if (restore) {
          if (!isTrashCollection(collection) || !trashScope(auth).includes(collection)) {
            return { ok: false, code: 'FORBIDDEN', message: 'لا تملك صلاحية الاستعادة من هذا القسم' } as SyncOpResult;
          }
          if (!current || !before?.deletedAt || !canRestoreTrashRecord(auth, collection, before, this.lookup, this.listData)) {
            return { ok: false, code: 'NOT_FOUND', message: 'السجل غير موجود في سلة المحذوفات' } as SyncOpResult;
          }
          if (current.v !== op.baseV) {
            return { ok: false, code: 'CONFLICT', message: 'تغيّر السجل، حدّث سلة المحذوفات ثم حاول مجدداً' } as SyncOpResult;
          }
          op = { ...op, d: { ...before, deletedAt: null } };
        } else if (!current && op.op === 'upsert' && typeof op.baseV === 'number' && op.baseV > 0 && isTrashCollection(collection)) {
          // A stale edit or recovery from the old News tab must not re-create a purged record.
          return { ok: false, code: 'NOT_FOUND', message: 'لم يعد السجل موجوداً' } as SyncOpResult;
        }
        const module = moduleForRecord(collection, id, before, key => !!this.lookup('episodes', key)) ??
          moduleForRecord(collection, id, op.d, key => !!this.lookup('episodes', key));
        if (module && (!moduleAllowsRecord(auth, module, collection, before, this.lookup) ||
          !moduleAllowsRecord(auth, module, collection, op.d, this.lookup))) {
          return { ok: false, code: 'FORBIDDEN', message: MODULE_UNAVAILABLE } as SyncOpResult;
        }
        if (isPrivateRecord(collection)) {
          const owner = this.db.privateRecordOwner(collection, id);
          if ((owner && owner !== auth.user.id) || (collection === 'workspacePrefs' && id !== auth.user.id)) {
            return { ok: false, code: 'FORBIDDEN', message: 'هذا السجل الخاص غير متاح لك' } as SyncOpResult;
          }
          if (current && op.op === 'delete' && op.baseV !== current.v) {
            return { ok: false, code: 'CONFLICT', message: 'تغيّر السجل؛ راجع النسخة الحالية قبل حذفه', current } as SyncOpResult;
          }
          if (owner && !current && op.op === 'upsert' && collection !== 'workspacePrefs') {
            return { ok: false, code: 'CONFLICT', message: 'حُذف هذا السجل؛ أنشئ سجلًا جديدًا' } as SyncOpResult;
          }
        }
        if (current && PRODUCTION_READ_BOUND.has(collection) && !this.visible(auth, current)) {
          return { ok: false, code: 'FORBIDDEN', message: 'هذه المادة الإنتاجية غير متاحة لك' } as SyncOpResult;
        }
        const bulletinBase = collection === 'bulletinStories' && current && op.op === 'upsert' && isPlainObject(op.d) &&
          typeof op.baseV === 'number' && Number.isSafeInteger(op.baseV)
          ? current.v === op.baseV ? current.d : this.db.getHistoryVersion(collection, id, op.baseV) : null;
        const bulletinEdit = bulletinBase && current ? reconcileBulletinStory(bulletinBase, current.d, op.d) : null;
        const rankOnly = !!bulletinEdit?.rankOnly && (op.p === undefined || current?.p === op.p);
        // A move in the running order is independent of the current copy editor's lock.
        if (LOCKABLE_COLLECTIONS.has(collection) && current && !rankOnly) {
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
          const row = this.db.deleteRow(collection, id, auth.user.id)!;
          this.auditAdministration(collection, before, null, auth, ip);
          if (uploadId) removeUnreferencedMediaUpload(this.db, this.dataDir, uploadId);
          return { ok: true, row } as SyncOpResult;
        }

        if (!isPlainObject(op.d)) return { ok: false, code: 'INVALID', message: 'بيانات غير صالحة' } as SyncOpResult;
        const size = Buffer.byteLength(JSON.stringify(op.d));
        if (size > MAX_ENTITY_BYTES) return { ok: false, code: 'INVALID', message: 'حجم السجل يتجاوز الحد المسموح' } as SyncOpResult;

        const kind: WriteKind = current ? 'update' : 'create';
        // A card written from an older version (offline, or while a colleague saved) is merged when
        // the two sides touched different things; the merged card then passes the usual rules.
        let incoming: any = op.d;
        if (current && op.baseV !== undefined && op.baseV !== current.v && MERGE_COLLECTIONS.has(collection)) {
          const base = this.db.getHistoryVersion(collection, id, op.baseV);
          incoming = base ? mergeCardChanges(base, op.d as any, current.d) : null;
        }
        if (collection === 'bulletinStories' && current && current.v !== op.baseV) incoming = bulletinEdit?.data;
        if (current && op.baseV !== undefined && op.baseV !== current.v && !((MERGE_COLLECTIONS.has(collection) || collection === 'bulletinStories') && incoming)) {
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

        let after: any = { ...incoming };
        if (COLLECTIONS[collection].kind === 'list') after.id = id;
        after = stamp(collection, after, auth, ip);
        if (collection === 'users' && before) {
          for (const field of ['workflowRoles', 'workflowDelegations'] as const) {
            if (!Object.hasOwn(after, field) && Object.hasOwn(before, field)) after[field] = before[field];
          }
        }
        if (collection === 'media' && before && after.deletedAt) after.deletedAt = new Date().toISOString();
        const target = collection === 'productionCards' ? after.target : null;
        if (target && (target.kind === 'episode' || target.kind === 'bulletin') &&
            (target.kind !== before?.target?.kind || target.id !== before?.target?.id)) {
          const targetCollection = target.kind === 'episode' ? 'episodes' : 'bulletins';
          const material = typeof target.id === 'string' ? this.lookup(targetCollection, target.id) : null;
          if (!material || material.deletedAt || !canRead(auth, targetCollection, material, this.lookup)) {
            return { ok: false, code: 'FORBIDDEN', message: 'لا تملك صلاحية ربط هذه المادة الإنتاجية' } as SyncOpResult;
          }
        }
        if ((collection === 'bulletinStories' || collection === 'onAir') && !canRead(auth, collection, after, this.lookup)) {
          return { ok: false, code: 'FORBIDDEN', message: 'المادة الإنتاجية المرتبطة غير متاحة لك' } as SyncOpResult;
        }
        if (collection === 'savedNewsFilters') {
          const now = new Date().toISOString();
          after = { ...after, ownerId: auth.user.id, createdAt: before?.createdAt || now, updatedAt: now,
            name: typeof after.name === 'string' ? after.name.trim() : after.name };
        }
        if (collection === 'workspacePrefs') {
          after = { id, ownerId: auth.user.id, workSections: sanitizeWorkSections(after.workSections), updatedAt: new Date().toISOString() };
        }
        if (collection === 'personalNotes') {
          const now = new Date().toISOString();
          after = { id, ownerId: auth.user.id, title: typeof after.title === 'string' ? after.title.trim() : '',
            body: after.body, pinned: after.pinned === true, createdAt: before?.createdAt || now, updatedAt: now };
        }
        if (collection === 'personalTasks') {
          try {
            after = preparePersonalTask(id, auth.user.id, after, before);
          } catch (error) {
            throw new SyncReject('INVALID', error instanceof Error ? error.message : 'المهمة الشخصية غير صالحة');
          }
        }
        if (collection === 'pronunciationTerms') {
          const now = new Date().toISOString();
          after = { id, term: after.term, pronunciation: after.pronunciation, note: after.note, enabled: after.enabled,
            createdBy: before?.createdBy || auth.user.id, createdAt: before?.createdAt || now, updatedBy: auth.user.id, updatedAt: now };
        }
        if (collection === 'requests' && !after.deletedAt) {
          const destination = after.addressedToId;
          after = stampRequest(before, after, auth);
          if (supportTrack(after.type) && (!before || destination !== before.addressedToId)) {
            const member = typeof destination === 'string' ? this.db.getRow('users', destination)?.d : undefined;
            const recipient = member && buildAuthContext(this.db, member, 'support-recipient');
            if (!recipient || !moduleAllowed(recipient, 'requests') || !(recipient.can('requests.view') || recipient.can('requests.manage') || recipient.can('requests.create'))) {
              throw new SyncReject('INVALID', 'المستلم لا يستطيع الوصول إلى طلبات المساندة');
            }
            after = { ...after, addressedToId: member.id, addressedToName: member.fullName };
            if (before) after.history = [...after.history, { status: after.status, byId: auth.user.id, byName: auth.user.fullName, at: after.updatedAt,
              redirectedFromId: before.addressedToId, note: `أُعيد التوجيه إلى ${member.fullName}` }];
          } else if (!before && after.addressedToId) {
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
          after = stampBulletinMediaReview(this.db, before, stampBulletinStory(before, after, auth, bulletin));
        }
        if (collection === 'cues') after = stampCue(before, after, auth);
        if (collection === 'notifications') after = { ...after, senderId: before ? before.senderId : auth.user.id };
          if (collection === 'tasks') {
            const assigneeId = taskAssigneeId(after);
            const member = assigneeId ? this.db.getRow('users', String(assigneeId))?.d : null;
            const status = after.status === 'DONE' ? 'COMPLETED' : after.status;
            const finished = status === 'COMPLETED';
            const now = new Date().toISOString();
            const { assignedToId: _legacyId, assignedToName: _legacyName, ...canonicalTask } = after;
            // Completion time is the server's, so output can be measured per period.
            after = stampTaskWorkflow(before, {
              ...canonicalTask,
              status,
              assigneeId,
              assigneeName: member?.fullName || after.assigneeName || after.assignedToName,
              creatorId: before?.creatorId || auth.user.id,
              creatorName: before?.creatorName || auth.user.fullName,
              createdAt: before?.createdAt || now,
              completedAt: finished ? before?.completedAt || now : undefined,
            }, auth.user.id, now);
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
          if (collection === 'productionPeople') {
            const now = new Date().toISOString();
            after = { ...after, name: typeof after.name === 'string' ? after.name.trim() : after.name, createdAt: before?.createdAt ?? now, updatedAt: now };
          }
          if (collection === 'notificationPrefs') after = { ...after, updatedAt: new Date().toISOString() };
        if (collection === 'users') {
          // Sign-in time is the server's record (set at login), never the browser's: empty until the first sign-in.
          if (before?.lastLogin) after.lastLogin = before.lastLogin;
          else delete after.lastLogin;
        }
        if (collection === 'settings') {
          // Removed stations keep their name in the archive (history of finished work); browsers cannot rewrite it.
          after.stationsArchive = archiveRemovedStations(stationsOf(before), stationsOf(after), stationsArchiveOf(before));
          if (!after.stationsArchive.length) delete after.stationsArchive;
        }

        if (collection === 'news' || collection === 'requests' || collection === 'productionCards') {
          if (before?.messageOrigin) after.messageOrigin = before.messageOrigin;
          else if (after.messageOrigin) {
            const message = readableActionMessage(this.db, auth, after.messageOrigin.messageId);
            if (!message) throw new SyncReject('FORBIDDEN', 'مصدر الرسالة غير متاح');
            after.messageOrigin = messageActionOrigin(message);
          }
        }
        const denied = POLICIES[collection]({ auth, collection, kind, before, after, list: this.listData });
        if (denied) return { ok: false, code: 'FORBIDDEN', message: denied, current } as SyncOpResult;

        if (collection === 'news' && (before?.digitalPackage !== undefined || after.digitalPackage !== undefined)) {
          const prepared = prepareDigitalPackage(before, after, { id: auth.user.id, canApprove: auth.can('news.approve'), now: new Date().toISOString() });
          if (prepared.error) return { ok: false, code: 'FORBIDDEN', message: prepared.error, current } as SyncOpResult;
          after = { ...after, digitalPackage: prepared.value };
        }
        if (collection === 'messages') after = this.stampMessage(after, auth);
        if (collection === 'conversations') {
          const now = new Date().toISOString();
          after = { ...after, name: String(after.name).trim(), ownerId: before?.ownerId || auth.user.id, ownerName: before?.ownerName || auth.user.fullName, createdAt: before?.createdAt || now, updatedAt: now };
        }
        if (collection === 'chatReads') after = { id, userId: auth.user.id, seen: after.seen, updatedAt: new Date().toISOString() };
        if (collection === 'workflowTemplates' && !after.deletedAt) {
          const now = new Date().toISOString();
          after = stampWorkflowPublication(before, { ...after, name: String(after.name).trim(), builtIn: before?.builtIn === true || undefined, createdById: before?.createdById ?? auth.user.id, createdByName: before?.createdByName ?? auth.user.fullName, createdAt: before?.createdAt ?? now, updatedAt: now }, auth.user, now);
        }
        if (collection === 'productionCards' && !after.deletedAt) {
          // Stamped after the policy so the rules compare exactly what the browser sent.
          const users = new Map<string, any>(this.listData('users').map((u: any) => [u.id, u]));
          // Library items attached to a card must exist; their titles go into the trail.
          const mediaTitle = (mediaId: string) => {
            const item = this.db.getRow('media', mediaId)?.d;
            if (item?.privateMessageMedia) return item.ownerId === auth.user.id && !item.deletedAt ? 'مرفق رسالة خاص' : undefined;
            return item && !item.deletedAt ? String(item.title || item.originalName || item.fileName || 'ملف') : undefined;
          };
          const attached = new Set(before?.mediaIds || []);
          if ((after.mediaIds || []).some((mid: string) => !attached.has(mid) && !mediaTitle(mid))) throw new SyncReject('INVALID', 'الملف المرفق غير موجود في مكتبة الوسائط');
          after = stampCard(before, after, auth.user, users, stepTypesOf(this.db.getRow('settings', SINGLETON_ID)?.d), auth.can('cards.manage'), { mediaTitle });
        }
        if (collection === 'users') {
          // 2FA status is owned by the server (enrolment endpoints), never by the client.
          after.twoFactorEnabled = !!this.db.getCredentials(id)?.totpEnabled;
          // A station removed later does not block other edits to its former members.
          const settings = this.db.getRow('settings', SINGLETON_ID)?.d;
          const stationUnknown = after.stationId && after.stationId !== before?.stationId && !stationsOf(settings).some((s) => s.id === after.stationId);
          const scopeChanged = JSON.stringify([after.managedStationIds ?? null, after.managedGroupIds ?? null]) !== JSON.stringify([before?.managedStationIds ?? null, before?.managedGroupIds ?? null]);
          const scopeInvalid = scopeChanged ? managedScopeError(after, stationsOf(settings), stationGroupsOf(settings)) : null;
          const invalid = stationUnknown ? 'المحطة المختارة غير موجودة' : scopeInvalid || this.validateUser(id, after);
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

        if (current && collection === 'settings' && JSON.stringify(before.moduleAccess) !== JSON.stringify(after.moduleAccess)) {
          this.db.recordHistory(collection, id, current.v, { moduleAccess: before.moduleAccess }, auth.user.id, auth.user.fullName, MERGE_HISTORY_KEEP);
        }
        if (current && (HISTORY_COLLECTIONS.has(collection) || collection === 'bulletinStories')) {
          this.db.recordHistory(collection, id, current.v, current.d, auth.user.id, auth.user.fullName);
        }
        if (current && MERGE_COLLECTIONS.has(collection)) {
          this.db.recordHistory(collection, id, current.v, current.d, auth.user.id, auth.user.fullName, MERGE_HISTORY_KEEP);
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

        if (collection === 'episodes' && !after.deletedAt) after = stampGuestBookingTimes(before, after, new Date().toISOString());
        if (collection === 'onAir' && after.status === 'ENDED') {
          after = { ...after, archivedPlan: before?.archivedPlan || captureBroadcastPlan(after.episodeId, this.listData, this.lookup) };
        }
        if (collection === 'media' && kind === 'create' && !after.deletedAt && this.autoMedia) {
          const job = newAutoTranscriptionJob(after, this.autoMedia.video);
          if (job && moduleAllowed(auth, 'transcription', after.stationId)) after.autoTranscriptionJob = job;
        }
        if (collection === 'media') {
          // The uploader or a media administrator may attach a file to the library.
          const uploadId = uploadIdFromMedia(after);
          if (uploadId && uploadId !== uploadIdFromMedia(before)) {
            const upload = this.db.getUpload(uploadId);
            if (!upload || upload.scope === 'chat') throw new SyncReject('INVALID', 'الملف المرفوع غير متاح لمكتبة الوسائط');
            if (upload.uploadedBy !== auth.user.id && !auth.can('media.delete')) throw new SyncReject('FORBIDDEN', 'لا يمكنك إرفاق ملف رفعه مستخدم آخر');
            if (mediaUploadIsTrashed(this.db, uploadId)) throw new SyncReject('FORBIDDEN', 'استعد الملف من سلة المحذوفات قبل ربطه مجدداً');
            if (upload.scope === 'legacy') {
              if (upload.uploadedBy !== auth.user.id) throw new SyncReject('FORBIDDEN', 'الملف القديم متاح لمن رفعه');
              this.db.publishLegacyUpload(uploadId, auth.user.id);
            }
          }
        }
        const row = this.db.writeRow(collection, id, after, position, auth.user.id);
        if (collection === 'news' || collection === 'requests' || collection === 'productionCards') {
          publishMessageWorkAttachments(this.db, collection, id, before, row.d, auth);
        }
        if (collection === 'productionCards' || (collection === 'tasks' && (before?.reminderOptions || after.reminderOptions))) {
          updateWorkReminders(this.db, collection, id, after.deletedAt ? null : row.d);
        }
        if (collection === 'requests' && !after.deletedAt) this.notifyRequest(before, after, auth);
        if (collection === 'productionCards' && !after.deletedAt) {
          const settings = this.db.getRow('settings', SINGLETON_ID)?.d;
          for (const n of cardNotices(before, after, auth.user.id, auth.user.fullName, stepTypesOf(settings), this.cardPeople(settings))) {
            this.notify(n.userId, n.title, n.message, `/cards/${after.id}`, 'assignment', n.urgent, auth.user.id);
          }
        }
        if (collection === 'productionCards' && after.deletedAt && !before?.deletedAt) this.settleCardNotifications(id);
          if (collection === 'tasks' && !after.deletedAt) {
            const assignee = taskAssigneeId(after);
            const assigned = assignee && assignee !== taskAssigneeId(before);
            const deadline = before && after.dueDate !== before.dueDate;
            const nextStatus = normalizeTaskStatus(after.status);
            const status = before && nextStatus !== normalizeTaskStatus(before.status) && ['BLOCKED', 'IN_REVIEW', 'COMPLETED'].includes(nextStatus);
            const recipients = new Set<string>();
            if ((assigned || deadline) && assignee) recipients.add(assignee);
            if (status && after.creatorId) recipients.add(after.creatorId);
            for (const uid of recipients) if (uid !== auth.user.id) this.notify(uid, assigned ? 'مهمة تحريرية جديدة مسندة إليك' : `تحديث التكليف: ${after.title}`, `${after.title} — ${after.status}`, `/tasks/${after.id}`, 'assignment', false, auth.user.id);
          }
        if (collection === 'comments' && !before && !after.deletedAt) this.notifyComment(after, auth);
        if (collection === 'messages' && !before) this.notifyMessage(after);
        if (collection === 'bulletinStories' && !after.deletedAt) {
          this.notifyBulletinStory(before, after, auth);
          cueBulletinExclusion(this.db, before, after, auth.user);
        }
        if (collection === 'bulletinStories' && (!before || ['rank', 'floated', 'killed', 'newsId', 'deletedAt'].some(field => before[field] !== after[field]))) {
          const state = this.lookup('onAir', after.bulletinId);
          if (state?.status === 'LIVE') notifyBulletinSourceCorrections(this.db, state);
        }
        this.auditLifecycle(collection, before, after, auth, ip);
        this.auditAdministration(collection, before, after, auth, ip);
        if (collection === 'news' && !after.deletedAt) {
          this.notifyNewsWorkflow(before, after, auth);
          alertForNewsKeywords(this.db, before, row.d);
        }
        if (collection === 'diary' && !after.deletedAt) this.notifyDiary(before, after, auth);
        if (collection === 'bookings' && !after.deletedAt) this.notifyBooking(before, after, auth);
        if (collection === 'bulletins' && !after.deletedAt && after.editorId && after.editorId !== before?.editorId && after.editorId !== auth.user.id) {
          this.notify(after.editorId, `أنت محرر النشرة: ${after.title}`, `${after.date} ${after.startTime} — تعتمد قصصها قبل الهواء`, `/bulletins/${after.id}`, 'bulletin');
        }
        if (collection === 'onAir') {
          if (after.status === 'LIVE') recordOneTimeMediaUse(this.db, { showId: after.episodeId, startedAt: after.startedAt, segmentId: after.currentSegmentId, recordedAt: after.segmentStartedAt }, auth.user.id);
          // The episode (or bulletin) follows the live state: on air while live, broadcast once ended.
          const ep = this.db.getRow('episodes', String(after.episodeId));
          const status = after.status === 'LIVE' ? 'ON_AIR' : 'BROADCASTED';
          if (ep && ep.d.status !== status) {
            this.db.writeRow('episodes', ep.id, { ...ep.d, status, updatedAt: new Date().toISOString() }, ep.p, null);
          }
          const bul = this.db.getRow('bulletins', String(after.episodeId));
          if (bul && after.status === 'LIVE' && (!before || ['status', 'currentSegmentId', 'operatorId'].some(field => before[field] !== after[field]))) {
            notifyBulletinSourceCorrections(this.db, row.d);
          }
          const bulStatus = after.status === 'LIVE' ? 'ON_AIR' : 'DONE';
          if (bul && bul.d.status !== bulStatus) {
            this.db.writeRow('bulletins', bul.id, { ...bul.d, status: bulStatus, updatedAt: new Date().toISOString() }, bul.p, null);
          }
        }

        // Category renames are propagated by the server (system write): the renamer may lack
        // rights on every story, and stories may be locked by their editors.
        if (collection === 'categories' && before && before.nameAr !== after.nameAr) {
          for (const target of ['news', 'stories'] as const) {
            for (const ref of this.db.listCollection(target)) {
              if (ref.d?.categoryId === id && ref.d.categoryName !== after.nameAr) {
                this.db.writeRow(target, ref.id, { ...ref.d, categoryName: after.nameAr }, ref.p, null);
              }
            }
          }
        }
        // Source renames follow the same rule: news and agency wires carry the name for display.
        if (collection === 'sources' && before && before.name !== after.name && typeof after.name === 'string') {
          for (const target of ['news', 'wires'] as const) {
            for (const ref of this.db.listCollection(target)) {
              if (ref.d?.sourceId === id && ref.d.sourceName !== after.name) {
                this.db.writeRow(target, ref.id, { ...ref.d, sourceName: after.name }, ref.p, null);
              }
            }
          }
        }
        if (collection === 'programTypes' && before && before.nameAr !== after.nameAr && typeof after.nameAr === 'string') {
          for (const ref of this.db.listCollection('programs')) {
            if (ref.d?.typeId === id && ref.d.typeName !== after.nameAr) {
              this.db.writeRow('programs', ref.id, { ...ref.d, typeName: after.nameAr }, ref.p, null);
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
      if (err?.code === 'CREDENTIAL_EMAIL_IN_USE') {
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
