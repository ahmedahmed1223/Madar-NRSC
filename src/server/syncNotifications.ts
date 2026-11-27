import { CollectionName, SINGLETON_ID } from '../shared/collections';
import type { AuthContext } from './auth';
import type { NewsroomDatabase } from './db';
import { DeptRequest, requestStatusName, requestTypeOf } from '../shared/production';
import { supportTrack } from '../shared/trackSupport';
import { departmentHead, departmentIdOf, departmentsOf, findDepartmentId } from '../shared/departments';
import { onDutyAt, RosterEntry } from '../shared/roster';
import { commentLink, TeamComment } from '../shared/comments';
import { approvalStepName, nextApprovalStep, type ApprovalStep } from '../shared/bulletins';
import { evaluatePermission, type RoleDefinition } from '../shared/rbac';
import { localStamp, writeNotification } from './notifications';
import type { NotificationCategory } from '../shared/notifications';
import { resourceKindName, type Booking } from '../shared/planning';
import { stationsOf } from '../shared/stations';
import type { CardNoticeContext } from './cards';
import { parseChannel, type ChatMessage, type Conversation } from '../shared/chat';
import { moduleForLink } from '../shared/moduleAccess';
import { moduleAllowedForUser } from './moduleAccess';

function listData(db: NewsroomDatabase, collection: CollectionName): any[] {
  return db.listCollection(collection).map((r) => r.d);
}

export function notifyUser(
  db: NewsroomDatabase,
  userId: string,
  title: string,
  message: string,
  linkUrl: string,
  category: NotificationCategory = 'assignment',
  urgent = false,
  senderId?: string
): void {
  const module = moduleForLink(linkUrl);
  if (module && !moduleAllowedForUser(db, module, userId)) return;
  writeNotification(db, { userId, title, message, linkUrl, category, urgent, type: 'TASK', senderId });
}

