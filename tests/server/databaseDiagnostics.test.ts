import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { logger } from '../../src/server/logger';
let server: Awaited<ReturnType<typeof createTestServer>>;
beforeEach(async () => { server = await createTestServer(); });
afterEach(() => server.close());

it('restricts diagnostics to database managers and never exports raw error fields', async () => {
  expect((await request(server.app).get('/api/v1/db/errors')).status).toBe(401);
  const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
  expect((await journalist.get('/api/v1/db/errors')).status).toBe(403);
  expect((await journalist.get('/api/v1/db/diagnostics')).status).toBe(403);
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  logger.error('unhandled error', { error: 'password=secret-news-script', path: '/api?token=private' });
  const errors = await admin.get('/api/v1/db/errors');
  expect(errors.status).toBe(200);
  expect(errors.body.data.entries[0].message).toBe('unhandled error');
  expect(JSON.stringify(errors.body)).not.toContain('secret-news-script');
  expect(JSON.stringify(errors.body)).not.toContain('private');
  const report = await admin.get('/api/v1/db/diagnostics');
  expect(report.status).toBe(200);
  expect(report.body.data.version).toBeTruthy();
  expect(JSON.stringify(report.body)).not.toContain(server.dir);
  expect(JSON.stringify(report.body)).not.toContain('passwordHash');
});

it('checks and downloads the selected snapshot without changing the live database', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const created = await admin.post('/api/v1/db/backups').set('X-NRCS-Client', 'web');
  const name = created.body.data.fileName;
  const before = server.db.currentRev();
  const verified = await admin.post('/api/v1/db/backups/verify').set('X-NRCS-Client', 'web').send({ fileName: name });
  expect(verified.status).toBe(200);
  expect(verified.body.data.valid).toBe(true);
  expect(server.db.currentRev()).toBe(before);
  const downloaded = await admin.get(`/api/v1/db/backups/download?fileName=${encodeURIComponent(name)}`).buffer(true).parse((response, callback) => {
    const chunks: Buffer[] = [];
    response.on('data', chunk => chunks.push(Buffer.from(chunk)));
    response.on('end', () => callback(null, Buffer.concat(chunks)));
    response.on('error', callback);
  });
  expect(downloaded.status).toBe(200);
  expect(downloaded.headers['content-disposition']).toContain(name);
  expect(downloaded.headers['cache-control']).toBe('no-store');
  expect(downloaded.body).toEqual(fs.readFileSync(path.join(server.db.backupsDir, name)));
  expect(downloaded.body).not.toEqual(server.db.serialize());
  expect((await admin.get('/api/v1/db/backups/download?fileName=../newsroom.sqlite')).status).toBe(400);
  fs.writeFileSync(path.join(server.db.backupsDir, name), 'corrupted snapshot');
  expect((await admin.post('/api/v1/db/backups/verify').set('X-NRCS-Client', 'web').send({ fileName: name })).status).toBe(400);
  const status = await admin.get('/api/v1/db/backup-status');
  expect(status.status).toBe(200);
  expect(server.db.currentRev()).toBe(before);
});

it('reports missing or overdue backups and a failed delivery independently', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const missing = await admin.get('/api/v1/db/backup-status');
  expect(missing.body.data.count).toBe(0);
  expect(missing.body.data.overdue).toBe(false); // Automatic backups disabled in this fixture.
  server.db.setMeta('backup_last_delivery', JSON.stringify({ at: new Date().toISOString(), status: 'failed', password: 'never-export' }));
  const failed = await admin.get('/api/v1/db/backup-status');
  expect(failed.body.data.lastDelivery.status).toBe('failed');
  expect(JSON.stringify(failed.body)).not.toContain('never-export');
  server.config.backupIntervalHours = 1;
  expect((await admin.get('/api/v1/db/backup-status')).body.data.overdue).toBe(true);
  const snapshot = await server.db.createBackup();
  fs.utimesSync(path.join(server.db.backupsDir, snapshot.fileName), new Date(0), new Date(0));
  expect((await admin.get('/api/v1/db/backup-status')).body.data.overdue).toBe(true);
});

it('records a real snapshot write failure without exposing its raw error', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const write = vi.spyOn((server.db as any).db, 'backup').mockRejectedValueOnce(new Error('password=do-not-export'));
  try {
    const response = await admin.post('/api/v1/db/backups').set('X-NRCS-Client', 'web');
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('do-not-export');
    const status = await admin.get('/api/v1/db/backup-status');
    expect(status.body.data.lastAttempt.status).toBe('failed');
    const errors = await admin.get('/api/v1/db/errors');
    expect(errors.body.data.entries[0].message).toBe('manual backup failed');
    expect(JSON.stringify(errors.body)).not.toContain('do-not-export');
  } finally { write.mockRestore(); }
});
