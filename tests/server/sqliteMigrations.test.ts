import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { archiveTerms, prepareArchiveText, rankArchiveText } from '../../src/server/archiveIndex';
import { MIGRATIONS } from '../../src/server/dbMigrations';
import { openSqliteDatabase } from '../../src/server/sqliteDatabase';

let dir: string;
let filename: string;
let backups: string;
const connections: Database.Database[] = [];
const now = '2026-01-01T12:00:00.000Z';
const story = { id: 'story-one', title: 'خبر محفوظ', status: 'DRAFT' };
const person = { id: 'editor-one', fullName: 'مسؤول غرفة الأخبار', role: 'SUPER_ADMIN' };
const email = 'retained-admin@example.com';
const finalVersion = MIGRATIONS.at(-1)!.version;
const backupName = /^newsroom_backup_[0-9TZ-]+_premigration\.sqlite$/;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'madar-sqlite-migration-'));
  filename = path.join(dir, 'newsroom.sqlite');
  backups = path.join(dir, 'backups');
});
afterEach(() => {
  for (const connection of connections.splice(0).reverse()) if (connection.open) connection.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function createEstablishedSchema(version: number) {
  const db = new Database(filename);
  connections.push(db);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 0');
  db.function('nrcs_archive_prepare', { deterministic: true }, prepareArchiveText);
  db.function('nrcs_archive_terms', { deterministic: true }, archiveTerms);
  db.function('nrcs_archive_rank', { deterministic: true }, rankArchiveText);
  db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const migration of MIGRATIONS.filter((entry) => entry.version <= version)) {
    db.exec(migration.sql);
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(migration.version, now);
  }
  db.pragma('wal_checkpoint(TRUNCATE)');
  const insert = db.prepare('INSERT INTO entities (collection, id, data, rev, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  insert.run('news', story.id, JSON.stringify(story), 1, now, now);
  insert.run('users', person.id, JSON.stringify(person), 2, now, now);
  db.prepare('INSERT INTO user_credentials (user_id, email, password_hash, password_changed_at) VALUES (?, ?, ?, ?)').run(
    person.id, email, 'retained-test-password-hash', now,
  );
  return db;
}

function versionOf(db: Database.Database) {
  return db.prepare('SELECT max(version) FROM schema_migrations').pluck().get();
}

function openForStartup(file = filename) {
  const db = openSqliteDatabase(file, false);
  connections.push(db);
  return db;
}

function expectRetainedData(db: Database.Database) {
  const read = db.prepare('SELECT data FROM entities WHERE collection = ? AND id = ?').pluck();
  expect(read.get('news', story.id)).toBe(JSON.stringify(story));
  expect(read.get('users', person.id)).toBe(JSON.stringify(person));
  expect(db.prepare('SELECT email, password_hash FROM user_credentials WHERE user_id = ?').get(person.id)).toEqual({
    email, password_hash: 'retained-test-password-hash',
  });
}

function inspectedBackup() {
  const files = fs.readdirSync(backups);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(backupName);
  const backup = new Database(path.join(backups, files[0]), { readonly: true, fileMustExist: true });
  connections.push(backup);
  expect(backup.pragma('quick_check', { simple: true })).toBe('ok');
  return backup;
}

it('backs up committed WAL data and credentials before upgrading an established database', () => {
  createEstablishedSchema(7);
  expect(fs.statSync(`${filename}-wal`).size).toBeGreaterThan(0);

  const upgraded = openForStartup();
  expect(versionOf(upgraded)).toBe(finalVersion);
  expectRetainedData(upgraded);
  const snapshot = inspectedBackup();
  expect(versionOf(snapshot)).toBe(7);
  expectRetainedData(snapshot);
  upgraded.close();

  const reopened = openForStartup();
  expect(versionOf(reopened)).toBe(finalVersion);
  expect(fs.readdirSync(backups)).toHaveLength(1);
});

it('skips migration backups for an empty file and for an in-memory database', () => {
  fs.writeFileSync(filename, '');
  const onDisk = openForStartup();
  const inMemory = openForStartup(':memory:');
  expect(versionOf(onDisk)).toBe(finalVersion);
  expect(versionOf(inMemory)).toBe(finalVersion);
  expect(fs.existsSync(backups)).toBe(false);
});

it('leaves the old version and records intact when the backup cannot be written', () => {
  const existing = createEstablishedSchema(7);
  fs.writeFileSync(backups, 'blocking file');

  expect(() => openForStartup()).toThrow(/migration backup/i);
  expect(versionOf(existing)).toBe(7);
  expectRetainedData(existing);
});

it('keeps the backup and rolls the whole upgrade back when a later migration fails', () => {
  const existing = createEstablishedSchema(7);
  existing.exec('CREATE TABLE work_reminders (conflicting_column TEXT)');

  expect(() => openForStartup()).toThrow(/work_reminders/);
  expect(versionOf(existing)).toBe(7);
  expect(existing.prepare("SELECT name FROM sqlite_schema WHERE name = 'idx_personal_tasks_owner'").get()).toBeUndefined();
  expectRetainedData(existing);
  expectRetainedData(inspectedBackup());
});

it('stops before destructive initial SQL can run against an unrecognized old schema', () => {
  const legacy = new Database(filename);
  connections.push(legacy);
  legacy.exec("CREATE TABLE news(title TEXT); INSERT INTO news VALUES ('خبر محفوظ');");

  expect(() => openForStartup()).toThrow(/migration history/i);
  expect(legacy.prepare('SELECT title FROM news').pluck().get()).toBe('خبر محفوظ');
  expect(legacy.prepare("SELECT name FROM sqlite_schema WHERE name = 'schema_migrations'").get()).toBeUndefined();
});

it('leaves a database from a newer application version intact', () => {
  const existing = createEstablishedSchema(finalVersion);
  existing.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(finalVersion + 1, now);

  expect(() => openForStartup()).toThrow(/migration history/i);
  expect(versionOf(existing)).toBe(finalVersion + 1);
  expectRetainedData(existing);
  expect(fs.existsSync(backups)).toBe(false);
});
