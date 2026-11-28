import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTestServer, DEMO_PASSWORD, loginAgent } from '../helpers';
import { createApp } from '../../src/server/app';
import { createFullBackup } from '../../src/server/backupDelivery';

let server: Awaited<ReturnType<typeof createTestServer>>;
let destination: string;
const headers = { 'X-NRCS-Client': 'web' };
beforeEach(async () => {
  server = await createTestServer();
  destination = await fs.mkdtemp(path.join(os.tmpdir(), 'madar-primary-nas-'));
  const settings = server.db.getRow('settings', 'singleton')!;
  server.db.writeRow('settings', settings.id, { ...settings.d, storage: { ...settings.d.storage, primaryBackups: 'nas' } }, settings.p, null);
});
afterEach(async () => { vi.unstubAllEnvs(); server.close(); await fs.rm(destination, { recursive: true, force: true }); });

it('creates and verifies a primary NAS backup without keeping a local snapshot or bundle', async () => {
  const config = { ...server.config, backupNasDirectory: destination, backupRetention: 3 };
  const { app } = createApp(server.db, config);
  const admin = await loginAgent(app, 'admin@akhbar.tv');
  const response = await admin.post('/api/v1/db/backups').set(headers);
  expect(response.status).toBe(200);
  const { fileName } = response.body.data;
  expect(await fs.readdir(server.db.backupsDir)).toEqual([]);
  expect(await fs.readdir(path.join(server.dir, 'backup-staging'))).toEqual([]);
  const list = await admin.get('/api/v1/db/backups');
  expect(list.body.data).toContainEqual(expect.objectContaining({ fileName }));
  expect((await admin.post('/api/v1/db/backups/verify').set(headers).send({ fileName })).status).toBe(200);
  const rehearsal = await admin.post('/api/v1/db/backups/rehearse').set(headers).send({ fileName });
  expect(rehearsal.body.data).toMatchObject({ fileName, compatible: true, mediaVerified: true });
  const status = await admin.get('/api/v1/db/backup-status');
  expect(status.body.data).toMatchObject({ primaryTarget: 'nas', primaryConfigured: true, primaryDestinations: { nas: true },
    lastVerifiedExternal: { fileName, targets: ['directory'] } });

  const confirm = (action: 'download' | 'restore') =>
    admin.post('/api/v1/db/confirm-operation').set(headers).send({ action, fileName, password: DEMO_PASSWORD });
  const downloadConsent = await confirm('download');
  expect(downloadConsent.status).toBe(200);
  const download = await admin.post('/api/v1/db/backups/download').set(headers)
    .send({ fileName, confirmationToken: downloadConsent.body.data.token });
  expect(download.status).toBe(200);
  expect(download.headers['content-disposition']).toContain(fileName);

  server.db.writeRow('tasks', 'after-primary-backup', { id: 'after-primary-backup', title: 'أضيف بعد النسخة' }, 0, null);
  const restoreConsent = await confirm('restore');
  expect(restoreConsent.status).toBe(200);
  const restore = await admin.post('/api/v1/db/backups/restore').set(headers)
    .send({ fileName, confirmationToken: restoreConsent.body.data.token, localAirEnded: true });
  expect(restore.status).toBe(200);
  expect(server.db.getRow('tasks', 'after-primary-backup')).toBeNull();
  expect(await fs.readdir(server.db.backupsDir)).toEqual([]);
  expect(await fs.readdir(path.join(destination, '.madar-backups'))).toHaveLength(2);
  expect(await fs.readdir(path.join(server.dir, 'backup-staging'))).toEqual([]);
});

it('rejects an unavailable selected destination without creating a local fallback', async () => {
  const unavailable = path.join(destination, 'missing-mounted-share');
  await expect(createFullBackup(server.db, { backupNasDirectory: unavailable, backupRetention: 2 })).rejects.toThrow();
  expect(await fs.readdir(server.db.backupsDir)).toEqual([]);
  await expect(fs.stat(unavailable)).rejects.toThrow();
  expect(JSON.parse(server.db.getMeta('backup_last_delivery') || '{}')).toMatchObject({ status: 'failed' });
});

it('reports a paused schedule while manual backup still uses the selected carrier', async () => {
  const settings = server.db.getRow('settings', 'singleton')!;
  server.db.writeRow('settings', settings.id, { ...settings.d, storage: {
    ...settings.d.storage, scheduledBackups: false,
  } }, settings.p, null);
  const config = { ...server.config, backupIntervalHours: 24, backupNasDirectory: destination };
  const { app } = createApp(server.db, config);
  const admin = await loginAgent(app, 'admin@akhbar.tv');
  const status = await admin.get('/api/v1/db/backup-status');
  expect(status.body.data).toMatchObject({ intervalHours: 0, overdue: false, primaryTarget: 'nas' });
  expect((await admin.post('/api/v1/db/backups').set(headers)).status).toBe(200);
  expect(await fs.readdir(path.join(destination, '.madar-backups'))).toHaveLength(1);
  expect(await fs.readdir(server.db.backupsDir)).toEqual([]);
});

it('does not count the legacy secondary Docker volume as a selected NAS carrier', async () => {
  vi.stubEnv('BACKUP_NAS_DIRECTORY', '');
  vi.stubEnv('SHARE_DIRECTORY', '');
  const config = { ...server.config, backupDirectory: destination, backupRetention: 3 };
  const { app } = createApp(server.db, config);
  const admin = await loginAgent(app, 'admin@akhbar.tv');
  const status = await admin.get('/api/v1/db/backup-status');
  expect(status.body.data).toMatchObject({ primaryTarget: 'nas', primaryConfigured: false, primaryDestinations: { nas: false } });
  await expect(createFullBackup(server.db, config)).rejects.toThrow('Selected primary backup storage is unavailable');
  expect(await fs.readdir(destination)).toEqual([]);
  expect(await fs.readdir(server.db.backupsDir)).toEqual([]);
});

it('keeps the reserved NAS archive namespace out of shared-media search', async () => {
  const settings = server.db.getRow('settings', 'singleton')!;
  server.db.writeRow('settings', settings.id, { ...settings.d, storage: {
    ...settings.d.storage, share: { ...settings.d.storage?.share, enabled: true },
  } }, settings.p, null);
  server.db.indexShareFiles([
    { path: 'library/segment.mp4', name: 'segment.mp4', sizeBytes: 5 },
    { path: '.MADAR-BACKUPS/generation/uploads/segment.mp4', name: 'segment.mp4', sizeBytes: 5 },
  ], new Date().toISOString(), true);
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const found = await admin.get('/api/v1/storage/share/search').query({ q: 'segment' });
  expect(found.status).toBe(200);
  expect(found.body.data.map((file: { ref: string }) => file.ref)).toEqual(['library/segment.mp4']);
});
