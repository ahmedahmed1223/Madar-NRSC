import crypto from 'crypto';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { CollectionName, EntityRow, SETTLED_NEWS_STATUSES, isCollectionName } from '../shared/collections';
import { logger } from './logger';
import { withStableBackup } from './databaseRecovery';

export interface DbBackupFileInfo {
  fileName: string;
  sizeBytes: number;
  sizeFormatted: string;
  createdAt: string;
}

export interface CredentialRecord {
  userId: string;
  email: string;
  passwordHash: string;
  mustChangePassword: boolean;
  failedAttempts: number;
  lockedUntil: string | null;
  totpSecret: string | null;
  totpEnabled: boolean;
  totpLastCounter: number;
}

export interface UploadRecord {
  id: string;
  storedName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
  /** The server's own copy was removed; the file is read from a copy elsewhere. */
  localEvicted?: boolean;
}

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

interface RawEntityRow {
  collection: string;
  id: string;
  data: string;
  position: number;
  version: number;
  rev: number;
  deleted: number;
}

const SETTLED_SQL = SETTLED_NEWS_STATUSES.map((s) => `'${s}'`).join(', ');

const BACKUP_NAME_PATTERN = /^newsroom_backup_[0-9TZ\-]+(?:_[a-z]+)?\.sqlite$/;

