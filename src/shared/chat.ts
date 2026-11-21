/**
 * Messaging between colleagues: direct conversations, groups, and open channels for the whole
 * newsroom, each station and each department. A message may carry files and point at a record
 * in the system (a story, an episode, a bulletin, a production card).
 *
 * Privacy is decided here and enforced by the server: a direct message is read by its two
 * people, a group message by the people who were in the group when it was sent, and nobody else.
 */
import { departmentsLedBy, isDepartmentId, type Department } from './departments';
import { ENTITY_ID_PATTERN } from './collections';

/** Channels kept from the first newsroom intercom. */
const LEGACY_PUBLIC = new Map([['STUDIO_PCR', 'control'], ['NEWSROOM', 'newsroom'], ['FIELD', 'field']]);
export const canonicalMessageChannel = (channel: string) => LEGACY_PUBLIC.get(channel) ?? channel;
const ID = /^[A-Za-z0-9_.\-]{1,100}$/;

export type Channel =
  | { kind: 'general' }
  | { kind: 'department'; id: string }
  | { kind: 'station'; id: string }
  | { kind: 'legacy'; id: string }
  | { kind: 'dm'; userIds: [string, string] }
  | { kind: 'group'; id: string };

/** The one conversation of two people, whoever starts it. */
export const dmChannel = (a: string, b: string) => `dm:${[a, b].sort().join(':')}`;
export const groupChannel = (conversationId: string) => `grp:${conversationId}`;
export const stationChannel = (stationId: string) => `st:${stationId}`;

export function parseChannel(channel: unknown): Channel | null {
  if (typeof channel !== 'string' || channel.length > 250) return null;
  if (channel === 'general') return { kind: 'general' };
  if (isDepartmentId(channel)) return { kind: 'department', id: channel };
  if (LEGACY_PUBLIC.has(channel)) return { kind: 'legacy', id: channel };
  const [prefix, ...rest] = channel.split(':');
  if (prefix === 'st' && rest.length === 1 && ID.test(rest[0])) return { kind: 'station', id: rest[0] };
  if (prefix === 'grp' && rest.length === 1 && ID.test(rest[0])) return { kind: 'group', id: rest[0] };
  if (prefix === 'dm' && rest.length === 2 && rest.every((id) => ID.test(id)) && rest[0] < rest[1]) return { kind: 'dm', userIds: [rest[0], rest[1]] };
  return null;
}

export const isPrivateChannel = (channel: unknown) => ['dm', 'group'].includes(parseChannel(channel)?.kind || '');

export interface ChatPin {
  id: string;
  messageId: string;
  excerpt: string;
}

export function canPinAnnouncement(channel: string, userId: string, departments: readonly Department[], canBroadcast: boolean): boolean {
  if (!publicMessageOrigin(channel, 'pin')) return false;
  return canBroadcast || departmentsLedBy(userId, departments).some(department => department.id === channel);
}

export function publicMessageOrigin(channel: string, id: string) {
  const kind = parseChannel(channel)?.kind;
  return (kind === 'general' || kind === 'department' || kind === 'station') && ENTITY_ID_PATTERN.test(id);
}

export const messageEntryPath = (channel: string, id: string) => `/messages/${encodeURIComponent(channel)}/entry/${encodeURIComponent(id)}`;

export function splitMessageFocus(focus: string | null | undefined) {
  const [channel, target, ...rest] = focus?.split('/entry/') ?? [];
  return { channel, messageId: target && !rest.length && publicMessageOrigin(channel, target) ? target : undefined };
}

export interface ChatAttachment {
  /** Upload id; the file is fetched from CHAT_FILE_URL_PREFIX + id. */
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export const CHAT_FILE_URL_PREFIX = '/api/v1/chat/files/';
export const chatFileUrl = (attachment: Pick<ChatAttachment, 'id'>) => `${CHAT_FILE_URL_PREFIX}${attachment.id}`;

/** Files colleagues exchange: pictures, video, audio, PDF and office documents. */
export const CHAT_UPLOAD_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
};