/** Colleagues as card notices need them: station, role, department and what they may do on cards. */
export function cardPeopleContext(db: NewsroomDatabase, settings: any): CardNoticeContext {
  const roles = listData(db, 'roles') as RoleDefinition[];
  const departments = departmentsOf(settings);
  const people = listData(db, 'users')
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
export function settleCardNotifications(db: NewsroomDatabase, cardId: string): void {
  const link = `/cards/${cardId}`;
  for (const row of db.listCollection('notifications')) {
    if (row.d && row.d.linkUrl === link && !row.d.isRead) db.writeRow('notifications', row.id, { ...row.d, isRead: true }, row.p, null);
  }
}

/** Who can give this sign-off (for notifications). */
function approversFor(db: NewsroomDatabase, step: ApprovalStep, bulletin: any): string[] {
  if (step.kind === 'USER') return step.userId ? [step.userId] : [];
  if (step.kind === 'BULLETIN_EDITOR' && bulletin.editorId) return [bulletin.editorId];
  const roles = listData(db, 'roles') as RoleDefinition[];
  return listData(db, 'users')
    .filter((u: any) => u.isActive !== false && !u.deletedAt)
    .filter((u: any) => (step.kind === 'ROLE' ? u.role === step.roleCode : evaluatePermission(u, 'bulletins.approve', roles, departmentsOf(db.getRow('settings', SINGLETON_ID)?.d))))
    .map((u: any) => u.id)
    .slice(0, 20);
}

/** Whoever gives the next sign-off hears when a story waits for them; the writer hears when it comes back. */
export function notifyBulletinStory(db: NewsroomDatabase, before: any, after: any, auth: AuthContext): void {
  const bulletin = db.getRow('bulletins', String(after.bulletinId))?.d;
  if (!bulletin) return;
  const link = `/bulletins/${bulletin.id}`;
  const approvalsGrew = (after.approvals?.length || 0) > (before?.approvals?.length || 0);
  if (after.status === 'READY' && (before?.status !== 'READY' || approvalsGrew)) {
    const next = nextApprovalStep(bulletin, after);
    if (next) {
      const progress = approvalsGrew ? ` (اعتمدها ${auth.user.fullName}، بانتظارك الآن)` : '';
      for (const userId of approversFor(db, next, bulletin)) {
        if (userId === auth.user.id) continue;
        notifyUser(db, userId, `قصة بانتظار اعتمادك: ${after.slug}`, `${bulletin.title} — ${approvalStepName(next, bulletin)}${progress}`, link, 'bulletin');
      }
    }
  }
  if (before?.status === after.status) return;
  if (after.status === 'DRAFT' && before?.status && after.writerId && after.writerId !== auth.user.id) {
    notifyUser(db, after.writerId, `أُعيدت قصة للتعديل: ${after.slug}`, `${bulletin.title}${after.returnNote ? ` — ${after.returnNote}` : ''}`, link, 'bulletin');
  }
  if (after.status === 'APPROVED' && after.writerId && after.writerId !== auth.user.id) {
    notifyUser(db, after.writerId, `اعتُمدت قصتك: ${after.slug}`, bulletin.title, link, 'bulletin');
  }
}

/** People of a private conversation hear about a new message: once per conversation until they read it, and always when it is urgent. */
export function notifyMessage(db: NewsroomDatabase, message: ChatMessage): void {
  if (!message.to) return;
  const channel = parseChannel(message.channel)!;
  const linkUrl = `/messages/${encodeURIComponent(message.channel)}`;
  const waiting = new Set(listData(db, 'notifications').filter((n: any) => n.linkUrl === linkUrl && !n.isRead).map((n: any) => n.userId));
  const group = channel.kind === 'group' ? (db.getRow('conversations', channel.id)?.d as Conversation | undefined)?.name : undefined;
  const body = message.text || (message.attachments?.length ? `أرسل ${message.attachments.length === 1 ? 'ملفاً' : 'ملفات'}: ${message.attachments.map((a) => a.name).join('، ')}` : '');
  for (const userId of message.to) {
    if (userId === message.userId || (waiting.has(userId) && !message.isUrgent)) continue;
    notifyUser(db, userId, group ? `${group}: ${message.userName}` : `رسالة من ${message.userName}`, body.slice(0, 200), linkUrl, 'message', message.isUrgent === true, message.userId);
  }
}

/** Mentioned colleagues, and the story's author, hear about a new comment. */
export function notifyComment(db: NewsroomDatabase, c: TeamComment, auth: AuthContext): void {
  const recipients = new Map<string, string>();
  c.mentions.forEach((id) => recipients.set(id, `${c.authorName} أشار إليك`));
  if (c.target.kind === 'news') {
    const authorId = db.getRow('news', c.target.id)?.d?.authorId;
    if (authorId && !recipients.has(authorId)) recipients.set(authorId, `تعليق جديد من ${c.authorName} على خبرك`);
  }
  recipients.delete(auth.user.id);
  for (const [userId, title] of recipients) {
    writeNotification(db, { userId, title, message: `«${c.target.title}»: ${c.text.slice(0, 140)}`, linkUrl: commentLink(c.target), category: 'mention', type: 'SYSTEM' });
  }
}

/** Tells the right people about a request: the target department's on-duty staff, or the requester. */
export function notifyRequest(db: NewsroomDatabase, before: any, after: DeptRequest, auth: AuthContext): void {
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
    const onDuty = onDutyAt(listData(db, 'roster') as RosterEntry[], Date.now(), after.departmentId).map((e) => e.userId);
    const members = listData(db, 'users')
      .filter((u: any) => u.isActive !== false && departmentIdOf(u) === after.departmentId)
      .map((u: any) => u.id);
    (onDuty.length ? onDuty : members).forEach((id) => recipients.add(id));
    // The head of the department (or of the department above it) always hears about new requests.
    const head = departmentHead(after.departmentId);
    if (head && db.getRow('users', head)?.d?.isActive !== false) recipients.add(head);
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
    writeNotification(db, {
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
export function notifyNewsWorkflow(db: NewsroomDatabase, before: any, after: any, auth: AuthContext): void {
  // A quality pass reaches the approvers: the story is ready for their decision.
  const passes = (logs: any[] | undefined) => (logs || []).filter((l: any) => l?.action === 'QUALITY_PASSED').length;
  if (before && passes(after.workflowLogs) > passes(before.workflowLogs) && after.status === 'UNDER_REVIEW') {
    const roles = auth.roles;
    for (const row of db.listCollection('users')) {
      const u = row.d;
      if (!u || u.id === auth.user.id || u.isActive === false || u.deletedAt || !evaluatePermission(u, 'news.approve', roles, departmentsOf(db.getRow('settings', SINGLETON_ID)?.d))) continue;
      writeNotification(db, {
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
  writeNotification(db, {
    userId: after.authorId,
    title: `${title} — ${auth.user.fullName}`,
    message: `«${after.title}»${note ? `: ${String(note).slice(0, 200)}` : ''}`,
    linkUrl: `/news/${after.id}`,
    category: 'news',
    type: after.status === 'NEEDS_REVISION' || after.status === 'REJECTED' ? 'NEWS_REJECTED' : 'NEWS_APPROVED',
  });
}

/** Newly assigned colleagues hear about a diary entry; everyone assigned hears when its time moves. */
export function notifyDiary(db: NewsroomDatabase, before: any, after: any, auth: AuthContext): void {
  const prev = new Set<string>(before?.assigneeIds || []);
  const moved = before && (before.date !== after.date || before.startTime !== after.startTime);
  for (const userId of after.assigneeIds || []) {
    if (userId === auth.user.id) continue;
    const isNew = !prev.has(userId);
    if (!isNew && !moved) continue;
    writeNotification(db, {
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
export function notifyBooking(db: NewsroomDatabase, before: any, after: Booking, auth: AuthContext): void {
  const who = after.assigneeId;
  if (!who || who === auth.user.id) return;
  const changed = !before || before.assigneeId !== who || before.start !== after.start || before.end !== after.end || before.status !== after.status;
  if (!changed) return;
  const resource = db.getRow('resources', after.resourceId)?.d;
  const when = `${localStamp(after.start)}–${localStamp(after.end, false)}`;
  writeNotification(db, {
    userId: who,
    title: after.status === 'CANCELLED' ? `أُلغي حجز: ${resource?.name || ''}` : `${before ? 'تعديل حجز' : 'حجز باسمك'}: ${resource?.name || resourceKindName(resource?.kind)}`,
    message: `${after.title} — ${when} (${auth.user.fullName})`,
    linkUrl: `/bookings/${after.id}`,
    category: 'booking',
  });
}
