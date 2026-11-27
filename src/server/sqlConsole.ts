import Database from 'better-sqlite3';
import { transferDatabase } from './databaseTransfer';
import { PostgresDatabase } from './postgres/driver';
import { openSqliteDatabase } from './sqliteDatabase';

const exposedTables = ['entities', 'uploads', 'entity_history', 'upload_copies', 'share_index', 'share_fetches', 'work_reminders'] as const;

/** The query runs on a detached, disposable snapshot that contains only approved operational tables. */
export function readConsoleQuery(database: Database.Database | PostgresDatabase, sql: string, maxRows: number) {
  const started = Date.now();
  const query = sql.trim();
  if (!/^(SELECT|WITH)\b/i.test(query)) throw new Error('وحدة الاستعلام للقراءة فقط: يُسمح بجمل SELECT فقط');
  const snapshot = new Database(':memory:');
  try {
    if (database instanceof PostgresDatabase) {
      // Create only the approved tables with the SQLite schema used for cross-engine transfers.
      const schema = openSqliteDatabase(':memory:', false);
      try {
        const definition = schema.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?").pluck();
        for (const table of exposedTables) snapshot.exec(definition.get(table) as string);
      } finally { schema.close(); }
      transferDatabase(database, 'postgresql', snapshot, 'sqlite', exposedTables);
    } else {
      snapshot.prepare('ATTACH DATABASE ? AS source').run(database.name);
      snapshot.transaction(() => {
        for (const table of exposedTables) snapshot.exec(`CREATE TABLE "${table}" AS SELECT * FROM source."${table}"`);
      })();
      snapshot.exec('DETACH DATABASE source');
    }
    snapshot.pragma('query_only = ON');
    const statement = snapshot.prepare(query);
    if (!statement.readonly || !statement.reader) throw new Error('وحدة الاستعلام للقراءة فقط: يُسمح بجمل SELECT فقط');
    const columns = statement.columns().map(column => column.name);
    const values: unknown[][] = [];
    statement.raw(true);
    for (const row of statement.iterate() as Iterable<unknown[]>) {
      values.push(row);
      if (values.length >= maxRows) break;
    }
    return { columns, values, rowCount: values.length, executionTimeMs: Date.now() - started, truncated: values.length >= maxRows };
  } finally {
    snapshot.close();
  }
}
