import fs from 'node:fs';
import path from 'node:path';
import { NewsroomDatabase } from './db';
import { readDatabaseEngineState, saveDatabaseEngineState, stagedDatabaseTarget, type DatabaseEngineConfig } from './databaseEngineState';
import { logger } from './logger';

/** A requested transfer runs before the HTTP server or any scheduled writes start. */
export function openConfiguredDatabase(dataDir: string, options: DatabaseEngineConfig): NewsroomDatabase {
  const state = readDatabaseEngineState(dataDir, options);
  if (state.activeId && state.active.engine === 'sqlite' && !fs.existsSync(path.join(dataDir, state.active.filename))) {
    throw new Error('ملف قاعدة SQLite النشطة غير موجود');
  }
  const source = new NewsroomDatabase(dataDir, state.active, options.postgresUrl, state.activeId, options.storedSecrets);

  if (!state.pending || state.pending.engine === source.engine) {
    try { saveDatabaseEngineState(dataDir, { ...state, pending: undefined, activeId: source.dbId }); }
    catch (error) { source.close(); throw error; }
    return source;
  }

  const next = stagedDatabaseTarget(state.pending.engine, options);
  let destination: NewsroomDatabase | undefined;
  try {
    if (source.listCollection('onAir').some(row => ['LIVE', 'RUNNING', 'PAUSED'].includes(String(row.d?.status)))) {
      throw new Error('لا يمكن تبديل القاعدة مع وجود بث نشط');
    }
    source.verifyLocalUploadInventory();
    destination = new NewsroomDatabase(dataDir, next, options.postgresUrl, undefined, options.storedSecrets);
    const evidence = destination.importFrom(source);
    if (!destination.isHealthy() || destination.dbId !== source.dbId) throw new Error('تعذر التحقق من هوية القاعدة المنقولة');
    const records = evidence.tables.reduce((total, table) => total + table.rows, 0);
    saveDatabaseEngineState(dataDir, {
      active: next, activeId: destination.dbId,
      lastTransfer: { status: 'complete', engine: next.engine, at: new Date().toISOString(), records },
    });
  } catch {
    destination?.close();
    try {
      saveDatabaseEngineState(dataDir, { active: state.active, activeId: source.dbId,
        lastTransfer: { status: 'failed', engine: next.engine, at: new Date().toISOString() } });
    } catch (error) { source.close(); throw error; }
    logger.error('database engine transfer failed; original database kept', { source: source.engine, requested: next.engine });
    return source;
  }
  source.close();
  return destination;
}
