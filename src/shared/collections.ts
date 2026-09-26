/**
 * Registry of every data collection persisted on the server (SQLite `entities` table).
 * The browser keeps a synchronous in-memory mirror keyed by the legacy storage keys,
 * so existing views keep calling ApiService synchronously.
 */
export const COLLECTIONS = {
  users: { storageKey: 'nrcs_users_v1', kind: 'list' },
  roles: { storageKey: 'nrcs_custom_roles_v2', kind: 'list' },
  news: { storageKey: 'nrcs_news_v1', kind: 'list' },
  stories: { storageKey: 'nrcs_stories_v1', kind: 'list' },
  breaking: { storageKey: 'nrcs_breaking_v1', kind: 'list' },
  programs: { storageKey: 'nrcs_programs_v1', kind: 'list' },
  episodes: { storageKey: 'nrcs_episodes_v1', kind: 'list' },
  guests: { storageKey: 'nrcs_guests_v1', kind: 'list' },
  tasks: { storageKey: 'nrcs_tasks_v1', kind: 'list' },
  media: { storageKey: 'nrcs_media_v1', kind: 'list' },
  categories: { storageKey: 'nrcs_categories_v1', kind: 'list' },
  sources: { storageKey: 'nrcs_sources_v1', kind: 'list' },
  programTypes: { storageKey: 'nrcs_prg_types_v1', kind: 'list' },
  notifications: { storageKey: 'nrcs_notifs_v1', kind: 'list' },
  activityLogs: { storageKey: 'nrcs_activity_v1', kind: 'list' },
  auditLogs: { storageKey: 'nrcs_audit_v1', kind: 'list' },
  settings: { storageKey: 'nrcs_settings_v1', kind: 'singleton' },
  /** Shared on-air state (e.g. the live lock) that every workstation must see. */
  broadcastState: { storageKey: 'nrcs_broadcast_state_v1', kind: 'singleton' },
  /** Internal newsroom chat (intercom channels). */
  messages: { storageKey: 'nrcs_messages_v1', kind: 'list' },
  /** Soft edit locks ("X is editing this story"); id = `${collection}:${entityId}`. */
  editLocks: { storageKey: 'nrcs_edit_locks_v1', kind: 'list' },
  /** Team comments with @mentions (append-only; author stamped by the server). */
  comments: { storageKey: 'nrcs_comments_v1', kind: 'list' },
  /** Live broadcast state per episode (id = episodeId); timings are stamped by the server. */
  onAir: { storageKey: 'nrcs_onair_v1', kind: 'list' },
  /** On-air alerts from the director/control room to departments. */
  cues: { storageKey: 'nrcs_cues_v1', kind: 'list' },
  /** Requests between departments (montage, graphics, studio, ...). */
  requests: { storageKey: 'nrcs_requests_v1', kind: 'list' },
  /** Duty roster: who is on shift in each department; id = `${date}:${departmentId}:${shift}:${userId}`. */
  roster: { storageKey: 'nrcs_roster_v1', kind: 'list' },
  /** Agency wire items pulled by the server from RSS/Atom feeds (server-written only). */
  wires: { storageKey: 'nrcs_wires_v1', kind: 'list' },
} as const;

export type CollectionName = keyof typeof COLLECTIONS;

export const COLLECTION_NAMES = Object.keys(COLLECTIONS) as CollectionName[];

/** Row id used for singleton collections (e.g. settings). */
export const SINGLETON_ID = 'singleton';

/** Append-only collections: clients may add rows but never edit or remove them. */
export const APPEND_ONLY_COLLECTIONS: ReadonlySet<CollectionName> = new Set(['auditLogs', 'activityLogs', 'messages']);

export interface BroadcastState {
  liveLock: boolean;
  lockedById?: string;
  lockedByName?: string;
  lockedAt?: string;
}

/** Collections whose previous versions are kept for review and restore. */
export const HISTORY_COLLECTIONS: ReadonlySet<CollectionName> = new Set(['news', 'stories']);

/** Collections protected by edit locks. */
export const LOCKABLE_COLLECTIONS: ReadonlySet<CollectionName> = new Set(['news', 'episodes']);

/** A lock expires unless the editor renews it (the client heartbeats well within this window). */
export const EDIT_LOCK_TTL_MS = 2 * 60 * 1000;

export interface EditLock {
  id: string;
  collection: CollectionName;
  entityId: string;
  userId?: string;
  userName?: string;
  acquiredAt?: string;
  expiresAt?: string;
}

export function lockIdFor(collection: CollectionName, entityId: string) {
  return `${collection}:${entityId}`;
}

export function isLockActive(lock: EditLock | null | undefined, now = Date.now()): boolean {
  return !!lock && !!lock.expiresAt && new Date(lock.expiresAt).getTime() > now;
}

export interface ChatMessage {
  id: string;
  /** 'general', a department id, or a legacy channel (STUDIO_PCR, NEWSROOM, FIELD). */
  channel: string;
  text: string;
  userId?: string;
  userName?: string;
  userRole?: string;
  userAvatar?: string;
  timestamp?: string;
}

/** Maximum rows of an append-only log sent to a browser on bootstrap. */
export const LOG_BOOTSTRAP_LIMIT = 500;

/**
 * News in these states is finished work. Once untouched for NEWS_ACTIVE_DAYS it leaves the
 * synced newsroom (browsers stop downloading it) and is reached through the archive search.
 */
export const SETTLED_NEWS_STATUSES = ['PUBLISHED', 'ARCHIVED', 'UNPUBLISHED', 'REJECTED'] as const;

export function isCollectionName(value: unknown): value is CollectionName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(COLLECTIONS, value);
}

export function collectionForStorageKey(storageKey: string): CollectionName | undefined {
  return COLLECTION_NAMES.find((name) => COLLECTIONS[name].storageKey === storageKey);
}

/** Wire format of one stored row. */
export interface EntityRow {
  c: CollectionName;
  id: string;
  /** Row version, incremented on every update (optimistic concurrency). */
  v: number;
  /** Ordering key inside the collection (ascending). */
  p: number;
  /** Entity payload; absent for deletions. */
  d?: any;
  deleted?: boolean;
}

export interface SyncOp {
  c: CollectionName;
  op: 'upsert' | 'delete';
  id: string;
  d?: any;
  p?: number;
  /** Version the client based its edit on; omitted for new rows. */
  baseV?: number;
}

export type SyncOpResult =
  | { ok: true; row: EntityRow }
  | { ok: false; code: 'FORBIDDEN' | 'CONFLICT' | 'INVALID' | 'NOT_FOUND'; message: string; current?: EntityRow | null };

export const ENTITY_ID_PATTERN = /^[A-Za-z0-9_.:\-]{1,128}$/;
