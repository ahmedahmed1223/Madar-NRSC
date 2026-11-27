import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { DatabaseEngine, DatabaseEngineStatus } from '../shared/databaseEngine';
import type { StoredSecretsOptions } from './storedSecrets';

export interface DatabaseEngineConfig {
  defaultEngine: DatabaseEngine;
  postgresUrl?: string;
  postgresSchema: string;
  storedSecrets?: StoredSecretsOptions;
}

const engineName = z.enum(['sqlite', 'postgresql']);
const targetSchema = z.discriminatedUnion('engine', [
  z.object({ engine: z.literal('sqlite'), filename: z.string().regex(/^newsroom(?:-switch-[a-f0-9]{12})?\.sqlite$/) }),
  z.object({ engine: z.literal('postgresql'), schema: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/) }),
]);
const stateSchema = z.object({
  active: targetSchema,
  activeId: z.string().min(1).optional(),
  pending: z.object({ engine: engineName, requestedAt: z.string() }).optional(),
  lastTransfer: z.object({ status: z.enum(['complete', 'failed']), engine: engineName, at: z.string(), records: z.number().optional() }).optional(),
});

export type DatabaseTarget = z.infer<typeof targetSchema>;
export type DatabaseEngineState = z.infer<typeof stateSchema>;
const statePath = (dataDir: string) => path.join(dataDir, 'database-engine.json');

export function readDatabaseEngineState(dataDir: string, options: DatabaseEngineConfig): DatabaseEngineState {
  try {
    return stateSchema.parse(JSON.parse(fs.readFileSync(statePath(dataDir), 'utf-8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('تعذر قراءة ملف اختيار محرك قاعدة البيانات');
  }
  // An existing installation keeps its records even if the operator changes the default.
  const filename = 'newsroom.sqlite';
  const existing = fs.existsSync(path.join(dataDir, filename));
  return { active: !existing && options.defaultEngine === 'postgresql'
    ? { engine: 'postgresql', schema: options.postgresSchema }
    : { engine: 'sqlite', filename } };
}

export function saveDatabaseEngineState(dataDir: string, state: DatabaseEngineState) {
  const filename = statePath(dataDir);
  const pending = `${filename}.${randomBytes(6).toString('hex')}.tmp`;
  fs.mkdirSync(dataDir, { recursive: true });
  try {
    fs.writeFileSync(pending, JSON.stringify(state), { mode: 0o600, flag: 'wx', flush: true });
    fs.renameSync(pending, filename);
  } finally {
    if (fs.existsSync(pending)) fs.unlinkSync(pending);
  }
}

export function stagedDatabaseTarget(engine: DatabaseEngine, options: DatabaseEngineConfig): DatabaseTarget {
  const id = randomBytes(6).toString('hex');
  return engine === 'sqlite' ? { engine, filename: `newsroom-switch-${id}.sqlite` }
    : { engine, schema: `${options.postgresSchema}_${id}` };
}

export function databaseEngineStatus(state: DatabaseEngineState, options: DatabaseEngineConfig): DatabaseEngineStatus {
  return { active: state.active.engine, postgresConfigured: !!options.postgresUrl, pending: state.pending, lastTransfer: state.lastTransfer };
}

export function scheduleDatabaseEngine(dataDir: string, options: DatabaseEngineConfig, engine: DatabaseEngine) {
  const state = readDatabaseEngineState(dataDir, options);
  if (engine === 'postgresql' && !options.postgresUrl) throw new Error('اضبط اتصال PostgreSQL في بيئة الخادم أولًا');
  state.pending = engine === state.active.engine ? undefined : { engine, requestedAt: new Date().toISOString() };
  saveDatabaseEngineState(dataDir, state);
  return databaseEngineStatus(state, options);
}
