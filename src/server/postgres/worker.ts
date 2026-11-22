import type { MessagePort } from 'node:worker_threads';
import type { Client as PgClient, QueryConfig } from 'pg';

export type WorkerOptions = {
  port: MessagePort;
  signal: SharedArrayBuffer;
  pgPath: string;
  connectionString: string;
  schema: string;
  acquireAppLock: boolean;
  timeoutMs: number;
};

export type PostgresRequest =
  | { kind: 'connect' }
  | { kind: 'close' }
  | { kind: 'query'; text: string; values: unknown[]; rowMode?: 'array' }
  | { kind: 'exec'; text: string };

export type PostgresResult<T = Record<string, unknown>> = {
  command: string;
  rows: T[];
  rowCount: number;
  fields: { name: string; dataTypeID: number }[];
};

export type PostgresResponse =
  | { ok: true; result?: PostgresResult }
  | { ok: false; code: string };

// This function is the entire worker entry point. Keeping its dependencies
// inside the function allows the same entry point in tsx and the CJS bundle.
function runPostgresWorker() {
  // The eval worker is CommonJS even when its parent is an ES module.
  const load: NodeRequire = require;
  const options: WorkerOptions = load('node:worker_threads').workerData;
  const signal = new Int32Array(options.signal);
  const { port } = options;
  let client: PgClient | undefined;
  let connected = false;

  async function connect() {
    const pg: typeof import('pg') = load(options.pgPath);
    const parseNumber = (value: string) => {
      const number = Number(value);
      return Number.isFinite(number) && Math.abs(number) <= Number.MAX_SAFE_INTEGER ? number : value;
    };
    pg.types.setTypeParser(20, parseNumber); // bigint, including COUNT
    pg.types.setTypeParser(1700, parseNumber); // numeric, including SUM(bigint)
    const serverTimeout = Math.max(50, Math.floor(options.timeoutMs * 0.75));
    client = new pg.Client({
      connectionString: options.connectionString,
      application_name: 'madar-nrcs',
      connectionTimeoutMillis: Math.max(50, Math.floor(options.timeoutMs / 2)),
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });
    client.on('error', () => { connected = false; });
    await client.connect();
    await client.query(`SELECT
      pg_catalog.set_config('statement_timeout', $1, false),
      pg_catalog.set_config('lock_timeout', $2, false),
      pg_catalog.set_config('idle_in_transaction_session_timeout', $1, false),
      pg_catalog.set_config('TimeZone', 'UTC', false),
      pg_catalog.set_config('search_path', pg_catalog.quote_ident($3), false)`,
    [String(serverTimeout), String(Math.min(2_000, serverTimeout)), options.schema]);
    if (options.acquireAppLock) {
      const { rows } = await client.query(`SELECT pg_catalog.pg_try_advisory_lock(
        pg_catalog.hashtext(pg_catalog.current_database()), pg_catalog.hashtext('madar-writer:' || $1::text)) AS acquired`, [options.schema]);
      if (!rows[0]?.acquired) return { ok: false, code: 'WRITER_LOCKED' } as const;
    }
    connected = true;
    return { ok: true } as const;
  }

  port.on('message', async (request: PostgresRequest) => {
    let response: PostgresResponse;
    try {
      if (request.kind === 'connect') {
        response = await connect();
      } else if (request.kind === 'close') {
        connected = false;
        await client?.end();
        response = { ok: true };
      } else if (!connected || !client) {
        response = { ok: false, code: 'CONNECTION_LOST' };
      } else if (request.kind === 'exec') {
        await client.query(request.text);
        response = { ok: true };
      } else {
        const query: QueryConfig & { rowMode?: 'array'; queryMode: 'extended' } = {
          text: request.text,
          values: request.values,
          rowMode: request.rowMode,
          queryMode: 'extended',
        };
        const { command, rows, rowCount, fields } = await client.query(query);
        response = { ok: true, result: { command, rows, rowCount: rowCount ?? 0, fields } };
      }
    } catch (error) {
      // Database errors can include row values, SQL, and connection metadata.
      const rawCode = (error as { code?: unknown })?.code;
      const code = typeof rawCode === 'string' && /^[0-9A-Z]{5}$/.test(rawCode)
        ? rawCode
        : request.kind === 'connect' ? 'CONNECT_FAILED' : 'CONNECTION_LOST';
      response = { ok: false, code };
    }
    port.postMessage(response);
    Atomics.store(signal, 0, 1);
    Atomics.notify(signal, 0);
    if (request.kind === 'close') port.close();
  });
}

// tsx may annotate internal function names as it transpiles TypeScript.
export const postgresWorkerSource = `const __name = value => value; (${runPostgresWorker.toString()})();`;