/** Types a browser may show in place; everything else is offered as a download. */
export const isInlineChatType = (mimeType: string) => /^(image|video|audio)\//.test(mimeType) || mimeType === 'application/pdf';

export const CHAT_REF_KINDS = [
  { id: 'news', name: 'خبر' },
  { id: 'episode', name: 'حلقة' },
  { id: 'bulletin', name: 'نشرة' },
  { id: 'card', name: 'تكليف' },
] as const;
export type ChatRefKind = (typeof CHAT_REF_KINDS)[number]['id'];

/** A record in the system the message points at. */
export interface ChatRef {
  kind: ChatRefKind;
  id: string;
  title: string;
}

/** Address of the record a message points at. */
export const chatRefLink = (ref: ChatRef) => `/${ref.kind === 'card' ? 'cards' : ref.kind === 'episode' ? 'episodes' : ref.kind === 'bulletin' ? 'bulletins' : 'news'}/${encodeURIComponent(ref.id)}`;

export interface ChatMessage {
  id: string;
  channel: string;
  text: string;
  attachments?: ChatAttachment[];
  ref?: ChatRef;
  isUrgent?: boolean;
  /** Stamped by the server: who may read a private message (the people of the conversation when it was sent). */
  to?: string[];
  userId?: string;
  userName?: string;
  userRole?: string;
  userAvatar?: string;
  timestamp?: string;
}

/** A group conversation. */
export interface Conversation {
  id: string;
  name: string;
  memberIds: string[];
  ownerId?: string;
  ownerName?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

/** Where each colleague has read up to, per channel; one private row per user, shared by their devices. */
export interface ChatReads {
  id: string;
  userId: string;
  seen: Record<string, string>;
  updatedAt?: string;
}

export const MAX_MESSAGE_CHARS = 4000;
export const MAX_ATTACHMENTS = 10;
export const MAX_GROUP_MEMBERS = 200;

export function messageError(message: any): string | null {
  if (!message || typeof message !== 'object') return 'رسالة غير صالحة';
  if (!parseChannel(message.channel)) return 'قناة غير معروفة';
  if (typeof message.text !== 'string' || message.text.length > MAX_MESSAGE_CHARS) return 'نص الرسالة غير صالح';
  const attachments = message.attachments;
  if (attachments !== undefined) {
    if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) return `الحد الأقصى ${MAX_ATTACHMENTS} مرفقات في الرسالة`;
    if (attachments.some((a) => !a || typeof a.id !== 'string' || !ID.test(a.id)) || new Set(attachments.map((a) => a.id)).size !== attachments.length) return 'مرفق غير صالح';
  }
  if (!message.text.trim() && !(attachments || []).length) return 'اكتب رسالة أو أرفق ملفاً';
  if (message.ref !== undefined && message.ref !== null) {
    const ref = message.ref;
    if (!ref || !CHAT_REF_KINDS.some((k) => k.id === ref.kind) || typeof ref.id !== 'string' || !/^[A-Za-z0-9_.:\-]{1,128}$/.test(ref.id) || typeof ref.title !== 'string' || !ref.title.trim() || ref.title.length > 300) return 'الإشارة إلى المادة غير صالحة';
  }
  return null;
}

/** Whether a user may read a stored message. */
export function canReadMessage(message: any, userId: string): boolean {
  const channel = parseChannel(message?.channel);
  if (!channel) return false;
  if (channel.kind === 'dm') return channel.userIds.includes(userId);
  if (channel.kind === 'group') return Array.isArray(message.to) && message.to.includes(userId);
  return true;
}

interface ChatContext {
  /** Active users by id. */
  users: Set<string>;
  stations: Set<string>;
  conversations: Conversation[];
}

