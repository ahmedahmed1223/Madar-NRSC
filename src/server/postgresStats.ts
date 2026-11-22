import type { PostgresDatabase } from './postgres/driver';
import { TRANSFER_TABLES } from './databaseTransfer';

export function postgresStorageStats(db: PostgresDatabase) {
  const version = db.query('SHOW server_version').rows[0]?.server_version;
  const columns = db.query(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position`).rows;
  const sizes = db.query(`SELECT COALESCE(SUM(pg_total_relation_size(t.oid)), 0) AS bytes
    FROM pg_class AS t JOIN pg_namespace AS s ON s.oid = t.relnamespace
    WHERE s.nspname = current_schema() AND t.relkind = 'r'`).rows;
  const tables = TRANSFER_TABLES.map(name => ({
    name,
    rowCount: Number(db.query(`SELECT COUNT(*) AS count FROM "${name}"`).rows[0]?.count ?? 0),
    columns: columns.filter(row => row.table_name === name).map(row => String(row.column_name)),
  }));
  const collections = db.query('SELECT collection AS name, COUNT(*) AS "rowCount" FROM entities\n    WHERE deleted = 0 GROUP BY collection ORDER BY collection').rows as { name: string; rowCount: number }[];
  return { engine: `PostgreSQL ${String(version || '')}`.trim(), tables, collections, fileSizeBytes: Number(sizes[0]?.bytes ?? 0) };
}
