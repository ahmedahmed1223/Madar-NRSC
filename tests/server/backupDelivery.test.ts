import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { createApp } from '../../src/server/app';
import { NewsroomDatabase } from '../../src/server/db';
import { cleanupBackupStaging, createFullBackup, deliverBackup, lastVerifiedExternalBackup, verifyBackupBundle } from '../../src/server/backupDelivery';

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
  // A later generation has different bytes. The first generation must still recover
  // independently after the live file is gone, including on copy-on-write filesystems.
  await fs.writeFile(path.join(server.dir, 'uploads', 'test.txt'), 'newer');
  await createFullBackup(server.db, { backupDirectory: destination, backupRetention: 2 });
  await fs.unlink(path.join(server.dir, 'uploads', 'test.txt'));
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
  expect(await fs.readdir(server.db.backupsDir)).toEqual([backup.fileName]);
});

it('cleans abandoned local staging at boot without touching complete backups', async () => {
  const complete = 'newsroom_backup_2026-08-01T00-00-00-000Z.sqlite.bundle';
  const next = 'newsroom_backup_2026-08-02T00-00-00-000Z.sqlite.bundle';
  const own = createHash('sha256').update(server.db.dbId).digest('hex');
  const stale = path.join(destination, `${complete}.pending-${own}`);
  const recent = `${next}.pending-${own}`;
  const anotherOrigin = `${complete}.pending-${'0'.repeat(64)}`;
  await fs.mkdir(path.join(server.db.backupsDir, complete));
  await fs.mkdir(path.join(server.db.backupsDir, `${complete}.pending`));
  await fs.mkdir(path.join(server.db.backupsDir, 'unrelated.pending'));
  await fs.mkdir(stale);
  await fs.utimes(stale, new Date(0), new Date(0));
  await fs.mkdir(path.join(destination, recent));
  await fs.mkdir(path.join(destination, anotherOrigin));
  await cleanupBackupStaging(server.db, { backupDirectory: destination });
  expect((await fs.readdir(server.db.backupsDir)).sort()).toEqual([complete, 'unrelated.pending'].sort());
  expect((await fs.readdir(destination)).sort()).toEqual([anotherOrigin, recent].sort());
});

it('leaves an older external bundle intact and cleans its own staging when delivery cannot be committed', async () => {
  const backup = await server.db.createBackup('auto');
  const name = `${backup.fileName}.bundle`;
  const existing = path.join(destination, name);
  await fs.mkdir(existing);
  await fs.writeFile(path.join(existing, 'manifest.json'), 'existing generation');
  await expect(deliverBackup(server.db, backup.fileName, { directory: destination, retention: 2 })).rejects.toThrow();
  expect(await fs.readdir(destination)).toEqual([name]);
  expect(await fs.readFile(path.join(existing, 'manifest.json'), 'utf8')).toBe('existing generation');
  expect(await fs.stat(path.join(server.db.backupsDir, name))).toBeTruthy();
});

it('prunes only app-owned complete generations after a successful external delivery', async () => {
  const config = { backupDirectory: destination, backupRetention: 1 };
  const legacy = 'newsroom_backup_2000-01-01T00-00-00-000Z.sqlite.bundle';
  await fs.mkdir(path.join(destination, legacy));
  await fs.writeFile(path.join(destination, legacy, 'manifest.json'), JSON.stringify({ format: 1 }));
  const prior = await createFullBackup(server.db, config, 'auto');
  const current = await createFullBackup(server.db, config);
  expect(current.file.fileName).not.toBe(prior.file.fileName);
  expect((await fs.readdir(destination)).sort()).toEqual([legacy, `${current.file.fileName}.bundle`].sort());
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

it('detects tampering on bundled files and rejects unsafe manifest entries via SHA-256 verification', async () => {
  await fs.mkdir(path.join(server.dir, 'uploads'), { recursive: true });
  await fs.writeFile(path.join(server.dir, 'uploads', 'z-clip.txt'), 'media');
  await fs.writeFile(path.join(server.dir, 'uploads', 'a-clip.txt'), 'audio');
  server.db.insertUpload({ id: 'u-z', storedName: 'z-clip.txt', originalName: 'z-clip.txt',
    mimeType: 'text/plain', sizeBytes: 5, uploadedBy: 'usr-1', scope: 'media', createdAt: new Date().toISOString() });
  server.db.insertUpload({ id: 'u-a', storedName: 'a-clip.txt', originalName: 'a-clip.txt',
    mimeType: 'text/plain', sizeBytes: 5, uploadedBy: 'usr-1', scope: 'media', createdAt: new Date().toISOString() });

  const created = await createFullBackup(server.db, { backupDirectory: destination, backupRetention: 2 });
  const bundle = path.join(destination, `${created.file.fileName}.bundle`);

  const manifest = JSON.parse(await fs.readFile(path.join(bundle, 'manifest.json'), 'utf8'));
  expect(manifest.files.map((f: { path: string }) => f.path)).toEqual([
    'newsroom.sqlite',
    'uploads/a-clip.txt',
    'uploads/z-clip.txt',
  ]);
  expect(await verifyBackupBundle(bundle)).toMatchObject({ valid: true, filesChecked: 3 });

  // Same-length byte mutation must be caught by SHA-256 check.
  await fs.writeFile(path.join(bundle, 'uploads', 'z-clip.txt'), 'MEDIA');
  expect(await verifyBackupBundle(bundle)).toEqual({
    valid: false,
    reason: 'SHA-256 checksum mismatch',
    tamperedPath: 'uploads/z-clip.txt',
  });

  // Restore upload, then delete a bundled file.
  await fs.writeFile(path.join(bundle, 'uploads', 'z-clip.txt'), 'media');
  await fs.unlink(path.join(bundle, 'uploads', 'a-clip.txt'));
  expect(await verifyBackupBundle(bundle)).toEqual({
    valid: false,
    reason: 'Missing bundled file',
    tamperedPath: 'uploads/a-clip.txt',
  });

  // Path traversal in manifest.json must be rejected.
  const tamperedManifest = {
    ...manifest,
    files: [{ path: '../escape.txt', bytes: 5, sha256: 'a'.repeat(64) }],
  };
  await fs.writeFile(path.join(bundle, 'manifest.json'), JSON.stringify(tamperedManifest));
  expect(await verifyBackupBundle(bundle)).toEqual({
    valid: false,
    reason: 'Unsafe manifest file path',
    tamperedPath: '../escape.txt',
  });
});