/** Tables from the pre-SQLite-backend prototype; they never held authoritative data. */
const LEGACY_TABLES = ['news', 'programs', 'episodes', 'rundown_segments', 'guests', 'tasks', 'media_assets', 'audit_logs', 'system_settings'];

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      ${LEGACY_TABLES.map((t) => `DROP TABLE IF EXISTS ${t};`).join('\n')}

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT OR IGNORE INTO meta (key, value) VALUES ('rev', '0');
      INSERT OR IGNORE INTO meta (key, value) VALUES ('tombstone_floor', '0');

      CREATE TABLE IF NOT EXISTS entities (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        position REAL NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        rev INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS idx_entities_rev ON entities (rev);
      CREATE INDEX IF NOT EXISTS idx_entities_collection ON entities (collection, deleted, position);

      CREATE TABLE IF NOT EXISTS user_credentials (
        user_id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        password_changed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE user_credentials ADD COLUMN totp_secret TEXT;
      ALTER TABLE user_credentials ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE user_credentials ADD COLUMN totp_last_counter INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS uploads (
        id TEXT PRIMARY KEY,
        stored_name TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        uploaded_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS entity_history (
        collection TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        data TEXT NOT NULL,
        changed_by TEXT,
        changed_by_name TEXT,
        changed_at TEXT NOT NULL,
        PRIMARY KEY (collection, entity_id, version)
      );
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        last_ok_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions (user_id);
    `,
  },
  {
    version: 5,
    sql: `
      -- 1 once the server's own copy was removed (the file lives in Dropbox or the shared folder).
      ALTER TABLE uploads ADD COLUMN local_evicted INTEGER NOT NULL DEFAULT 0;
      -- Copies of an upload kept elsewhere (Dropbox, the station's shared folder) and their state.
      CREATE TABLE IF NOT EXISTS upload_copies (
        upload_id TEXT NOT NULL,
        target TEXT NOT NULL,
        state TEXT NOT NULL,
        remote_path TEXT,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (upload_id, target)
      );
      CREATE INDEX IF NOT EXISTS idx_upload_copies_state ON upload_copies (target, state);
      -- Files the bridge found in the shared folder (searchable from the library).
      CREATE TABLE IF NOT EXISTS share_index (
        path TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        modified_at TEXT,
        seen_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_share_index_name ON share_index (name);
      -- Files requested from the shared folder through the bridge.
      CREATE TABLE IF NOT EXISTS share_fetches (
        upload_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        error TEXT,
        requested_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
];

export interface UploadCopyRow {
  uploadId: string;
  target: import('../shared/storage').CopyTarget;
  state: 'PENDING' | 'DONE' | 'FAILED';
  remotePath?: string;
  error?: string;
  attempts: number;
  nextAttemptAt?: string;
  updatedAt: string;
}

export interface ShareIndexRow {
  path: string;
  name: string;
  sizeBytes: number;
  modifiedAt?: string;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  userId: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
  createdAt: string;
}

function formatSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function toEntityRow(raw: RawEntityRow): EntityRow {
  const row: EntityRow = {
    c: raw.collection as CollectionName,
    id: raw.id,
    v: raw.version,
    p: raw.position,
  };
  if (raw.deleted) row.deleted = true;
  else row.d = JSON.parse(raw.data);
  return row;
}

/**
 * Durable SQLite store (better-sqlite3, WAL mode). Every mutation runs synchronously
 * inside the Node process, so concurrent HTTP requests are naturally serialized and
 * each write is atomic.
 */
export class NewsroomDatabase {
  readonly dataDir: string;
  readonly filePath: string;
  readonly backupsDir: string;
  private db!: Database.Database;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, 'newsroom.sqlite');
    this.backupsDir = path.join(dataDir, 'backups');
    fs.mkdirSync(this.backupsDir, { recursive: true });
    this.open();
  }

  private open() {
    this.db = new Database(this.filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
    const applied = new Set(
      (this.db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version)
    );
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue;
      this.db.transaction(() => {
        this.db.exec(m.sql);
        this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(m.version, new Date().toISOString());
      })();
      logger.info('database migration applied', { version: m.version });
    }
  }

  close() {
    if (this.db?.open) this.db.close();
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  isHealthy(): boolean {
    try {
      return (this.db.prepare('SELECT 1 AS ok').get() as { ok: number }).ok === 1;
    } catch {
      return false;
    }
  }

  // --- Change sequence -----------------------------------------------------

  currentRev(): number {
    return Number((this.db.prepare(`SELECT value FROM meta WHERE key = 'rev'`).get() as { value: string }).value);
  }

  private nextRev(): number {
    const row = this.db.prepare(`UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev' RETURNING value`).get() as {
      value: string | number;
    };
    return Number(row.value);
  }

  tombstoneFloor(): number {
    return Number((this.db.prepare(`SELECT value FROM meta WHERE key = 'tombstone_floor'`).get() as { value: string }).value);
  }

  /** Removes every row of a collection that is no longer part of the product. */
  dropRetiredCollection(collection: string) {
    return this.db.prepare('DELETE FROM entities WHERE collection = ?').run(collection).changes;
  }

  /** Stable identity of this database file (lets clients detect several copies behind one address). */
  get dbId(): string {
    let id = this.getMeta('db_id');
    if (!id) {
      id = crypto.randomUUID();
      this.setMeta('db_id', id);
    }
    return id;
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  // --- Entities ------------------------------------------------------------

  getRow(collection: CollectionName, id: string, includeDeleted = false): EntityRow | null {
    const raw = this.db.prepare('SELECT * FROM entities WHERE collection = ? AND id = ?').get(collection, id) as RawEntityRow | undefined;
    if (!raw || (raw.deleted && !includeDeleted)) return null;
    return toEntityRow(raw);
  }

  listCollection(collection: CollectionName, opts: { limit?: number } = {}): EntityRow[] {
    const sql = `SELECT * FROM entities WHERE collection = ? AND deleted = 0 ORDER BY position ASC${opts.limit ? ' LIMIT ?' : ''}`;
    const stmt = this.db.prepare(sql);
    const rows = (opts.limit ? stmt.all(collection, opts.limit) : stmt.all(collection)) as RawEntityRow[];
    return rows.map(toEntityRow);
  }

  /** News still in the working set: unfinished work, or settled work touched since `sinceIso`. */
  listActiveNews(sinceIso: string): EntityRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM entities WHERE collection = 'news' AND deleted = 0
           AND (COALESCE(json_extract(data, '$.status'), '') NOT IN (${SETTLED_SQL}) OR updated_at >= ?)
         ORDER BY position ASC`
      )
      .all(sinceIso) as RawEntityRow[];
    return rows.map(toEntityRow);
  }

  /** Settled news untouched since `beforeIso`, newest first, optionally filtered by text. */
  searchNewsArchive(beforeIso: string, query: string, limit: number, offset: number) {
    const q = query.trim();
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const textFilter = q
      ? `AND (json_extract(data, '$.title') LIKE @like ESCAPE '\\' OR json_extract(data, '$.summary') LIKE @like ESCAPE '\\' OR json_extract(data, '$.content') LIKE @like ESCAPE '\\')`
      : '';
    const where = `collection = 'news' AND deleted = 0 AND json_extract(data, '$.status') IN (${SETTLED_SQL})
      AND json_extract(data, '$.deletedAt') IS NULL AND updated_at < @before ${textFilter}`;
    const params = { before: beforeIso, like, limit, offset };
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM entities WHERE ${where}`).get(params) as { n: number }).n;
    const rows = this.db
      .prepare(`SELECT id, data, updated_at FROM entities WHERE ${where} ORDER BY updated_at DESC LIMIT @limit OFFSET @offset`)
      .all(params) as { id: string; data: string; updated_at: string }[];
    const items = rows.map((r) => {
      const d = JSON.parse(r.data);
      return {
        id: r.id,
        title: d.title || '',
        summary: d.summary || '',
        status: d.status,
        categoryName: d.categoryName || '',
        authorName: d.authorName || '',
        publishDate: d.publishDate || null,
        updatedAt: r.updated_at,
      };
    });
    return { total, items };
  }

  countCollection(collection: CollectionName): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM entities WHERE collection = ? AND deleted = 0').get(collection) as { n: number }).n;
  }

  /** Smallest / largest position in a collection, used to place new rows at either end. */
  positionBounds(collection: CollectionName): { min: number; max: number } {
    const r = this.db
      .prepare('SELECT MIN(position) AS min, MAX(position) AS max FROM entities WHERE collection = ? AND deleted = 0')
      .get(collection) as { min: number | null; max: number | null };
    return { min: r.min ?? 0, max: r.max ?? 0 };
  }

  changesSince(sinceRev: number, limit: number): { rows: EntityRow[]; truncated: boolean } {
    const raws = this.db
      .prepare('SELECT * FROM entities WHERE rev > ? ORDER BY rev ASC LIMIT ?')
      .all(sinceRev, limit + 1) as RawEntityRow[];
    const truncated = raws.length > limit;
    return {
      rows: raws.slice(0, limit).filter((r) => isCollectionName(r.collection)).map(toEntityRow),
      truncated,
    };
  }

  /** Live rows of one collection written after `sinceRev` (oldest first). */
  collectionChangesSince(collection: CollectionName, sinceRev: number, limit: number): { rev: number; row: EntityRow }[] {
    return (
      this.db
        .prepare('SELECT * FROM entities WHERE collection = ? AND rev > ? AND deleted = 0 ORDER BY rev ASC LIMIT ?')
        .all(collection, sinceRev, limit) as RawEntityRow[]
    ).map((raw) => ({ rev: raw.rev, row: toEntityRow(raw) }));
  }

  /** Insert or replace a row, bumping its version. Caller handles concurrency checks. */
  writeRow(collection: CollectionName, id: string, data: unknown, position: number, userId: string | null): EntityRow {
    const now = new Date().toISOString();
    const rev = this.nextRev();
    const json = JSON.stringify(data);
    const existing = this.db.prepare('SELECT version FROM entities WHERE collection = ? AND id = ?').get(collection, id) as
      | { version: number }
      | undefined;
    if (existing) {
      this.db
        .prepare(
          `UPDATE entities SET data = ?, position = ?, version = version + 1, rev = ?, deleted = 0, updated_at = ?, updated_by = ?
           WHERE collection = ? AND id = ?`
        )
        .run(json, position, rev, now, userId, collection, id);
    } else {
      this.db
        .prepare(
          `INSERT INTO entities (collection, id, data, position, version, rev, deleted, created_at, updated_at, updated_by)
           VALUES (?, ?, ?, ?, 1, ?, 0, ?, ?, ?)`
        )
        .run(collection, id, json, position, rev, now, now, userId);
    }
    return this.getRow(collection, id)!;
  }

  /**
   * Ids of live rows eligible for a retention rule (oldest first, bounded per run).
   * - `updated`: last written before the cutoff (logs are append-only, so this is their age)
   * - `trashed`: soft-deleted (data.deletedAt) before the cutoff
   * - `readNotification`: marked read and untouched since the cutoff
   * - `expiredLock`: an edit lock that expired before the cutoff
   */
  retentionCandidates(
    collection: CollectionName,
    rule: 'updated' | 'trashed' | 'readNotification' | 'expiredLock',
    cutoffIso: string,
    limit = 1000
  ): string[] {
    const condition = {
      updated: 'updated_at < ?',
      trashed: "json_extract(data, '$.deletedAt') IS NOT NULL AND json_extract(data, '$.deletedAt') < ?",
      readNotification: "json_extract(data, '$.isRead') = 1 AND updated_at < ?",
      expiredLock: "json_extract(data, '$.expiresAt') < ?",
    }[rule];
    const rows = this.db
      .prepare(`SELECT id FROM entities WHERE collection = ? AND deleted = 0 AND ${condition} ORDER BY updated_at ASC LIMIT ?`)
      .all(collection, cutoffIso, limit) as { id: string }[];
    return rows.map((r) => r.id);
  }

  /** Revision history of rows that no longer exist. */
  purgeOrphanHistory(): number {
    return this.db
      .prepare(
        `DELETE FROM entity_history WHERE NOT EXISTS (
           SELECT 1 FROM entities e WHERE e.collection = entity_history.collection AND e.id = entity_history.entity_id AND e.deleted = 0)`
      )
      .run().changes;
  }

  /** Soft-delete (tombstone) so other browsers learn about the removal via the change feed. */
  deleteRow(collection: CollectionName, id: string, userId: string | null): EntityRow | null {
    const rev = this.nextRev();
    const res = this.db
      .prepare(
        `UPDATE entities SET deleted = 1, version = version + 1, rev = ?, updated_at = ?, updated_by = ?
         WHERE collection = ? AND id = ? AND deleted = 0`
      )
      .run(rev, new Date().toISOString(), userId, collection, id);
    if (res.changes === 0) return null;
    return this.getRow(collection, id, true);
  }

  /** Drop tombstones older than `olderThanMs`; clients behind the new floor must re-bootstrap. */
  purgeTombstones(olderThanMs: number) {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    this.transaction(() => {
      const maxRev = this.db
        .prepare('SELECT MAX(rev) AS r FROM entities WHERE deleted = 1 AND updated_at < ?')
        .get(cutoff) as { r: number | null };
      if (maxRev.r === null) return;
      this.db.prepare('DELETE FROM entities WHERE deleted = 1 AND updated_at < ?').run(cutoff);
      this.db.prepare(`UPDATE meta SET value = ? WHERE key = 'tombstone_floor' AND CAST(value AS INTEGER) < ?`).run(String(maxRev.r), maxRev.r);
    });
  }

  deleteCollections(collections: CollectionName[]) {
    const stmt = this.db.prepare('DELETE FROM entities WHERE collection = ?');
    this.transaction(() => {
      collections.forEach((c) => stmt.run(c));
      // Force every connected browser to re-bootstrap.
      const rev = this.nextRev();
      this.db.prepare(`UPDATE meta SET value = ? WHERE key = 'tombstone_floor'`).run(String(rev));
    });
  }

  findUserIdByEmail(email: string): string | null {
    const row = this.db
      .prepare(
        `SELECT id FROM entities WHERE collection = 'users' AND deleted = 0 AND lower(json_extract(data, '$.email')) = lower(?)`
      )
      .get(email) as { id: string } | undefined;
    return row?.id ?? null;
  }

  // --- Revision history ------------------------------------------------------

  /** Keeps the state a row had *before* an update, pruned to the newest `keep` revisions. */
  recordHistory(collection: CollectionName, id: string, version: number, data: unknown, userId: string | null, userName: string | null, keep = 100) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO entity_history (collection, entity_id, version, data, changed_by, changed_by_name, changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(collection, id, version, JSON.stringify(data), userId, userName, new Date().toISOString());
    this.db
      .prepare(
        `DELETE FROM entity_history WHERE collection = ? AND entity_id = ? AND version NOT IN (
           SELECT version FROM entity_history WHERE collection = ? AND entity_id = ? ORDER BY version DESC LIMIT ?)`
      )
      .run(collection, id, collection, id, keep);
  }

  /** The state a row had at one earlier version, when it is still kept. */
  getHistoryVersion(collection: CollectionName, id: string, version: number): any | null {
    const row = this.db.prepare('SELECT data FROM entity_history WHERE collection = ? AND entity_id = ? AND version = ?').get(collection, id, version) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }

  listHistory(collection: CollectionName, id: string) {
    return (
      this.db
        .prepare(
          `SELECT version, data, changed_by AS changedBy, changed_by_name AS changedByName, changed_at AS changedAt
           FROM entity_history WHERE collection = ? AND entity_id = ? ORDER BY version DESC`
        )
        .all(collection, id) as { version: number; data: string; changedBy: string | null; changedByName: string | null; changedAt: string }[]
    ).map((r) => ({ ...r, data: JSON.parse(r.data) }));
  }

  // --- Credentials ---------------------------------------------------------

  private mapCredential(r: any): CredentialRecord {
    return {
      userId: r.user_id,
      email: r.email,
      passwordHash: r.password_hash,
      mustChangePassword: !!r.must_change_password,
      failedAttempts: r.failed_attempts,
      lockedUntil: r.locked_until,
      totpSecret: r.totp_secret ?? null,
      totpEnabled: !!r.totp_enabled,
      totpLastCounter: r.totp_last_counter ?? 0,
    };
  }

  /** Stores a pending (not yet enabled) or active TOTP secret; null clears 2FA. */
  setTotp(userId: string, secret: string | null, enabled: boolean) {
    this.db
      .prepare('UPDATE user_credentials SET totp_secret = ?, totp_enabled = ?, totp_last_counter = 0 WHERE user_id = ?')
      .run(secret, enabled ? 1 : 0, userId);
  }

  /** Records the last accepted time-step so a code cannot be replayed. */
  setTotpLastCounter(userId: string, counter: number) {
    this.db.prepare('UPDATE user_credentials SET totp_last_counter = ? WHERE user_id = ?').run(counter, userId);
  }

  // --- Uploads -------------------------------------------------------------

  insertUpload(u: UploadRecord) {
    this.db
      .prepare(
        'INSERT INTO uploads (id, stored_name, original_name, mime_type, size_bytes, uploaded_by, created_at, local_evicted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(u.id, u.storedName, u.originalName, u.mimeType, u.sizeBytes, u.uploadedBy, u.createdAt, u.localEvicted ? 1 : 0);
  }

  getUpload(id: string): UploadRecord | null {
    const r = this.db.prepare('SELECT * FROM uploads WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      storedName: r.stored_name,
      originalName: r.original_name,
      mimeType: r.mime_type,
      sizeBytes: r.size_bytes,
      uploadedBy: r.uploaded_by,
      createdAt: r.created_at,
      localEvicted: r.local_evicted === 1,
    };
  }

  /** The server holds the file again (fetched from the shared folder). */
  updateUploadStorage(id: string, storedName: string, sizeBytes: number) {
    this.db.prepare('UPDATE uploads SET stored_name = ?, size_bytes = ? WHERE id = ?').run(storedName, sizeBytes, id);
  }

  setUploadEvicted(id: string, evicted: boolean) {
    this.db.prepare('UPDATE uploads SET local_evicted = ? WHERE id = ?').run(evicted ? 1 : 0, id);
  }

  // --- Copies elsewhere (Dropbox, shared folder) ----------------------------

  private mapCopy(r: any): UploadCopyRow {
    return {
      uploadId: r.upload_id,
      target: r.target,
      state: r.state,
      remotePath: r.remote_path || undefined,
      error: r.error || undefined,
      attempts: r.attempts,
      nextAttemptAt: r.next_attempt_at || undefined,
      updatedAt: r.updated_at,
    };
  }

  queueCopy(uploadId: string, target: UploadCopyRow['target'], state: UploadCopyRow['state'] = 'PENDING', remotePath?: string) {
    this.db
      .prepare(
        `INSERT INTO upload_copies (upload_id, target, state, remote_path, attempts, updated_at) VALUES (?, ?, ?, ?, 0, ?)
         ON CONFLICT(upload_id, target) DO UPDATE SET state = excluded.state, remote_path = COALESCE(excluded.remote_path, remote_path), error = NULL, attempts = 0, next_attempt_at = NULL, updated_at = excluded.updated_at`
      )
      .run(uploadId, target, state, remotePath ?? null, new Date().toISOString());
  }

  copiesOf(uploadId: string): UploadCopyRow[] {
    return (this.db.prepare('SELECT * FROM upload_copies WHERE upload_id = ? ORDER BY target').all(uploadId) as any[]).map((r) => this.mapCopy(r));
  }

  copiesFor(uploadIds: string[]): Map<string, UploadCopyRow[]> {
    const out = new Map<string, UploadCopyRow[]>();
    for (let i = 0; i < uploadIds.length; i += 400) {
      const slice = uploadIds.slice(i, i + 400);
      const rows = this.db.prepare(`SELECT * FROM upload_copies WHERE upload_id IN (${slice.map(() => '?').join(',')})`).all(...slice) as any[];
      for (const r of rows) {
        const copy = this.mapCopy(r);
        out.set(copy.uploadId, [...(out.get(copy.uploadId) || []), copy]);
      }
    }
    return out;
  }

  /**
   * Copies due now, oldest first. Only files something points to (a library item or a message)
   * are copied: a file left behind by an abandoned form is never sent anywhere.
   */
  dueCopies(target: UploadCopyRow['target'], limit: number, nowIso = new Date().toISOString()): UploadCopyRow[] {
    return (
      this.db
        .prepare(
          `SELECT c.* FROM upload_copies c
           WHERE c.target = ? AND c.state = 'PENDING' AND (c.next_attempt_at IS NULL OR c.next_attempt_at <= ?)
             AND (
               EXISTS (SELECT 1 FROM entities e WHERE e.collection = 'media' AND e.deleted = 0 AND instr(e.data, '/api/v1/media/files/' || c.upload_id) > 0)
               OR EXISTS (SELECT 1 FROM entities e WHERE e.collection = 'messages' AND e.deleted = 0 AND instr(e.data, '"id":"' || c.upload_id || '"') > 0)
             )
           ORDER BY c.updated_at ASC LIMIT ?`
        )
        .all(target, nowIso, limit) as any[]
    ).map((r) => this.mapCopy(r));
  }

  finishCopy(uploadId: string, target: string, remotePath: string) {
    this.db
      .prepare(`UPDATE upload_copies SET state = 'DONE', remote_path = ?, error = NULL, next_attempt_at = NULL, updated_at = ? WHERE upload_id = ? AND target = ?`)
      .run(remotePath, new Date().toISOString(), uploadId, target);
  }

  /** A failed attempt: retried later with a growing delay, given up after `maxAttempts`. */
  failCopy(uploadId: string, target: string, error: string, maxAttempts = 8) {
    const row = this.db.prepare('SELECT attempts FROM upload_copies WHERE upload_id = ? AND target = ?').get(uploadId, target) as { attempts: number } | undefined;
    const attempts = (row?.attempts || 0) + 1;
    const delayMs = Math.min(6 * 3600_000, 30_000 * 2 ** (attempts - 1));
    this.db
      .prepare('UPDATE upload_copies SET state = ?, error = ?, attempts = ?, next_attempt_at = ?, updated_at = ? WHERE upload_id = ? AND target = ?')
      .run(attempts >= maxAttempts ? 'FAILED' : 'PENDING', error.slice(0, 300), attempts, new Date(Date.now() + delayMs).toISOString(), new Date().toISOString(), uploadId, target);
  }

  /** Puts every failed copy back in the queue (the administrator's «إعادة المحاولة»). */
  retryFailedCopies(): number {
    return this.db
      .prepare(`UPDATE upload_copies SET state = 'PENDING', attempts = 0, next_attempt_at = NULL, error = NULL, updated_at = ? WHERE state = 'FAILED'`)
      .run(new Date().toISOString()).changes;
  }

  copyQueueSummary(): { pending: number; failed: number; done: number; lastErrors: { uploadId: string; target: string; error: string; updatedAt: string }[] } {
    const counts = this.db.prepare(`SELECT state, COUNT(*) AS n FROM upload_copies GROUP BY state`).all() as { state: string; n: number }[];
    const n = (s: string) => counts.find((c) => c.state === s)?.n || 0;
    const lastErrors = (
      this.db.prepare(`SELECT upload_id, target, error, updated_at FROM upload_copies WHERE error IS NOT NULL ORDER BY updated_at DESC LIMIT 5`).all() as any[]
    ).map((r) => ({ uploadId: r.upload_id, target: r.target, error: r.error, updatedAt: r.updated_at }));
    return { pending: n('PENDING'), failed: n('FAILED'), done: n('DONE'), lastErrors };
  }

  deleteCopies(uploadId: string) {
    this.db.prepare('DELETE FROM upload_copies WHERE upload_id = ?').run(uploadId);
    this.db.prepare('DELETE FROM share_fetches WHERE upload_id = ?').run(uploadId);
  }

  // --- Shared-folder index and fetches --------------------------------------

  /** Replaces (reset) or extends the index the bridge reports; a finished scan drops files no longer seen. */
  indexShareFiles(files: ShareIndexRow[], scanStartedAt: string, finished: boolean) {
    const now = new Date().toISOString();
    const put = this.db.prepare(
      `INSERT INTO share_index (path, name, size_bytes, modified_at, seen_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET name = excluded.name, size_bytes = excluded.size_bytes, modified_at = excluded.modified_at, seen_at = excluded.seen_at`
    );
    this.db.transaction(() => {
      for (const f of files) put.run(f.path, f.name, f.sizeBytes, f.modifiedAt ?? null, now);
      if (finished) {
        this.db.prepare('DELETE FROM share_index WHERE seen_at < ?').run(scanStartedAt);
        this.setMeta('storage.share.indexedAt', now);
      }
    })();
  }

  searchShareIndex(query: string, limit = 50): ShareIndexRow[] {
    const words = query.trim().split(/\s+/).filter(Boolean).slice(0, 5);
    if (!words.length) return [];
    const where = words.map(() => `path LIKE ? ESCAPE '\\'`).join(' AND ');
    const args = words.map((w) => `%${w.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
    return (this.db.prepare(`SELECT * FROM share_index WHERE ${where} ORDER BY modified_at DESC LIMIT ?`).all(...args, limit) as any[]).map((r) => ({
      path: r.path,
      name: r.name,
      sizeBytes: r.size_bytes,
      modifiedAt: r.modified_at || undefined,
    }));
  }

  getShareIndexEntry(p: string): ShareIndexRow | null {
    const r = this.db.prepare('SELECT * FROM share_index WHERE path = ?').get(p) as any;
    return r ? { path: r.path, name: r.name, sizeBytes: r.size_bytes, modifiedAt: r.modified_at || undefined } : null;
  }

  shareIndexCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM share_index').get() as { n: number }).n;
  }

  requestShareFetch(uploadId: string) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO share_fetches (upload_id, state, requested_at, updated_at) VALUES (?, 'PENDING', ?, ?)
         ON CONFLICT(upload_id) DO UPDATE SET state = CASE WHEN state = 'DONE' THEN state ELSE 'PENDING' END, error = NULL, updated_at = excluded.updated_at`
      )
      .run(uploadId, now, now);
  }

  pendingShareFetches(limit = 10): { uploadId: string; path: string }[] {
    return (
      this.db
        .prepare(
          `SELECT f.upload_id, c.remote_path FROM share_fetches f JOIN upload_copies c ON c.upload_id = f.upload_id AND c.target = 'share'
           WHERE f.state = 'PENDING' ORDER BY f.requested_at ASC LIMIT ?`
        )
        .all(limit) as any[]
    ).map((r) => ({ uploadId: r.upload_id, path: r.remote_path }));
  }

  finishShareFetch(uploadId: string, error?: string) {
    this.db.prepare('UPDATE share_fetches SET state = ?, error = ?, updated_at = ? WHERE upload_id = ?').run(error ? 'FAILED' : 'DONE', error ?? null, new Date().toISOString(), uploadId);
  }

  shareFetchState(uploadId: string): { state: string; error?: string } | null {
    const r = this.db.prepare('SELECT state, error FROM share_fetches WHERE upload_id = ?').get(uploadId) as any;
    return r ? { state: r.state, error: r.error || undefined } : null;
  }

  deleteUpload(id: string) {
    this.db.prepare('DELETE FROM uploads WHERE id = ?').run(id);
    this.deleteCopies(id);
  }

  uploadsSummary(): { files: number; bytes: number } {
    const row = this.db.prepare('SELECT COUNT(*) AS files, COALESCE(SUM(size_bytes), 0) AS bytes FROM uploads').get() as { files: number; bytes: number };
    return { files: row.files, bytes: row.bytes };
  }

  messageSummary(): { count: number; oldestAt?: string } {
    const row = this.db.prepare(`SELECT COUNT(*) AS count, MIN(json_extract(data, '$.timestamp')) AS oldest FROM entities WHERE collection = 'messages' AND deleted = 0`).get() as { count: number; oldest: string | null };
    return { count: row.count, oldestAt: row.oldest || undefined };
  }

  /** Messages that carry an uploaded file (to decide who may download it). */
  messagesWithUpload(uploadId: string): any[] {
    const rows = this.db
      .prepare(`SELECT data FROM entities WHERE collection = 'messages' AND deleted = 0 AND instr(data, ?) > 0 LIMIT 20`)
      .all(`"id":"${uploadId}"`) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data)).filter((m) => (m.attachments || []).some((a: any) => a.id === uploadId));
  }

  /** Messages of one channel sent before a moment, newest first (older history than a browser holds). */
  messagesBefore(channel: string, beforeIso: string, limit: number): any[] {
    const rows = this.db
      .prepare(
        `SELECT data FROM entities WHERE collection = 'messages' AND deleted = 0
           AND json_extract(data, '$.channel') = ? AND json_extract(data, '$.timestamp') < ?
         ORDER BY json_extract(data, '$.timestamp') DESC LIMIT ?`
      )
      .all(channel, beforeIso, limit) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data));
  }

  /** Uploads older than `olderThanMs` that no live media record or message points to. */
  findOrphanUploads(olderThanMs: number): UploadRecord[] {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const rows = this.db
      .prepare(
        `SELECT u.id FROM uploads u
         WHERE u.created_at < ?
           AND NOT EXISTS (
             SELECT 1 FROM entities e
             WHERE e.collection = 'media' AND e.deleted = 0 AND instr(e.data, '/api/v1/media/files/' || u.id) > 0
           )
           AND NOT EXISTS (
             SELECT 1 FROM entities e
             WHERE e.collection = 'messages' AND e.deleted = 0 AND instr(e.data, '"id":"' || u.id || '"') > 0
           )`
      )
      .all(cutoff) as { id: string }[];
    return rows.map((r) => this.getUpload(r.id)!).filter(Boolean);
  }

  getCredentialsByEmail(email: string): CredentialRecord | null {
    const r = this.db.prepare('SELECT * FROM user_credentials WHERE email = ?').get(email);
    return r ? this.mapCredential(r) : null;
  }

  getCredentials(userId: string): CredentialRecord | null {
    const r = this.db.prepare('SELECT * FROM user_credentials WHERE user_id = ?').get(userId);
    return r ? this.mapCredential(r) : null;
  }

  countCredentials(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM user_credentials').get() as { n: number }).n;
  }

  setPassword(userId: string, email: string, passwordHash: string, mustChange: boolean) {
    this.db
      .prepare(
        `INSERT INTO user_credentials (user_id, email, password_hash, must_change_password, failed_attempts, locked_until, password_changed_at)
         VALUES (?, ?, ?, ?, 0, NULL, ?)
         ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, password_hash = excluded.password_hash,
           must_change_password = excluded.must_change_password, failed_attempts = 0, locked_until = NULL,
           password_changed_at = excluded.password_changed_at`
      )
      .run(userId, email, passwordHash, mustChange ? 1 : 0, new Date().toISOString());
  }

  updateCredentialEmail(userId: string, email: string) {
    this.db.prepare('UPDATE user_credentials SET email = ? WHERE user_id = ?').run(email, userId);
  }

  deleteCredentials(userId: string) {
    this.db.prepare('DELETE FROM user_credentials WHERE user_id = ?').run(userId);
  }

  recordFailedLogin(userId: string, maxAttempts: number, lockMs: number) {
    const cred = this.getCredentials(userId);
    if (!cred) return;
    const attempts = cred.failedAttempts + 1;
    const lockedUntil = attempts >= maxAttempts ? new Date(Date.now() + lockMs).toISOString() : null;
    this.db
      .prepare('UPDATE user_credentials SET failed_attempts = ?, locked_until = ? WHERE user_id = ?')
      .run(lockedUntil ? 0 : attempts, lockedUntil, userId);
  }

  resetFailedLogins(userId: string) {
    this.db.prepare('UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?').run(userId);
  }

  // --- Sessions ------------------------------------------------------------

  createSession(id: string, userId: string, ttlMs: number, ip: string | undefined, userAgent: string | undefined): SessionRecord {
    const now = new Date();
    const record = {
      id,
      userId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      lastSeenAt: now.toISOString(),
    };
    this.db
      .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, userId, record.createdAt, record.expiresAt, record.lastSeenAt, ip ?? null, (userAgent ?? '').slice(0, 300));
    return record;
  }

  getSession(id: string): SessionRecord | null {
    const r = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    if (!r) return null;
    return { id: r.id, userId: r.user_id, createdAt: r.created_at, expiresAt: r.expires_at, lastSeenAt: r.last_seen_at };
  }

  touchSession(id: string, ttlMs: number) {
    const now = new Date();
    this.db
      .prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .run(now.toISOString(), new Date(now.getTime() + ttlMs).toISOString(), id);
  }

  deleteSession(id: string) {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  /** Sessions that have not expired, newest activity first. */
  listSessions(nowIso: string): { id: string; userId: string; lastSeenAt: string; ip?: string; userAgent?: string }[] {
    return (this.db.prepare('SELECT id, user_id, last_seen_at, ip, user_agent FROM sessions WHERE expires_at > ? ORDER BY last_seen_at DESC').all(nowIso) as any[]).map((r) => ({
      id: r.id,
      userId: r.user_id,
      lastSeenAt: r.last_seen_at,
      ip: r.ip || undefined,
      userAgent: r.user_agent || undefined,
    }));
  }

  deleteUserSessions(userId: string, exceptSessionId?: string) {
    if (exceptSessionId) this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, exceptSessionId);
    else this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  // --- Web Push subscriptions ------------------------------------------------

  savePushSubscription(userId: string, sub: { endpoint: string; p256dh: string; auth: string }, userAgent: string | undefined) {
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent`
      )
      .run(sub.endpoint, userId, sub.p256dh, sub.auth, (userAgent ?? '').slice(0, 300), new Date().toISOString());
  }

  listPushSubscriptions(userId: string): PushSubscriptionRecord[] {
    return (this.db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY created_at').all(userId) as any[]).map((r) => ({
      endpoint: r.endpoint,
      userId: r.user_id,
      p256dh: r.p256dh,
      auth: r.auth,
      userAgent: r.user_agent || undefined,
      createdAt: r.created_at,
    }));
  }

  deletePushSubscription(endpoint: string, userId?: string) {
    if (userId) return this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, userId).changes;
    return this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint).changes;
  }

  deleteUserPushSubscriptions(userId: string) {
    this.db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
  }

  purgeExpiredSessions() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  }

  // --- Administration ------------------------------------------------------

  stats() {
    const tableNames = (
      this.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as {
        name: string;
      }[]
    ).map((t) => t.name);

    const tables = tableNames.map((name) => {
      const rowCount = (this.db.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get() as { n: number }).n;
      const columns = (this.db.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all() as { name: string }[]).map((c) => c.name);
      return { name, rowCount, columns };
    });

    const collections = this.db
      .prepare('SELECT collection AS name, COUNT(*) AS rowCount FROM entities WHERE deleted = 0 GROUP BY collection ORDER BY collection')
      .all() as { name: string; rowCount: number }[];

    let fileSizeBytes = 0;
    for (const suffix of ['', '-wal']) {
      try {
        fileSizeBytes += fs.statSync(this.filePath + suffix).size;
      } catch {
        // file may not exist (e.g. no WAL yet)
      }
    }

    return {
      engine: `SQLite ${(this.db.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v} (better-sqlite3, WAL)`,
      filePath: path.basename(this.filePath),
      fileSizeBytes,
      fileSizeFormatted: formatSize(fileSizeBytes),
      totalTables: tables.length,
      totalRows: tables.reduce((sum, t) => sum + t.rowCount, 0),
      tables,
      collections,
      lastSyncAt: new Date().toISOString(),
      isHealthy: this.isHealthy(),
    };
  }

  /** Consistent snapshot of the whole database as a Buffer. */
  serialize(): Buffer {
    return this.db.serialize();
  }

  /**
   * Run an ad-hoc query on a separate read-only connection. Only single, read-only,
   * row-returning statements are allowed; credential/session tables are off limits.
   */
  runReadOnlyQuery(sql: string, maxRows = 1000) {
    const started = Date.now();
    const trimmed = sql.trim().replace(/;\s*$/, '');
    if (!trimmed) throw new Error('الاستعلام فارغ');
    if (/\b(user_credentials|sessions|totp_secret)\b/i.test(trimmed)) {
      throw new Error('لا يُسمح بالاستعلام عن جداول بيانات الدخول والجلسات');
    }
    const ro = new Database(this.filePath, { readonly: true, fileMustExist: true });
    try {
      const stmt = ro.prepare(trimmed);
      if (!stmt.readonly || !stmt.reader) {
        throw new Error('وحدة الاستعلام للقراءة فقط: يُسمح بجمل SELECT فقط');
      }
      const columns = stmt.columns().map((c) => c.name);
      const values: unknown[][] = [];
      stmt.raw(true);
      for (const row of stmt.iterate() as Iterable<unknown[]>) {
        values.push(row);
        if (values.length >= maxRows) break;
      }
      return { columns, values, rowCount: values.length, executionTimeMs: Date.now() - started, truncated: values.length >= maxRows };
    } finally {
      ro.close();
    }
  }

  async createBackup(kind?: 'auto' | 'prerestore', retention = 20): Promise<DbBackupFileInfo> {
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const fileName = `newsroom_backup_${stamp}${kind ? `_${kind}` : ''}.sqlite`;
    const target = path.join(this.backupsDir, fileName);
    try {
      await this.db.backup(target);
      this.setMeta('backup_last_attempt', JSON.stringify({ at: now.toISOString(), status: 'ok' }));
    } catch (error) {
      this.setMeta('backup_last_attempt', JSON.stringify({ at: now.toISOString(), status: 'failed' }));
      throw error;
    }
    this.pruneBackups(retention);
    const stat = fs.statSync(target);
    return { fileName, sizeBytes: stat.size, sizeFormatted: formatSize(stat.size), createdAt: now.toISOString() };
  }

  private pruneBackups(retention: number) {
    const files = fs
      .readdirSync(this.backupsDir)
      .filter((f) => BACKUP_NAME_PATTERN.test(f))
      .sort();
    files.slice(0, Math.max(0, files.length - retention)).forEach((f) => {
      try {
        fs.unlinkSync(path.join(this.backupsDir, f));
      } catch (err) {
        logger.warn('failed to prune backup', { file: f, error: String(err) });
      }
    });
  }

  listBackups(): DbBackupFileInfo[] {
    return fs
      .readdirSync(this.backupsDir)
      .filter((f) => BACKUP_NAME_PATTERN.test(f))
      .sort()
      .reverse()
      .map((f) => {
        const stat = fs.statSync(path.join(this.backupsDir, f));
        return { fileName: f, sizeBytes: stat.size, sizeFormatted: formatSize(stat.size), createdAt: stat.mtime.toISOString() };
      });
  }

  backupFilePath(fileName: string) {
    if (!BACKUP_NAME_PATTERN.test(fileName)) throw new Error('اسم ملف النسخة الاحتياطية غير صالح');
    const source = path.join(this.backupsDir, fileName);
    if (!fs.existsSync(source)) throw new Error('ملف النسخة الاحتياطية غير موجود');
    if (!fs.lstatSync(source).isFile() || fs.lstatSync(source).isSymbolicLink()) throw new Error('ملف النسخة الاحتياطية غير صالح');
    return source;
  }

  async verifyBackup(fileName: string) {
    const source = this.backupFilePath(fileName);
    const probe = new Database(source, { readonly: true, fileMustExist: true });
    try {
      const integrity = probe.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new Error('النسخة الاحتياطية تالفة ولا يمكن استعادتها');
      const hasEntities = probe.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'entities'`).get();
      if (!hasEntities) throw new Error('النسخة الاحتياطية لا تنتمي إلى هذا الإصدار من النظام');
    } finally {
      probe.close();
    }
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(source)) hash.update(chunk);
    return { valid: true as const, fileName, checkedAt: new Date().toISOString(), sha256: hash.digest('hex') };
  }

  isKnownCollection(value: string) { return isCollectionName(value); }

  checkBackupSchema(probe: Database.Database) {
    const versions = (probe.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]).map(row => row.version);
    if (JSON.stringify(versions) !== JSON.stringify(MIGRATIONS.map(m => m.version))) throw new Error('Incompatible snapshot');
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    for (const { name } of tables) {
      const escaped = name.replace(/"/g, '""');
      const required = this.db.prepare(`PRAGMA table_info("${escaped}")`).all() as { name: string; type: string; pk: number }[];
      const actual = probe.prepare(`PRAGMA table_info("${escaped}")`).all() as typeof required;
      if (!required.every(column => actual.some(c => c.name === column.name && c.type === column.type && c.pk === column.pk))) throw new Error('Incompatible snapshot');
    }
  }

  /** Replace the live database with a validated backup (a safety backup is taken first). */
  async restoreBackup(fileName: string, retention = 20, expectedHash?: string, beforeReplace?: () => void) {
    await withStableBackup(this, fileName, path.join(this.dataDir, 'rehearsals'), async (source, sha256) => {
    if (expectedHash && expectedHash !== sha256) throw new Error('Snapshot changed');
    const probe = new Database(source, { readonly: true, fileMustExist: true });
    try {
      if (probe.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Invalid snapshot');
      this.checkBackupSchema(probe);
    } finally { probe.close(); }
    await this.createBackup('prerestore', retention);
    beforeReplace?.();
    this.db.close();
    try {
      for (const suffix of ['-wal', '-shm']) {
        if (fs.existsSync(this.filePath + suffix)) fs.unlinkSync(this.filePath + suffix);
      }
      // Same-volume rename never leaves a partially overwritten live database.
      fs.renameSync(source, this.filePath);
    } finally {
      this.open();
    }
    // Clients must re-bootstrap after a restore.
    this.transaction(() => {
      const rev = this.nextRev();
      this.db.prepare(`UPDATE meta SET value = ? WHERE key = 'tombstone_floor'`).run(String(rev));
    });
    });
  }
}
