import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

describe('PostgreSQL statement bindings', () => {
  it('binds only SQL placeholders and reuses named parameter positions', async () => {
    const { compilePostgresStatement } = await import('../../src/server/postgres/statements');
    const sql = `SELECT '@unused ?', "@identifier", $$@dollar ?$$, @id, @id
      FROM entities -- @comment ?
      WHERE collection = @collection`;
    const statement = compilePostgresStatement(sql);
    expect(statement.text).toBe(`SELECT '@unused ?', "@identifier", $$@dollar ?$$, $1, $1
      FROM entities -- @comment ?
      WHERE collection = $2`);
    expect(statement.bind([{ collection: 'news', id: 'خبر', ignored: 4 }])).toEqual(['خبر', 'news']);
  });

  it('rejects missing parameters and preserves explicit null values', async () => {
    const { compilePostgresStatement } = await import('../../src/server/postgres/statements');
    expect(compilePostgresStatement('SELECT ?, ?').bind([null, 0])).toEqual([null, 0]);
    expect(() => compilePostgresStatement('SELECT @id').bind([{}])).toThrow(/missing/i);
    expect(() => compilePostgresStatement('SELECT ?').bind(['one', 'two'])).toThrow(/expected 1/i);
  });

  it('ports scalar JSON paths and predicates with SQLite integer booleans', async () => {
    const { compilePostgresStatement } = await import('../../src/server/postgres/statements');
    const statement = compilePostgresStatement(`SELECT json_extract(n.data, '$.title') AS storyTitle
      FROM entities n WHERE COALESCE(json_extract(n.data, '$.isActive'), 1) = 1 AND n.id = ?`);
    expect(statement.text).toContain(`(n.data::json ->> 'title') AS "storyTitle"`);
    expect(statement.text).toContain(`COALESCE(madar_json_flag(n.data, 'isActive'), 1) = 1`);
    expect(statement.text).toContain('n.id = $1');
  });

  it('retains the text revision representation while incrementing a bigint', async () => {
    const { compilePostgresStatement } = await import('../../src/server/postgres/statements');
    expect(compilePostgresStatement(`UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev' RETURNING value`).text)
      .toBe(`UPDATE meta SET value = (CAST(value AS BIGINT) + 1)::text WHERE key = 'rev' RETURNING value`);
  });

  it('continues using case-insensitive credential lookups', async () => {
    const { compilePostgresStatement } = await import('../../src/server/postgres/statements');
    expect(compilePostgresStatement('SELECT * FROM user_credentials WHERE email = ?').text)
      .toBe('SELECT * FROM user_credentials WHERE lower(email) = lower($1)');
  });
});

describe('PostgreSQL worker startup', () => {
  it('bounds an unreachable connection and keeps the connection string private', async () => {
    const { PostgresDatabase } = await import('../../src/server/postgres/driver');
    let failure: unknown;
    const started = Date.now();
    try {
      new PostgresDatabase('postgresql://demo-user:private-test-password@127.0.0.1:1/isolated', { timeoutMs: 1_000 });
    } catch (error) {
      failure = error;
    }
    expect(['CONNECT_FAILED', 'WORKER_TIMEOUT']).toContain((failure as { code?: string })?.code);
    expect(String(failure)).not.toContain('private-test-password');
    expect(Date.now() - started).toBeLessThan(2_500);
  });
});

const testUrl = process.env.POSTGRES_TEST_URL;
describe.skipIf(!testUrl)('PostgreSQL wire integration', () => {
  it('creates authoritative tables and recovers the outer transaction after a savepoint error', async () => {
    const { PostgresDatabase } = await import('../../src/server/postgres/driver');
    const { initializePostgresSchema } = await import('../../src/server/postgres/schema');
    const schema = 'madar_driver_test_' + randomBytes(8).toString('hex');
    const db = new PostgresDatabase(testUrl!, { schema });
    try {
      initializePostgresSchema(db);
      // Simulate the previous schema with real stored data and verify incremental startup.
      db.exec("DROP INDEX idx_news_scheduled; DELETE FROM schema_migrations WHERE version = 2; INSERT INTO meta(key, value) VALUES ('migration-check', 'preserve')");
      initializePostgresSchema(db);
      expect(db.query('SELECT version FROM schema_migrations ORDER BY version').rows)
        .toEqual([{ version: 1 }, { version: 2 }]);
      expect(db.query("SELECT value FROM meta WHERE key = 'migration-check'").rows).toEqual([{ value: 'preserve' }]);
      expect(db.query("SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = 'idx_news_scheduled'", [schema]).rows).toHaveLength(1);
      const tables = db.query<{ tablename: string }>(
        'SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = $1 ORDER BY tablename', [schema],
      ).rows.map(row => row.tablename);
      expect(tables).toEqual([
        'entities', 'entity_history', 'meta', 'news_archive_index', 'push_subscriptions', 'schema_migrations',
        'sessions', 'share_fetches', 'share_index', 'upload_copies', 'uploads', 'user_credentials', 'work_reminders',
      ]);

      db.transaction(() => {
        const insert = db.prepare('INSERT INTO meta(key, value) VALUES (@key, @value)');
        expect(insert.run({ key: 'test', value: 'أول' }).changes).toBe(1);
        expect(() => db.transaction(() => {
          insert.run({ key: 'inner', value: 'roll back' });
          insert.run({ key: 'test', value: 'duplicate' });
        })()).toThrow(/23505/);
        insert.run({ key: 'outer', value: 'آخر' });
      })();
      expect(db.query("SELECT COUNT(*) AS total FROM meta WHERE key IN ('test', 'inner', 'outer')").rows).toEqual([{ total: 2 }]);
      expect(db.query("SELECT value FROM meta WHERE key = 'test'").rows).toEqual([{ value: 'أول' }]);

      const bytes = Buffer.from([0, 2, 255]);
      db.query("INSERT INTO news_archive_index (id, prepared, terms) VALUES ('test', $1, 'غزة')", [bytes]);
      expect(db.query('SELECT prepared FROM news_archive_index').rows[0].prepared).toEqual(bytes);
      expect(db.query("SELECT madar_julianday('broken') AS bad, madar_julianday('1970-01-01T01:00:00+01:00') AS epoch").rows)
        .toEqual([{ bad: null, epoch: 2440587.5 }]);
    } finally {
      try { db.exec(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
      finally { db.close(); }
    }
  });

  it('enforces one writer per schema and releases its lock on close', async () => {
    const { PostgresDatabase } = await import('../../src/server/postgres/driver');
    const schema = 'madar_driver_test_' + randomBytes(8).toString('hex');
    const db = new PostgresDatabase(testUrl!, { schema });
    try {
      expect(() => new PostgresDatabase(testUrl!, { schema })).toThrow(/writer lock/i);
      const separate = new PostgresDatabase(testUrl!, { schema: schema + '_other' });
      separate.close();
    } finally {
      db.close();
    }
    const reopened = new PostgresDatabase(testUrl!, { schema });
    reopened.close();
  });
});
