import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestServer } from '../helpers';
import type { BackupStatus } from '../../src/shared/databaseDiagnostics';
import { NewsroomDatabase } from '../../src/server/db';
let server: Awaited<ReturnType<typeof createTestServer>>;
beforeEach(async () => { server = await createTestServer(); });
afterEach(() => { vi.restoreAllMocks(); server.close(); });
const status = (): BackupStatus => ({ count: 1, intervalHours: 24, overdue: false, lastSnapshotAt: new Date().toISOString(),
  lastAttempt: { at: new Date().toISOString(), status: 'failed' }, lastDelivery: null });
const notifications = () => server.db.listCollection('notifications').filter(r => r.d.type === 'BACKUP_INCIDENT');
async function reconciler() {
  expect(fs.existsSync(path.resolve('src/server/backupIncidents.ts'))).toBe(true);
  return (await import('../../src/server/backupIncidents')).reconcileBackupIncidents;
}
it('deduplicates openings across repeated runs and restart, then reminds after 24 hours and recovers once', async () => {
  const run = await reconciler(); const now = Date.now(); const failed = status();
  await run(server.db, failed, now);
  const first = notifications().length; expect(first).toBeGreaterThan(0);
  const restarted = new NewsroomDatabase(server.dir);
  try { await run(restarted, failed, now + 500); } finally { restarted.close(); }
  expect(notifications()).toHaveLength(first);
  await run(server.db, failed, now + 1000); expect(notifications()).toHaveLength(first);
  await run(server.db, failed, now + 86400000); expect(notifications()).toHaveLength(first * 2);
  await run(server.db, { ...failed, lastAttempt: { at: new Date().toISOString(), status: 'ok' } }, now + 86400001);
  expect(notifications()).toHaveLength(first * 3);
  await run(server.db, { ...failed, lastAttempt: { at: new Date().toISOString(), status: 'ok' } }, now + 86400002);
  expect(notifications()).toHaveLength(first * 3);
});
it('keeps delivery failure independent from manual snapshot success and suppresses disabled overdue', async () => {
  const run = await reconciler(); const s = { ...status(), lastAttempt: { at: new Date().toISOString(), status: 'ok' as const },
    lastDelivery: { at: new Date().toISOString(), status: 'failed' as const }, overdue: true, intervalHours: 0 };
  await run(server.db, s);
  expect(notifications().length).toBeGreaterThan(0);
  expect(notifications().every(r => r.d.message.includes('الكاملة'))).toBe(true);
  await run(server.db, s); expect(notifications().some(r => r.d.title.includes('عاد'))).toBe(false);
});
it('retains incident transitions when notification storage fails, retrying without duplicates', async () => {
  const run = await reconciler(); const write = vi.spyOn(server.db, 'writeRow').mockImplementationOnce(() => { throw new Error('disk full'); });
  await expect(run(server.db, status())).rejects.toThrow();
  expect(notifications()).toHaveLength(0);
  write.mockRestore(); await run(server.db, status());
  const count = notifications().length; await run(server.db, status()); expect(notifications()).toHaveLength(count);
});
it('retains failed opening notification when backup recovers before notification storage does', async () => {
  const run = await reconciler();
  const write = vi.spyOn(server.db, 'writeRow').mockImplementationOnce(() => { throw new Error('notification unavailable'); });
  await expect(run(server.db, status())).rejects.toThrow();
  write.mockRestore();
  await run(server.db, { ...status(), lastAttempt: { at: new Date().toISOString(), status: 'ok' } });
  const delivered = notifications();
  expect(delivered.some(row => row.d.title === 'تنبيه النسخ الاحتياطي')).toBe(true);
  expect(delivered.some(row => row.d.title === 'عاد النسخ الاحتياطي للعمل')).toBe(true);
  const before = delivered.length;
  await run(server.db, { ...status(), lastAttempt: { at: new Date().toISOString(), status: 'ok' } });
  expect(notifications()).toHaveLength(before);
});
it('retains pending recovery when another backup failure occurs before retry', async () => {
  const run = await reconciler(); await run(server.db, status());
  const before = notifications().length;
  const write = vi.spyOn(server.db, 'writeRow').mockImplementationOnce(() => { throw new Error('notification unavailable'); });
  await expect(run(server.db, { ...status(), lastAttempt: { at: new Date().toISOString(), status: 'ok' } })).rejects.toThrow();
  write.mockRestore(); await run(server.db, status());
  expect(notifications().filter(row => row.d.title === 'عاد النسخ الاحتياطي للعمل')).toHaveLength(before);
  expect(notifications()).toHaveLength(before * 3);
});
it('notifies only active authorized managers with nonurgent system notifications', async () => {
  const run = await reconciler(); await run(server.db, status());
  const manager = server.db.getCredentialsByEmail('admin@akhbar.tv')!;
  expect(notifications().every(r => r.d.userId === manager.userId && r.d.category === 'system' && !r.d.urgent)).toBe(true);
  const row = server.db.getRow('users', manager.userId)!;
  server.db.writeRow('users', manager.userId, { ...row.d, isActive: false }, row.p, 'test');
  const before = notifications().length;
  await run(server.db, status(), Date.now() + 86400001); expect(notifications()).toHaveLength(before);
});
it('initializes the notification cursor before startup incidents so enabled channels can receive them', async () => {
  const delivery = await import('../../src/server/delivery');
  expect(typeof (delivery as any).initializeNotificationDelivery).toBe('function');
  const before = server.db.currentRev();
  (delivery as any).initializeNotificationDelivery(server.db);
  const run = await reconciler(); await run(server.db, status());
  expect(Number(server.db.getMeta('notify_delivery_rev'))).toBe(before);
  expect(server.db.currentRev()).toBeGreaterThan(before);
  await delivery.deliverPending(server.db, server.config);
  expect(Number(server.db.getMeta('notify_delivery_rev'))).toBeGreaterThan(before);
});
