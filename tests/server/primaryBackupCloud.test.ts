import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTestServer } from '../helpers';
import { createFullBackup } from '../../src/server/backupDelivery';
import { rehearseBackup } from '../../src/server/databaseRecovery';
import { listAllBackupFiles, primaryBackupReadiness } from '../../src/server/primaryBackupStorage';

const fake = vi.hoisted(() => ({
  run: vi.fn(),
  readMedia: vi.fn(),
}));
vi.mock('node:child_process', async getOriginal => {
  const original = await getOriginal<typeof import('node:child_process')>();
  const { promisify } = await import('node:util');
  const execFile = (...args: unknown[]) => Reflect.apply(original.execFile, undefined, args);
  Object.defineProperty(execFile, promisify.custom, {
    value: (command: string, args: string[], options: object) => command === 'rclone'
      ? fake.run(args)
      : Reflect.apply(promisify(original.execFile), undefined, [command, args, options]),
  });
  return { ...original, execFile };
});
vi.mock('../../src/server/storage', async getOriginal => ({
  ...await getOriginal<typeof import('../../src/server/storage')>(),
  openStoredUpload: fake.readMedia,
}));

let server: Awaited<ReturnType<typeof createTestServer>>;
let remote: string;
const target = (type: 'dropbox' | 'gdrive') => {
  const settings = server.db.getRow('settings', 'singleton')!;
  server.db.writeRow('settings', settings.id, { ...settings.d, storage: { ...settings.d.storage, primaryBackups: type } }, settings.p, null);
};
const remotePath = (destination: string) => path.join(remote, destination.replace(':', '/'));
beforeEach(async () => {
  server = await createTestServer();
  remote = await fs.mkdtemp(path.join(os.tmpdir(), 'madar-fake-rclone-'));
  fake.run.mockReset();
  fake.readMedia.mockReset();
  fake.run.mockImplementation(async ([command, first, second]: string[]) => {
    if (command === 'listremotes') return { stdout: 'news-dropbox:  dropbox\nnews-drive:  drive\nunknown:  sftp\n' };
    if (command === 'copy') {
      await fs.mkdir(path.dirname(remotePath(second)), { recursive: true });
      await fs.cp(first, remotePath(second), { recursive: true, force: false, errorOnExist: true });
    } else if (command === 'copyto') {
      await fs.copyFile(remotePath(first), second);
    } else if (command === 'purge') {
      await fs.rm(remotePath(first), { recursive: true, force: true });
    } else if (command !== 'check') {
      throw new Error(`Unexpected rclone command: ${command}`);
    }
    return { stdout: '' };
  });
});
afterEach(async () => { server.close(); await fs.rm(remote, { recursive: true, force: true }); });

it('publishes a verified Dropbox backup and independently copies managed remote-only media', async () => {
  target('dropbox');
  const config = { backupDropboxRemote: 'news-dropbox:backups', backupRetention: 2 };
  server.db.insertUpload({ id: 'remote-media', storedName: 'remote.txt', originalName: 'remote.txt', mimeType: 'text/plain',
    sizeBytes: 5, uploadedBy: 'usr-1', createdAt: new Date().toISOString(), localEvicted: true });
  fake.readMedia.mockResolvedValue({ kind: 'stream', response: new Response('media') });

  const complete = await createFullBackup(server.db, config);
  const folder = remotePath(complete.bundle);
  const manifest = JSON.parse(await fs.readFile(path.join(folder, 'manifest.json'), 'utf8'));
  expect(manifest.files).toContainEqual(expect.objectContaining({ path: 'uploads/remote.txt', bytes: 5 }));
  expect(await fs.readFile(path.join(folder, 'uploads', 'remote.txt'), 'utf8')).toBe('media');
  expect(fake.run).toHaveBeenCalledWith(expect.arrayContaining(['check', complete.bundle, '--one-way', '--download']));
  expect(await fs.readdir(server.db.backupsDir)).toEqual([]);
  await expect(server.db.verifyBackup(complete.file.fileName)).resolves.toMatchObject({ valid: true });
  expect(await fs.readdir(path.join(server.dir, 'backup-staging'))).toEqual([]);
  expect(listAllBackupFiles(server.db)).toEqual([complete.file]);
  const scratch = path.join(server.dir, 'rehearsals');
  await expect(rehearseBackup(server.db, complete.file.fileName, scratch)).resolves.toMatchObject({ mediaVerified: true });
  await fs.writeFile(path.join(folder, 'uploads', 'remote.txt'), 'MEDIA');
  await expect(rehearseBackup(server.db, complete.file.fileName, scratch)).rejects.toThrow('SHA-256 checksum mismatch');
  expect(await fs.readdir(scratch)).toEqual([]);
});

it('reuses a verified Google Drive carrier and removes a failed delivery without imposing a local fallback', async () => {
  target('gdrive');
  const config = { backupRemote: 'news-drive:backups', backupRetention: 2 };
  expect(await primaryBackupReadiness(server.db, config)).toMatchObject({
    primaryTarget: 'gdrive', primaryConfigured: true, primaryDestinations: { dropbox: false, gdrive: true },
  });
  const original = fake.run.getMockImplementation()!;
  fake.run.mockImplementation(async (args: string[]) => {
    if (args[0] === 'check') throw new Error('Checksum mismatch');
    return original(args);
  });
  await expect(createFullBackup(server.db, config, 'auto')).rejects.toThrow('Primary backup delivery or verification failed');
  expect(fake.run).toHaveBeenCalledWith(['purge', expect.stringMatching(/^news-drive:backups\/newsroom_backup_/)]);
  expect(await fs.readdir(path.join(remote, 'news-drive', 'backups'))).toEqual([]);
  expect(await fs.readdir(server.db.backupsDir)).toEqual([]);
  expect(await fs.readdir(path.join(server.dir, 'backup-staging'))).toEqual([]);
  expect(listAllBackupFiles(server.db)).toEqual([]);
  expect(JSON.parse(server.db.getMeta('backup_last_delivery') || '{}')).toMatchObject({ status: 'failed' });

  fake.run.mockImplementation(original);
  const recovered = await createFullBackup(server.db, config, 'auto');
  await expect(rehearseBackup(server.db, recovered.file.fileName, path.join(server.dir, 'rehearsals')))
    .resolves.toMatchObject({ mediaVerified: true });
});
