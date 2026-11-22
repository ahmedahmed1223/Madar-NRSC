import { createHash } from 'node:crypto';

// Derived search indexes and per-engine migration ledgers are built on the destination.
const TABLE_KEYS = {
  meta: ['key'],
  entities: ['collection', 'id'],
  user_credentials: ['user_id'],
  sessions: ['id'],
  uploads: ['id'],
  entity_history: ['collection', 'entity_id', 'version'],
  push_subscriptions: ['endpoint'],
  upload_copies: ['upload_id', 'target'],
  share_index: ['path'],
  share_fetches: ['upload_id'],
  work_reminders: ['collection', 'entity_id', 'slot', 'kind'],
} as const;

export const TRANSFER_TABLES = Object.keys(TABLE_KEYS) as (keyof typeof TABLE_KEYS)[];

type Engine = 'sqlite' | 'postgresql';
type Row = Record<string, string | number | null | Uint8Array>;
type TransferTable = keyof typeof TABLE_KEYS;

export interface TransferStore {
  prepare(sql: string): { all(...parameters: unknown[]): unknown[]; run(...parameters: unknown[]): unknown };
  transaction<R>(callback: () => R): () => R;
}

export interface TransferEvidence {
  tables: { name: TransferTable; rows: number; sha256: string }[];
}

const PAGE_SIZE = 128;
const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

function* tablePages(store: TransferStore, engine: Engine, table: TransferTable) {
  const keys = TABLE_KEYS[table];
  const order = keys.map(key => key === 'version' ? identifier(key)
    : `${identifier(key)} COLLATE ${engine === 'postgresql' ? '"C"' : 'BINARY'}`).join(', ');
  let previous: Row | undefined;
  for (;;) {
    const after = previous ? `WHERE (${order}) > (${keys.map(() => '?').join(', ')})` : '';
    const rows = store.prepare(`SELECT * FROM ${identifier(table)} ${after} ORDER BY ${order} LIMIT ${PAGE_SIZE}`)
      .all(...(previous ? keys.map(key => previous![key]) : [])) as Row[];
    if (!rows.length) return;
    yield rows;
    if (rows.length < PAGE_SIZE) return;
    previous = rows[rows.length - 1];
  }
}

function measureTable(store: TransferStore, engine: Engine, table: TransferTable, copy?: (rows: Row[]) => void) {
  const checksum = createHash('sha256');
  let rows = 0;
  for (const page of tablePages(store, engine, table)) {
    for (const row of page) {
      const values = Object.keys(row).sort().map(key => {
        const value = row[key];
        return [key, value instanceof Uint8Array ? { bytes: Buffer.from(value).toString('base64') } : value];
      });
      checksum.update(JSON.stringify(values) + '\n');
    }
    copy?.(page);
    rows += page.length;
  }
  return { name: table, rows, sha256: checksum.digest('hex') };
}

function insertPage(store: TransferStore, table: TransferTable, rows: Row[]) {
  const columns = Object.keys(rows[0]);
  const tuple = `(${columns.map(() => '?').join(', ')})`;
  store.prepare(`INSERT INTO ${identifier(table)} (${columns.map(identifier).join(', ')}) VALUES ${rows.map(() => tuple).join(', ')}`)
    .run(...rows.flatMap(row => columns.map(column => row[column])));
}

/** The caller owns the destination and must have stopped the source's writers. */
export function transferDatabase(source: TransferStore, sourceEngine: Engine, destination: TransferStore, destinationEngine: Engine,
  selectedTables: readonly TransferTable[] = TRANSFER_TABLES): TransferEvidence {
  if (source === destination) throw new Error('The source and destination of a database transfer must differ');
  return source.transaction(() => destination.transaction(() => {
    for (const table of [...selectedTables].reverse()) destination.prepare(`DELETE FROM ${identifier(table)}`).run();
    const tables = selectedTables.map(table => {
      const original = measureTable(source, sourceEngine, table, rows => insertPage(destination, table, rows));
      const imported = measureTable(destination, destinationEngine, table);
      if (original.rows !== imported.rows || original.sha256 !== imported.sha256) {
        throw new Error(`Database transfer verification failed for ${table}`);
      }
      return imported;
    });
    return { tables };
  })())();
}
