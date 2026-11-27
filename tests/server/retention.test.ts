import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
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

  it('applies independently configured windows and the environment fallback', () => {
    const { db, config } = server;
    const now = Date.now();
    const deletedAt = new Date(now - 11 * DAY).toISOString();
    const settings = db.getRow('settings', 'singleton')!;
    db.writeRow('settings', settings.id, { ...settings.d, trashRetentionDays: { news: 7, guests: 0, resources: 15 } }, settings.p, null);
    db.writeRow('news', 'trash-news-week', { id: 'trash-news-week', deletedAt }, 0, null);
    db.writeRow('guests', 'trash-guest-forever', { id: 'trash-guest-forever', deletedAt }, 0, null);
    db.writeRow('resources', 'trash-resource-fortnight', { id: 'trash-resource-fortnight', deletedAt }, 0, null);
    db.writeRow('programs', 'trash-program-default', { id: 'trash-program-default', deletedAt }, 0, null);

    try {
      runRetention(db, config.dataDir, { ...config.retention, trashDays: 10 }, now);
      expect(db.getRow('news', 'trash-news-week')).toBeNull();
      expect(db.getRow('programs', 'trash-program-default')).toBeNull();
      expect(db.getRow('guests', 'trash-guest-forever')).not.toBeNull();
      expect(db.getRow('resources', 'trash-resource-fortnight')).not.toBeNull();
    } finally {
      db.writeRow('settings', settings.id, settings.d, settings.p, null);
    }
  });

  it('keeps old deletions in newly covered types until that type is explicitly configured', async () => {
    const { db, config } = server;
    const now = Date.now();
    const old = new Date(now - 45 * DAY).toISOString();
    const recent = new Date(now + DAY).toISOString();
    db.writeRow('bulletins', 'trash-bulletin-legacy', { id: 'trash-bulletin-legacy', deletedAt: old }, 0, null);
    db.writeRow('bulletins', 'trash-bulletin-new', { id: 'trash-bulletin-new', deletedAt: recent }, 0, null);

    runRetention(db, config.dataDir, config.retention, now + 32 * DAY);
    expect(db.getRow('bulletins', 'trash-bulletin-legacy')).not.toBeNull();
    expect(db.getRow('bulletins', 'trash-bulletin-new')).toBeNull();

    const settings = db.getRow('settings', 'singleton')!;
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const saved = await admin.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [
      { c: 'settings', op: 'upsert', id: settings.id, baseV: settings.v, d: { ...settings.d, trashRetentionDays: { bulletins: 7 } } },
    ] });
    expect(saved.body.results[0].ok).toBe(true);
    try {
      runRetention(db, config.dataDir, config.retention, now + 32 * DAY);
      expect(db.getRow('bulletins', 'trash-bulletin-legacy')).toBeNull();
    } finally {
      db.writeRow('settings', settings.id, settings.d, settings.p, null);
    }
  });
});
