import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { createApp } from '../../src/server/app';
import { NewsroomDatabase } from '../../src/server/db';
import { createFullBackup, deliverBackup, lastVerifiedExternalBackup } from '../../src/server/backupDelivery';

let server: Awaited<ReturnType<typeof createTestServer>>;
let destination: string;
beforeEach(async () => {
  server = await createTestServer();
  destination = await fs.mkdtemp(path.join(os.tmpdir(), 'madar-backup-test-'));
});
afterEach(async () => { server.close(); await fs.rm(destination, { recursive: true, force: true }); });

it('restores a verified complete bundle and serves an episode, its assignment and uploaded file', async () => {
  const sqlite = (server.db as any).db;
  sqlite.pragma('wal_checkpoint(TRUNCATE)');
  sqlite.pragma('wal_autocheckpoint = 0');
  await fs.mkdir(path.join(server.dir, 'uploads'));
  await fs.writeFile(path.join(server.dir, 'uploads', 'test.txt'), 'media');
  server.db.insertUpload({ id: 'backup-upload', storedName: 'test.txt', originalName: 'test.txt',
    mimeType: 'text/plain', sizeBytes: 5, uploadedBy: 'usr-1', scope: 'media', createdAt: new Date().toISOString() });
  const episode = server.db.listCollection('episodes')[0];
  server.db.writeRow('tasks', 'tsk-recovery-probe', {
    id: 'tsk-recovery-probe', title: 'مراجعة مادة الحلقة', relatedEntityType: 'EPISODE',
    relatedEntityId: episode.id, assigneeId: 'usr-3', status: 'TODO',
  }, 0, null);
  const walPath = `${server.db.filePath}-wal`;
  expect((await fs.stat(walPath)).size).toBeGreaterThan(32);
  const mainOnlyPath = path.join(destination, 'main-only.sqlite');
  await fs.copyFile(server.db.filePath, mainOnlyPath);
  const mainOnly = new Database(mainOnlyPath, { readonly: true, fileMustExist: true });
  try {
    expect(mainOnly.prepare("SELECT 1 FROM entities WHERE collection = 'tasks' AND id = 'tsk-recovery-probe'").get()).toBeUndefined();
  } finally { mainOnly.close(); }
  const expectedCounts = {
    episodes: server.db.countCollection('episodes'),
    tasks: server.db.countCollection('tasks'),
    users: server.db.countCollection('users'),
  };
  const backup = await server.db.createBackup('auto');
  expect((await server.db.verifyBackup(backup.fileName)).valid).toBe(true);
  await deliverBackup(server.db, backup.fileName, { directory: destination, retention: 2 });
  const bundle = path.join(destination, `${backup.fileName}.bundle`);
  expect(await fs.readFile(path.join(bundle, 'uploads', 'test.txt'), 'utf8')).toBe('media');
  const manifest = JSON.parse(await fs.readFile(path.join(bundle, 'manifest.json'), 'utf8'));
  expect(manifest.files).toHaveLength(2);
  const restoredPath = await fs.mkdtemp(path.join(destination, 'restored-'));
  for (const file of manifest.files) {
    const bytes = await fs.readFile(path.join(bundle, file.path));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    const target = path.join(restoredPath, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  }
  const restored = new NewsroomDatabase(restoredPath);
  try {
    expect(restored.countCollection('episodes')).toBe(expectedCounts.episodes);
    expect(restored.countCollection('tasks')).toBe(expectedCounts.tasks);
    expect(restored.countCollection('users')).toBe(expectedCounts.users);
    expect(restored.getRow('tasks', 'tsk-recovery-probe')?.d.relatedEntityId).toBe(episode.id);
    const { app } = createApp(restored, { ...server.config, dataDir: restoredPath });
    const admin = await loginAgent(app, 'admin@akhbar.tv');
    const data = await admin.get('/api/v1/data');
    expect(data.status).toBe(200);
    expect(data.body.collections.episodes).toContainEqual(expect.objectContaining({ id: episode.id }));
    expect(data.body.collections.tasks).toContainEqual(expect.objectContaining({
      id: 'tsk-recovery-probe', d: expect.objectContaining({ relatedEntityId: episode.id }),
    }));
    const file = await admin.get('/api/v1/media/files/backup-upload');
    expect(file.status).toBe(200);
    expect(file.text).toBe('media');
  } finally {
    restored.close();
  }
});

it('never reports a complete bundle when a referenced upload is missing', async () => {
  server.db.insertUpload({ id: 'missing', storedName: 'missing.txt', originalName: 'missing.txt',
    mimeType: 'text/plain', sizeBytes: 5, uploadedBy: 'usr-1', createdAt: new Date().toISOString() });
  const backup = await server.db.createBackup('auto');
  await expect(deliverBackup(server.db, backup.fileName, { directory: destination, retention: 2 })).rejects.toThrow();
  expect(await fs.readdir(destination)).toEqual([]);
});

it('records only verified external delivery for the same configured destination', async () => {
  const config = { backupDirectory: destination, backupRetention: 2 };
  expect(lastVerifiedExternalBackup(server.db, config)).toBeNull();
  const created = await createFullBackup(server.db, config);
  expect(lastVerifiedExternalBackup(server.db, config)).toEqual({ at: expect.any(String), fileName: created.file.fileName, targets: ['directory'] });
  expect(lastVerifiedExternalBackup(server.db, { ...config, backupDirectory: path.join(destination, 'new-target') })).toBeNull();
  expect(lastVerifiedExternalBackup(server.db, {})).toBeNull();
});

it('does not call a bundle complete when a referenced upload exists only in its original storage', async () => {
  server.db.insertUpload({ id: 'externally-stored', storedName: 'external.txt', originalName: 'external.txt',
    mimeType: 'text/plain', sizeBytes: 10, uploadedBy: 'usr-1', createdAt: new Date().toISOString(), localEvicted: true });
  const config = { backupDirectory: destination, backupRetention: 2 };
  const created = await createFullBackup(server.db, config);
  expect(created.filesKeptElsewhere).toBe(1);
  expect(lastVerifiedExternalBackup(server.db, config)).toBeNull();
});
