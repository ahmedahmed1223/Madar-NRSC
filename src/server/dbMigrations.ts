import { SETTLED_NEWS_STATUSES } from '../shared/collections';

/** Prototype tables no longer serve as authoritative data. */
const LEGACY_TABLES = ['news', 'programs', 'episodes', 'rundown_segments', 'guests', 'tasks', 'media_assets', 'audit_logs', 'system_settings'];

export const SETTLED_SQL = SETTLED_NEWS_STATUSES.map((s) => `'${s}'`).join(', ');
export const ARCHIVE_FILTER = `collection = 'news' AND deleted = 0 AND json_extract(data, '$.status') IN (${SETTLED_SQL})
  AND json_extract(data, '$.deletedAt') IS NULL`;

export const MIGRATIONS: { version: number; sql: string }[] = [
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
  {
    version: 6,
    sql: `
      CREATE INDEX IF NOT EXISTS idx_news_archive_updated ON entities (updated_at DESC, id)
        WHERE ${ARCHIVE_FILTER};
      CREATE INDEX IF NOT EXISTS idx_message_channel_timestamp ON entities
        (json_extract(data, '$.channel'), json_extract(data, '$.timestamp') DESC)
        WHERE collection = 'messages' AND deleted = 0;

      ALTER TABLE uploads ADD COLUMN scope TEXT NOT NULL DEFAULT 'legacy'
        CHECK (scope IN ('media', 'chat', 'legacy'));
      WITH media_urls(url) AS (
        SELECT json_extract(data, '$.url') FROM entities WHERE collection = 'media' AND deleted = 0
        UNION ALL
        SELECT json_extract(data, '$.fileUrl') FROM entities WHERE collection = 'media' AND deleted = 0
      ), paths(path) AS (
        SELECT substr(url, length('/api/v1/media/files/') + 1) FROM media_urls
        WHERE url LIKE '/api/v1/media/files/%'
      ), linked_uploads(id) AS (
        SELECT substr(path, 1, instr(replace(path, '#', '?') || '?', '?') - 1) FROM paths
        UNION ALL SELECT upload_id FROM upload_copies
      )
      UPDATE uploads SET scope = 'media' WHERE id IN (SELECT id FROM linked_uploads);

      UPDATE uploads SET scope = 'chat' WHERE id IN (
        SELECT CASE WHEN attachment.type = 'object' THEN json_extract(attachment.value, '$.id') END
        FROM entities AS message, json_each(message.data, '$.attachments') AS attachment
        WHERE message.collection = 'messages' AND message.deleted = 0
      );
    `,
  },
];
