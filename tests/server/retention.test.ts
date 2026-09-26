import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestServer } from '../helpers';
import { runRetention } from '../../src/server/retention';

let server: Awaited<ReturnType<typeof createTestServer>>;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(() => server.close());

const DAY = 24 * 60 * 60 * 1000;

describe('data retention', () => {
  it('empties old trash, old notifications and stale locks but keeps recent data', () => {
    const { db, config } = server;
    const now = Date.now();
    const news = db.listCollection('news');
    const [oldTrash, recentTrash] = news;
    db.writeRow('news', oldTrash.id, { ...oldTrash.d, deletedAt: new Date(now - 10 * DAY).toISOString() }, oldTrash.p, null);
    db.writeRow('news', recentTrash.id, { ...recentTrash.d, deletedAt: new Date(now).toISOString() }, recentTrash.p, null);
    db.writeRow('notifications', 'notif-read', { id: 'notif-read', userId: 'usr-1', isRead: true }, 0, null);
    db.writeRow('notifications', 'notif-unread', { id: 'notif-unread', userId: 'usr-1', isRead: false }, 0, null);
    db.writeRow('editLocks', 'news:stale', { id: 'news:stale', collection: 'news', entityId: 'stale', expiresAt: new Date(now).toISOString() }, 0, null);
    const logsBefore = db.listCollection('activityLogs').length;

    const result = runRetention(db, config.dataDir, config.retention, now + 25 * DAY);

    expect(db.getRow('news', oldTrash.id)).toBeNull(); // 35 days in the trash
    expect(db.getRow('news', recentTrash.id)).not.toBeNull(); // 25 days: still restorable
    expect(db.getRow('notifications', 'notif-read')).not.toBeNull(); // read 25 days ago
    expect(db.getRow('editLocks', 'news:stale')).toBeNull();
    expect(db.listCollection('activityLogs').length).toBe(logsBefore); // logs kept for a year
    expect(result.removed.news).toBe(1);

    runRetention(db, config.dataDir, config.retention, now + 31 * DAY);
    expect(db.getRow('notifications', 'notif-read')).toBeNull();
    expect(db.getRow('notifications', 'notif-unread')).not.toBeNull();
    // Removals are tombstoned so connected browsers drop them too.
    expect(db.getRow('news', oldTrash.id, true)?.deleted).toBe(true);
  });

  it('keeps everything when retention is disabled', () => {
    const { db, config } = server;
    const target = db.listCollection('news')[0];
    db.writeRow('news', target.id, { ...target.d, deletedAt: new Date(Date.now() - 400 * DAY).toISOString() }, target.p, null);
    runRetention(db, config.dataDir, { trashDays: 0, notificationDays: 0, logDays: 0, auditLogDays: 0 });
    expect(db.getRow('news', target.id)).not.toBeNull();
  });
});
