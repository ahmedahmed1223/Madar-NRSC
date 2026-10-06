import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestServer } from '../helpers';
import { deliverBackup } from '../../src/server/backupDelivery';

let server: Awaited<ReturnType<typeof createTestServer>>;
let destination: string;
beforeEach(async () => {
  server = await createTestServer();
  destination = await fs.mkdtemp(path.join(os.tmpdir(), 'madar-backup-test-'));
});
afterEach(async () => { server.close(); await fs.rm(destination, { recursive: true, force: true }); });

it('copies a complete snapshot and checksummed uploads to an external folder', async () => {
  await fs.mkdir(path.join(server.dir, 'uploads'));
  await fs.writeFile(path.join(server.dir, 'uploads', 'test.txt'), 'media');
  server.db.insertUpload({ id: 'backup-upload', storedName: 'test.txt', originalName: 'test.txt',
    mimeType: 'text/plain', sizeBytes: 5, uploadedBy: 'usr-1', createdAt: new Date().toISOString() });
  const backup = await server.db.createBackup('auto');
  await deliverBackup(server.db, backup.fileName, { directory: destination, retention: 2 });
  const bundle = path.join(destination, `${backup.fileName}.bundle`);
  expect(await fs.readFile(path.join(bundle, 'uploads', 'test.txt'), 'utf8')).toBe('media');
  const manifest = JSON.parse(await fs.readFile(path.join(bundle, 'manifest.json'), 'utf8'));
  expect(manifest.files).toHaveLength(2);
  expect(manifest.files.every((file: any) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
});

it('never reports a complete bundle when a referenced upload is missing', async () => {
  server.db.insertUpload({ id: 'missing', storedName: 'missing.txt', originalName: 'missing.txt',
    mimeType: 'text/plain', sizeBytes: 5, uploadedBy: 'usr-1', createdAt: new Date().toISOString() });
  const backup = await server.db.createBackup('auto');
  await expect(deliverBackup(server.db, backup.fileName, { directory: destination, retention: 2 })).rejects.toThrow();
  expect(await fs.readdir(destination)).toEqual([]);
});
