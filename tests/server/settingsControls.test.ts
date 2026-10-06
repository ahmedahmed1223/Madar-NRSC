import { afterEach, beforeEach, expect, it } from 'vitest';
import request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';
import { publishDueScheduledNews } from '../../src/server/scheduler';
let server: Awaited<ReturnType<typeof createTestServer>>;
beforeEach(async () => { server = await createTestServer(); });
afterEach(() => server.close());
it('scheduled breaking stories use the configured duration', () => {
  const settings = server.db.getRow('settings', 'singleton')!;
  server.db.writeRow('settings', settings.id, { ...settings.d, breakingDurationHours: 1 }, settings.p, null);
  const row = server.db.listCollection('news')[0];
  const now = new Date();
  server.db.writeRow('news', row.id, { ...row.d, status: 'SCHEDULED', isBreaking: true, embargoUntil: undefined, scheduledDate: now.toISOString() }, row.p, null);
  expect(publishDueScheduledNews(server.db, now)).toContain(row.id);
  expect(server.db.getRow('news', row.id)!.d.breakingUntil).toBe(new Date(now.getTime() + 3600000).toISOString());
});
it('runtime information requires permission and contains no secrets', async () => {
  expect((await request(server.app).get('/api/v1/admin/runtime')).status).toBe(401);
  const editor = await loginAgent(server.app, 'editor@akhbar.tv');
  expect((await editor.get('/api/v1/admin/runtime')).status).toBe(403);
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const response = await admin.get('/api/v1/admin/runtime');
  expect(response.status).toBe(200);
  expect(response.body.data.sessionTtlHours).toBe(12);
  expect(Object.keys(response.body.data).sort()).toEqual(['version', 'databaseHealthy', 'sessionTtlHours', 'rateLimitPerMinute', 'backupIntervalHours', 'backupRetention', 'externalBackup', 'cloudBackup', 'secureCookie'].sort());
});
it('accepted settings changes have a server-owned before and after audit trail', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const row = server.db.getRow('settings', 'singleton')!;
  const response = await admin.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [{ c: 'settings', op: 'upsert', id: 'singleton', baseV: row.v, d: { ...row.d, defaultTimezone: 'Asia/Tokyo' } }] });
  expect(response.body.results[0].ok).toBe(true);
  const logs = server.db.listCollection('auditLogs').map(row => row.d).filter(row => row.actionType === 'SETTINGS_UPDATE');
  expect(logs).toHaveLength(1);
  expect(logs[0].details).toContain('Asia/Tokyo');
  expect(logs[0].details).toContain(row.d.defaultTimezone);
});
