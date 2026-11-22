import { SETTLED_NEWS_STATUSES } from '../../shared/collections';
import type { PostgresDatabase } from './driver';

export const POSTGRES_SCHEMA_VERSION = 1;

// Keep raw payloads and timestamps reversible. SQLite BINARY and PostgreSQL C
// both compare UTF-8 byte order, which also keeps transfer pagination stable.
const baseline = `
  CREATE TABLE meta (
    key TEXT COLLATE "C" PRIMARY KEY,
    value TEXT COLLATE "C" NOT NULL
  );
  INSERT INTO meta (key, value) VALUES ('rev', '0'), ('tombstone_floor', '0');

  CREATE TABLE entities (
    collection TEXT COLLATE "C" NOT NULL,
    id TEXT COLLATE "C" NOT NULL,
    data TEXT COLLATE "C" NOT NULL,
    position DOUBLE PRECISION NOT NULL DEFAULT 0,
    version BIGINT NOT NULL DEFAULT 1,
    rev BIGINT NOT NULL,
    deleted SMALLINT NOT NULL DEFAULT 0,
    created_at TEXT COLLATE "C" NOT NULL,
    updated_at TEXT COLLATE "C" NOT NULL,
    updated_by TEXT COLLATE "C",
    PRIMARY KEY (collection, id)
  );
  CREATE INDEX idx_entities_rev ON entities (rev);
  CREATE INDEX idx_entities_collection ON entities (collection, deleted, position);

  CREATE TABLE user_credentials (
    user_id TEXT COLLATE "C" PRIMARY KEY,
    email TEXT COLLATE "C" NOT NULL,
    password_hash TEXT NOT NULL,
    must_change_password SMALLINT NOT NULL DEFAULT 0,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT COLLATE "C",
    password_changed_at TEXT COLLATE "C" NOT NULL,
    totp_secret TEXT,
    totp_enabled SMALLINT NOT NULL DEFAULT 0,
    totp_last_counter BIGINT NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX idx_credentials_email ON user_credentials (lower(email));

  CREATE TABLE sessions (
    id TEXT COLLATE "C" PRIMARY KEY,
    user_id TEXT COLLATE "C" NOT NULL,
    created_at TEXT COLLATE "C" NOT NULL,
    expires_at TEXT COLLATE "C" NOT NULL,
    last_seen_at TEXT COLLATE "C" NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX idx_sessions_user ON sessions (user_id);
  CREATE INDEX idx_sessions_expires ON sessions (expires_at);

  CREATE TABLE uploads (
    id TEXT COLLATE "C" PRIMARY KEY,
    stored_name TEXT COLLATE "C" NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    uploaded_by TEXT COLLATE "C" NOT NULL,
    created_at TEXT COLLATE "C" NOT NULL,
    local_evicted SMALLINT NOT NULL DEFAULT 0,
    scope TEXT COLLATE "C" NOT NULL DEFAULT 'legacy' CHECK (scope IN ('media', 'chat', 'legacy'))
  );
  CREATE TABLE entity_history (
    collection TEXT COLLATE "C" NOT NULL,
    entity_id TEXT COLLATE "C" NOT NULL,
    version BIGINT NOT NULL,
    data TEXT COLLATE "C" NOT NULL,
    changed_by TEXT COLLATE "C",
    changed_by_name TEXT,
    changed_at TEXT COLLATE "C" NOT NULL,
    PRIMARY KEY (collection, entity_id, version)
  );
  CREATE TABLE push_subscriptions (
    endpoint TEXT COLLATE "C" PRIMARY KEY,
    user_id TEXT COLLATE "C" NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at TEXT COLLATE "C" NOT NULL,
    last_ok_at TEXT COLLATE "C"
  );
  CREATE INDEX idx_push_user ON push_subscriptions (user_id);

  CREATE TABLE upload_copies (
    upload_id TEXT COLLATE "C" NOT NULL,
    target TEXT COLLATE "C" NOT NULL,
    state TEXT COLLATE "C" NOT NULL,
    remote_path TEXT COLLATE "C",
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT COLLATE "C",
    updated_at TEXT COLLATE "C" NOT NULL,
    PRIMARY KEY (upload_id, target)
  );
  CREATE INDEX idx_upload_copies_state ON upload_copies (target, state);
  CREATE TABLE share_index (
    path TEXT COLLATE "C" PRIMARY KEY,
    name TEXT COLLATE "C" NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    modified_at TEXT COLLATE "C",
    seen_at TEXT COLLATE "C" NOT NULL
  );
  CREATE INDEX idx_share_index_name ON share_index (name);
  CREATE TABLE share_fetches (
    upload_id TEXT COLLATE "C" PRIMARY KEY,
    state TEXT COLLATE "C" NOT NULL,
    error TEXT,
    requested_at TEXT COLLATE "C" NOT NULL,
    updated_at TEXT COLLATE "C" NOT NULL
  );
  CREATE TABLE work_reminders (
    collection TEXT COLLATE "C" NOT NULL CHECK (collection IN ('tasks', 'productionCards')),
    entity_id TEXT COLLATE "C" NOT NULL,
    slot TEXT COLLATE "C" NOT NULL,
    kind TEXT COLLATE "C" NOT NULL CHECK (kind IN ('deadline', 'overdue')),
    user_id TEXT COLLATE "C" NOT NULL,
    fire_at TEXT COLLATE "C" NOT NULL,
    enabled SMALLINT NOT NULL,
    sent_at TEXT COLLATE "C",
    PRIMARY KEY (collection, entity_id, slot, kind)
  );
  CREATE INDEX idx_work_reminders_pending ON work_reminders (fire_at)
    WHERE enabled = 1 AND sent_at IS NULL;

  CREATE FUNCTION madar_json_flag(payload TEXT, field TEXT) RETURNS NUMERIC
    LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE
    SET search_path = pg_catalog
    AS $$
      SELECT CASE
        WHEN flag IS NULL OR json_typeof(flag) = 'null' THEN NULL
        WHEN json_typeof(flag) = 'boolean' THEN CASE WHEN flag::text = 'true' THEN 1 ELSE 0 END
        WHEN json_typeof(flag) = 'number' THEN flag::text::numeric
        ELSE -1
      END
      FROM (SELECT payload::json -> field AS flag) AS input;
    $$;
  CREATE INDEX idx_news_archive_updated ON entities (updated_at DESC, id)
    WHERE collection = 'news' AND deleted = 0
      AND (data::json ->> 'status') IN (${SETTLED_NEWS_STATUSES.map(status => "'" + status + "'").join(', ')})
      AND (data::json ->> 'deletedAt') IS NULL;
  CREATE INDEX idx_message_channel_timestamp ON entities
    ((data::json ->> 'channel'), (data::json ->> 'timestamp') DESC)
    WHERE collection = 'messages' AND deleted = 0;
  CREATE INDEX idx_personal_tasks_owner ON entities ((data::json ->> 'ownerId'))
    WHERE collection = 'personalTasks' AND deleted = 0;
  CREATE INDEX idx_personal_tasks_reminder ON entities ((data::json ->> 'reminderAt'))
    WHERE collection = 'personalTasks' AND deleted = 0 AND madar_json_flag(data, 'completed') = 0
      AND (data::json ->> 'reminderAt') IS NOT NULL AND (data::json ->> 'reminderSentFor') IS NULL;

  CREATE FUNCTION madar_julianday(value TEXT) RETURNS DOUBLE PRECISION
    LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path = pg_catalog
    SET timezone = 'UTC'
    AS $$
    BEGIN
      IF value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([ T][0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]+)?)?([zZ]|[+-][0-9]{2}:[0-9]{2})?)?$' THEN
        RETURN NULL;
      END IF;
      RETURN extract(epoch FROM value::timestamptz)::double precision / 86400 + 2440587.5;
    EXCEPTION
      WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_time_zone_displacement_value THEN
        RETURN NULL;
    END;
  $$;

  CREATE TABLE news_archive_index (
    id TEXT COLLATE "C" PRIMARY KEY,
    prepared BYTEA NOT NULL,
    terms TEXT COLLATE "C" NOT NULL
  );

  CREATE FUNCTION madar_delete_work_reminders() RETURNS TRIGGER
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        DELETE FROM work_reminders WHERE collection = OLD.collection AND entity_id = OLD.id;
      ELSE
        DELETE FROM work_reminders WHERE collection = NEW.collection AND entity_id = NEW.id;
      END IF;
      RETURN NULL;
    END;
  $$;
  CREATE TRIGGER work_reminders_tombstone AFTER UPDATE OF deleted ON entities
    FOR EACH ROW WHEN (NEW.deleted = 1 AND NEW.collection IN ('tasks', 'productionCards'))
    EXECUTE FUNCTION madar_delete_work_reminders();
  CREATE TRIGGER work_reminders_delete AFTER DELETE ON entities
    FOR EACH ROW WHEN (OLD.collection IN ('tasks', 'productionCards'))
    EXECUTE FUNCTION madar_delete_work_reminders();
`;

export function initializePostgresSchema(db: PostgresDatabase): void {
  db.transaction(() => {
    // Existing schemas can be used by roles without CREATE on the database.
    const exists = db.query('SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1', [db.schema]).rows.length > 0;
    if (!exists) db.exec(`CREATE SCHEMA "${db.schema}"`);
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const { rows } = db.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version');
    if (rows.length === 0) {
      db.exec(baseline);
      db.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)', [POSTGRES_SCHEMA_VERSION, new Date().toISOString()]);
    } else if (rows.length !== 1 || rows[0].version !== POSTGRES_SCHEMA_VERSION) {
      throw new Error('Incompatible PostgreSQL schema version');
    }
    const operator = db.query<{ operator_class: string }>(`
      SELECT pg_catalog.format('%I.gin_trgm_ops', n.nspname) AS operator_class
      FROM pg_catalog.pg_extension AS e JOIN pg_catalog.pg_namespace AS n ON n.oid = e.extnamespace
      WHERE e.extname = 'pg_trgm'
    `).rows[0]?.operator_class;
    if (operator) db.exec(`CREATE INDEX IF NOT EXISTS idx_news_archive_terms ON news_archive_index USING gin (terms ${operator})`);
  })();
}
