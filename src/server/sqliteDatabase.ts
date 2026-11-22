import Database from 'better-sqlite3';
import { randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { archiveTerms, prepareArchiveText, rankArchiveText } from './archiveIndex';
import { MIGRATIONS } from './dbMigrations';
import { logger } from './logger';

function registerArchiveFunctions(database: Database.Database) {
  database.function('nrcs_archive_prepare', { deterministic: true }, prepareArchiveText);
  database.function('nrcs_archive_terms', { deterministic: true }, archiveTerms);
  database.function('nrcs_archive_rank', { deterministic: true }, rankArchiveText);
}

function appliedMigrationCount(database: Database.Database) {
  const hasHistory = database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'").get();
  const versions = hasHistory
    ? database.prepare('SELECT version FROM schema_migrations ORDER BY version').pluck().all() as number[]
    : [];
  if (versions.some((version, index) => version !== MIGRATIONS[index]?.version)) {
    throw new Error('SQLite migration history is incompatible with this application version');
  }
  if (versions.length === 0 && database.prepare(
    "SELECT 1 FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' LIMIT 1",
  ).get()) {
    throw new Error('Established SQLite database has no migration history. Recover or import it explicitly before starting Madar.');
  }
  return versions.length;
}

function syncPath(filename: string, flags: 'r' | 'r+') {
  const fd = fs.openSync(filename, flags);
  try { fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

function createMigrationBackup(filename: string) {
  const directory = path.join(path.dirname(filename), 'backups');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `newsroom_backup_${stamp}-${randomInt(1_000_000_000_000)}_premigration.sqlite`;
  const temporary = path.join(directory, `.premigration-${randomUUID()}.sqlite`);
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.closeSync(fs.openSync(temporary, 'wx', 0o600));

    // The migration connection holds a reserved write lock. A separate read-only
    // connection snapshots the last committed state, including changes still in WAL.
    const source = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      registerArchiveFunctions(source);
      source.prepare('VACUUM main INTO ?').run(temporary);
    } finally { source.close(); }

    const snapshot = new Database(temporary, { readonly: true, fileMustExist: true });
    try {
      if (snapshot.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('SQLite snapshot failed its integrity check');
    } finally { snapshot.close(); }

    syncPath(temporary, 'r+');
    fs.renameSync(temporary, path.join(directory, fileName));
    if (process.platform !== 'win32') syncPath(directory, 'r');
    return fileName;
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`SQLite migration backup failed: ${details}`, { cause: error });
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function applySqliteMigrations(database: Database.Database, logMigrations = true, backupExistingFile = false) {
  registerArchiveFunctions(database);
  if (appliedMigrationCount(database) === MIGRATIONS.length) return;

  const migrated = database.transaction(() => {
    const applied = appliedMigrationCount(database);
    const pending = MIGRATIONS.slice(applied);
    if (pending.length === 0) return pending;
    if (backupExistingFile && !database.memory && applied > 0) {
      const file = createMigrationBackup(database.name);
      if (logMigrations) logger.info('database migration backup created', { file });
    }

    database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const record = database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
    for (const migration of pending) {
      database.exec(migration.sql);
      record.run(migration.version, new Date().toISOString());
    }
    return pending;
  }).immediate();

  if (logMigrations) {
    for (const { version } of migrated) logger.info('database migration applied', { version });
  }
}

export function openSqliteDatabase(filename: string, logMigrations = true) {
  const database = new Database(filename);
  try {
    database.pragma('busy_timeout = 5000');
    database.pragma('foreign_keys = ON');
    applySqliteMigrations(database, logMigrations, true);
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = NORMAL');
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
