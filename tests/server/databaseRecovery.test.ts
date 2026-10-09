import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import request from 'supertest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';

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