/** Whether the sender may post to the channel. */
export function sendError(message: any, senderId: string, ctx: ChatContext): string | null {
  const shape = messageError(message);
  if (shape) return shape;
  const channel = parseChannel(message.channel)!;
  if (channel.kind === 'station' && !ctx.stations.has(channel.id)) return 'قناة محطة غير موجودة';
  if (channel.kind === 'dm') {
    if (!channel.userIds.includes(senderId)) return 'هذه المحادثة ليست لك';
    const other = channel.userIds.find((id) => id !== senderId);
    if (!other || !ctx.users.has(other)) return 'الزميل غير موجود أو موقوف';
  }
  if (channel.kind === 'group') {
    const conversation = ctx.conversations.find((c) => c.id === channel.id && !c.deletedAt);
    if (!conversation) return 'المجموعة غير موجودة';
    if (!conversation.memberIds.includes(senderId)) return 'لست عضواً في هذه المجموعة';
  }
  return null;
}

/**
 * Who may change a group: anyone allowed to create groups starts one (and owns it); the owner
 * renames it and adds or removes people; a member may only leave.
 */
export function conversationChangeError(before: Conversation | null, after: Conversation, actorId: string, canCreate: boolean, activeUsers: Set<string>): string | null {
  if (!after || typeof after.name !== 'string' || !after.name.trim() || after.name.length > 80) return 'اسم المجموعة مطلوب وبحد أقصى 80 حرفاً';
  const members = after.memberIds;
  if (!Array.isArray(members) || members.some((id) => typeof id !== 'string' || !ID.test(id)) || new Set(members).size !== members.length) return 'قائمة الأعضاء غير صالحة';
  if (members.length > MAX_GROUP_MEMBERS) return `الحد الأقصى ${MAX_GROUP_MEMBERS} عضو`;
  const added = members.filter((id) => !before?.memberIds.includes(id));
  if (added.some((id) => !activeUsers.has(id))) return 'أحد الأعضاء غير موجود أو موقوف';

  if (!before) {
    if (!canCreate) return 'صلاحياتك لا تسمح بإنشاء مجموعات';
    if (!members.includes(actorId)) return 'منشئ المجموعة عضو فيها';
    return members.length < 2 ? 'المجموعة تحتاج عضوين على الأقل' : null;
  }
  if (before.deletedAt) return 'المجموعة محذوفة';
  if (before.ownerId === actorId) return members.includes(actorId) ? null : 'انقل ملكية المجموعة أو احذفها قبل مغادرتها';
  if (!before.memberIds.includes(actorId)) return 'لست عضواً في هذه المجموعة';
  // A member may leave, nothing else.
  const left = before.memberIds.filter((id) => id !== actorId);
  const onlyLeft = after.name === before.name && !after.deletedAt && members.length === left.length && left.every((id, i) => members[i] === id);
  return onlyLeft ? null : 'تعديل المجموعة وأعضائها لمنشئها';
}

export function chatReadsError(reads: any, userId: string): string | null {
  if (!reads || reads.id !== userId || reads.userId !== userId) return 'يحدّث كل زميل مؤشر قراءته فقط';
  const seen = reads.seen;
  if (!seen || typeof seen !== 'object' || Array.isArray(seen)) return 'مؤشر القراءة غير صالح';
  const entries = Object.entries(seen);
  if (entries.length > 1000 || entries.some(([channel, at]) => !parseChannel(channel) || typeof at !== 'string' || at.length > 40)) return 'مؤشر القراءة غير صالح';
  return null;
}

/**
 * Unread messages per channel for one user (their own messages never count). Private messages
 * are addressed to the user, so all of them count until read; an open channel counts only from
 * the user's first visit to it, so years of channel history never show up as unread.
 */
export function unreadByChannel(messages: ChatMessage[], reads: ChatReads | undefined, userId: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const message of messages) {
    if (message.userId === userId || !message.timestamp) continue;
    const seen = reads?.seen?.[message.channel];
    if (seen === undefined && !isPrivateChannel(message.channel)) continue;
    if (message.timestamp > (seen || '')) counts.set(message.channel, (counts.get(message.channel) || 0) + 1);
  }
  return counts;
}
