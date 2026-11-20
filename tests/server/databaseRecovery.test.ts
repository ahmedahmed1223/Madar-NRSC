import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import request from 'supertest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { cleanupRehearsals } from '../../src/server/databaseRecovery';

let server: Awaited<ReturnType<typeof createTestServer>>;
beforeEach(async () => { server = await createTestServer(); });
afterEach(() => server.close());

it('rehearses an isolated copy without changing live data or revision', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const snapshot = await server.db.createBackup();
  const before = server.db.serialize();
  const revision = server.db.currentRev();
  const response = await admin.post('/api/v1/db/backups/rehearse').set('X-NRCS-Client', 'web').send({ fileName: snapshot.fileName });
  expect(response.status).toBe(200);
  expect(response.body.data.compatible).toBe(true);
  expect(response.body.data.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(response.body.data.counts.users).toBeGreaterThan(0);
  expect(JSON.stringify(response.body)).not.toContain(server.dir);
  expect(server.db.currentRev()).toBe(revision);
  expect(server.db.serialize()).toEqual(before);
  expect(fs.readdirSync(path.join(server.dir, 'rehearsals'))).toEqual([]);
});

it('rehearses and restores schema 5 while classifying old uploads', async () => {
  const id = 'legacy-attachment';
  server.db.insertUpload({
    id, storedName: 'example.png', originalName: 'example.png', mimeType: 'image/png',
    createdAt: new Date().toISOString(), sizeBytes: 1, uploadedBy: 'usr-3',
  });
  server.db.writeRow('messages', 'legacy-message', { id: 'legacy-message', attachments: [{ id }] }, 0, null);
  const snapshot = await server.db.createBackup();
  const source = path.join(server.db.backupsDir, snapshot.fileName);
  const probe = new Database(source);
  try {
    probe.exec('DROP INDEX idx_news_archive_updated; DROP INDEX idx_message_channel_timestamp; ALTER TABLE uploads DROP COLUMN scope; DELETE FROM schema_migrations WHERE version = 6;');
  } finally {
    probe.close();
  }
  const original = fs.readFileSync(source);
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const rehearsal = await admin.post('/api/v1/db/backups/rehearse').set('X-NRCS-Client', 'web').send({ fileName: snapshot.fileName });
  expect(rehearsal.status).toBe(200);
  expect(server.db.getUpload(id)?.scope).toBe('media');
  expect(fs.readFileSync(source)).toEqual(original);
  await server.db.restoreBackup(snapshot.fileName, 20, rehearsal.body.data.sha256);
  expect(server.db.getUpload(id)?.scope).toBe('chat');
  expect(server.db.isHealthy()).toBe(true);
  expect(fs.readFileSync(source)).toEqual(original);
});

it('rejects corrupt, incompatible, missing and traversal snapshots without public internals', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const snapshot = await server.db.createBackup();
  const probe = new Database(path.join(server.db.backupsDir, snapshot.fileName));
  probe.exec('DROP TABLE sessions'); probe.close();
  for (const fileName of [snapshot.fileName, '../newsroom.sqlite', 'missing']) {
    const response = await admin.post('/api/v1/db/backups/rehearse').set('X-NRCS-Client', 'web').send({ fileName });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain(server.dir);
  }
  fs.writeFileSync(path.join(server.db.backupsDir, snapshot.fileName), 'corrupt');
  expect((await admin.post('/api/v1/db/backups/rehearse').set('X-NRCS-Client', 'web').send({ fileName: snapshot.fileName })).status).toBe(400);
  expect(fs.readdirSync(path.join(server.dir, 'rehearsals'))).toEqual([]);
});

it('restricts rehearsal access and rejects concurrent operations', async () => {
  const snapshot = await server.db.createBackup();
  expect((await request(server.app).post('/api/v1/db/backups/rehearse').set('X-NRCS-Client', 'web')).status).toBe(401);
  const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
  expect((await journalist.post('/api/v1/db/backups/rehearse').set('X-NRCS-Client', 'web')).status).toBe(403);
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const original = fs.promises.copyFile.bind(fs.promises);
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const copy = vi.spyOn(fs.promises, 'copyFile').mockImplementationOnce(async (...args) => { entered(); await blocked; return original(...args); });
  try {
    const pending = admin.post('/api/v1/db/backups/rehearse').set('X-NRCS-Client', 'web').send({ fileName: snapshot.fileName }).then(r => r);
    await started;
    expect((await admin.post('/api/v1/db/backups').set('X-NRCS-Client', 'web')).status).toBe(409);
    release(); expect((await pending).status).toBe(200);
  } finally { release(); copy.mockRestore(); }
});

it('cleans temporary copies after copy failure', async () => {
  const snapshot = await server.db.createBackup();
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const copy = vi.spyOn(fs.promises, 'copyFile').mockRejectedValueOnce(new Error('private-path'));
  try {
    expect((await admin.post('/api/v1/db/backups/rehearse').set('X-NRCS-Client', 'web').send({ fileName: snapshot.fileName })).status).toBe(400);
    expect(fs.readdirSync(path.join(server.dir, 'rehearsals'))).toEqual([]);
  } finally { copy.mockRestore(); }
});

it('preserves an old selected source when pre-restore retention is one', async () => {
  const identity = server.db.dbId;
  const snapshot = await server.db.createBackup();
  const selected = path.join(server.db.backupsDir, snapshot.fileName);
  fs.renameSync(selected, path.join(server.db.backupsDir, 'newsroom_backup_2000-01-01T00-00-00Z.sqlite'));
  await expect(server.db.restoreBackup('newsroom_backup_2000-01-01T00-00-00Z.sqlite', 1)).resolves.toBeUndefined();
  expect(server.db.dbId).toBe(identity);
  expect(server.db.isHealthy()).toBe(true);
});

it('keeps the original database usable if atomic replacement fails', async () => {
  const snapshot = await server.db.createBackup();
  server.db.writeRow('guests', 'keep-on-failure', { id: 'keep-on-failure', fullName: 'احتفظ بي' }, 0, 'test');
  const promote = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('rename denied'); });
  try {
    await expect(server.db.restoreBackup(snapshot.fileName, 20)).rejects.toThrow('rename denied');
    expect(server.db.getRow('guests', 'keep-on-failure')?.d.fullName).toBe('احتفظ بي');
    expect(server.db.isHealthy()).toBe(true);
  } finally { promote.mockRestore(); }
});

it('cleans abandoned rehearsal directories but preserves unrelated data and rejects linked roots', async () => {
  const root = path.join(server.dir, 'rehearsals');
  fs.mkdirSync(path.join(root, 'rehearsal-abandoned'), { recursive: true });
  fs.mkdirSync(path.join(root, 'keep-unrelated'), { recursive: true });
  await cleanupRehearsals(root);
  expect(fs.readdirSync(root)).toEqual(['keep-unrelated']);
  const linked = path.join(server.dir, 'linked-rehearsals');
  fs.symlinkSync(root, linked, 'junction');
  await expect(cleanupRehearsals(linked)).rejects.toThrow();
  expect(fs.readdirSync(root)).toEqual(['keep-unrelated']);
});
