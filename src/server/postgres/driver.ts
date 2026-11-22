import { createRequire } from 'node:module';
import path from 'node:path';
import { MessageChannel, receiveMessageOnPort, Worker, type MessagePort } from 'node:worker_threads';
import { compilePostgresStatement } from './statements';
import { postgresWorkerSource, type PostgresRequest, type PostgresResponse, type PostgresResult, type WorkerOptions } from './worker';

type PostgresOptions = { schema?: string; acquireAppLock?: boolean; timeoutMs?: number };
export type { PostgresResult } from './worker';

const messages: Record<string, string> = {
  DRIVER_MISSING: 'The PostgreSQL driver could not be loaded',
  CONNECT_FAILED: 'Could not connect to PostgreSQL',
  CONNECTION_LOST: 'The PostgreSQL connection is unavailable. Restart the server before retrying',
  WORKER_TIMEOUT: 'The PostgreSQL operation timed out. Its outcome may be unknown. Restart the server before retrying',
  WRITER_LOCKED: 'Another MADAR server already owns the PostgreSQL writer lock for this schema',
  '28P01': 'PostgreSQL authentication failed',
  '3D000': 'The configured PostgreSQL database does not exist',
  '42501': 'The PostgreSQL role lacks permission for this operation',
  '55P03': 'The PostgreSQL lock wait expired',
  '57014': 'The PostgreSQL statement was canceled or reached its time limit',
};

export class PostgresError extends Error {
  constructor(readonly code: string) {
    super(messages[code] || `PostgreSQL rejected the operation (${code})`);
    this.name = 'PostgresError';
  }
}

/** One PostgreSQL session and one outstanding RPC at a time. */
export class PostgresDatabase {
  readonly schema: string;
  private readonly timeoutMs: number;
  private readonly port: MessagePort;
  private readonly worker: Worker;
  private readonly signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  private closed = false;
  private transactionDepth = 0;

  constructor(connectionString: string, options: PostgresOptions = {}) {
    this.schema = options.schema ?? 'public';
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(this.schema) || /^(pg_|information_schema$)/.test(this.schema)) {
      throw new Error('Invalid PostgreSQL schema name');
    }
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 120_000) {
      throw new Error('Invalid PostgreSQL operation timeout');
    }
    let pgPath: string;
    try {
      const requireFromServer = createRequire(typeof __filename === 'string' ? __filename : path.resolve('package.json'));
      pgPath = requireFromServer.resolve('pg');
    } catch {
      throw new PostgresError('DRIVER_MISSING');
    }
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    const workerData: WorkerOptions = {
      port: port2, signal: this.signal.buffer as SharedArrayBuffer, pgPath, connectionString,
      schema: this.schema, acquireAppLock: options.acquireAppLock ?? true, timeoutMs: this.timeoutMs,
    };
    try {
      this.worker = new Worker(postgresWorkerSource, { eval: true, execArgv: [], transferList: [port2], workerData });
    } catch {
      port1.close();
      port2.close();
      throw new PostgresError('CONNECT_FAILED');
    }
    this.worker.on('error', () => this.dispose());
    this.worker.on('exit', () => this.dispose());
    this.worker.unref();
    try {
      this.request({ kind: 'connect' });
    } catch (error) {
      this.close();
      throw error;
    }
  }

  get open() { return !this.closed; }

  close() {
    if (this.closed) return;
    try { this.request({ kind: 'close' }); }
    catch { /* A failed session is terminated below. */ }
    finally { this.dispose(); }
  }

  private dispose() {
    if (this.closed) return;
    this.closed = true;
    this.port.close();
    void this.worker.terminate().catch(() => {});
  }

  private request(request: PostgresRequest): PostgresResult | undefined {
    if (this.closed) throw new PostgresError('CONNECTION_LOST');
    Atomics.store(this.signal, 0, 0);
    this.port.postMessage(request);
    // The worker gets the server result before notifying this synchronous caller.
    // An expired operation can have reached COMMIT, so never reconnect or replay here.
    if (Atomics.wait(this.signal, 0, 0, this.timeoutMs) === 'timed-out') {
      this.dispose();
      throw new PostgresError('WORKER_TIMEOUT');
    }
    const response = receiveMessageOnPort(this.port)?.message as PostgresResponse | undefined;
    if (!response) {
      this.dispose();
      throw new PostgresError('CONNECTION_LOST');
    }
    if (response.ok === false) {
      if (response.code === 'CONNECTION_LOST') this.dispose();
      throw new PostgresError(response.code);
    }
    return response.result;
  }

  exec(text: string) { this.request({ kind: 'exec', text }); }

  query<T = Record<string, unknown>>(text: string, values: unknown[] = [], rowMode?: 'array'): PostgresResult<T> {
    const result = this.request({ kind: 'query', text, values, rowMode })!;
    // MessagePort structured cloning turns Buffers into Uint8Arrays.
    for (const [index, field] of result.fields.entries()) {
      if (field.dataTypeID !== 17) continue; // bytea
      for (const row of result.rows) {
        const key = rowMode === 'array' ? index : field.name;
        const value = row[key];
        if (value instanceof Uint8Array) row[key] = Buffer.from(value);
      }
    }
    return result as PostgresResult<T>;
  }

  prepare(text: string) {
    const statement = compilePostgresStatement(text);
    const execute = (...args: unknown[]) => this.query(statement.text, statement.bind(args));
    return {
      get: (...args: unknown[]) => execute(...args).rows[0],
      all: (...args: unknown[]) => execute(...args).rows,
      run: (...args: unknown[]) => ({ changes: execute(...args).rowCount }),
    };
  }

  transaction<T>(fn: () => T) {
    return (): T => {
      const depth = this.transactionDepth;
      const savepoint = `madar_nested_${depth}`;
      this.exec(depth ? `SAVEPOINT ${savepoint}` : 'BEGIN');
      this.transactionDepth = depth + 1;
      try {
        const result = fn();
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          throw new Error('PostgreSQL transaction callbacks must be synchronous');
        }
        if (depth) {
          this.exec(`RELEASE SAVEPOINT ${savepoint}`);
        } else if (this.query('COMMIT').command !== 'COMMIT') {
          throw new Error('PostgreSQL rolled back the transaction');
        }
        return result;
      } catch (error) {
        try { this.exec(depth ? `ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}` : 'ROLLBACK'); }
        catch { /* Preserve the original error, including an ambiguous commit. */ }
        throw error;
      } finally {
        this.transactionDepth = depth;
      }
    };
  }
}
