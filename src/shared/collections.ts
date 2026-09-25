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
  programEvaluations: { storageKey: 'nrcs_prg_evals_v1', kind: 'list' },
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
} as const;

export type CollectionName = keyof typeof COLLECTIONS;

export const COLLECTION_NAMES = Object.keys(COLLECTIONS) as CollectionName[];

/** Row id used for singleton collections (e.g. settings). */
export const SINGLETON_ID = 'singleton';

/** Append-only collections: clients may add rows but never edit or remove them. */
export const APPEND_ONLY_COLLECTIONS: ReadonlySet<CollectionName> = new Set(['auditLogs', 'activityLogs']);

/** Maximum rows of an append-only log sent to a browser on bootstrap. */
export const LOG_BOOTSTRAP_LIMIT = 500;

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
