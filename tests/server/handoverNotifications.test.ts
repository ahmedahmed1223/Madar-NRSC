import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { wantsDelivery } from '../../src/shared/notifications';
let server: Awaited<ReturnType<typeof createTestServer>>;
let author: Awaited<ReturnType<typeof loginAgent>>;
let recipientId: string;
let version: number;
const post = (url: string, body: any) => author.post(`/api/v1/shift-handovers${url}`).set('X-NRCS-Client', 'web').send(body);
beforeAll(async () => {
  server = await createTestServer();
  author = await loginAgent(server.app, 'editor@akhbar.tv');
  recipientId = server.db.listCollection('users').find(r => r.d.email === 'journalist@akhbar.tv')!.id;
  server.db.writeRow('roster', 'incoming', { id: 'incoming', departmentId: 'newsroom', date: '2026-10-11', shift: 'EVENING', userId: recipientId }, 0, null);
  server.db.writeRow('notificationPrefs', recipientId, { id: recipientId, userId: recipientId, channels: { assignment: { email: false, push: false } }, watchWords: [], flashAlerts: false }, 0, null);
  const created = await post('', { id: 'notify-shift', schemaVersion: 1, departmentId: 'newsroom', sourceDate: '2026-10-11', sourceShift: 'MORNING', recipientDate: '2026-10-11', recipientShift: 'EVENING', title: 'Shift', note: 'Never copy this note into alerts', references: [] });
  version = created.body.row.v;
});
afterAll(() => server.close());
const alerts = () => server.db.listCollection('notifications').filter(r => r.d.linkUrl === '/roster?tab=handover');
it('alerts current eligible recipients once without notes or delivery-consent bypass', async () => {
  expect((await post('/notify-shift/publish', { baseV: version })).status).toBe(200);
  expect((await post('/notify-shift/publish', { baseV: version })).status).toBe(409);
  expect(alerts()).toHaveLength(1);
  const notification = alerts()[0].d;
  expect(notification.userId).toBe(recipientId);
  expect(notification.urgent).toBeUndefined();
  expect(JSON.stringify(notification)).not.toContain('Never copy');
  expect(wantsDelivery(server.db.getRow('notificationPrefs', recipientId)!.d, notification.category, 'email')).toBe(false);
  expect(wantsDelivery(server.db.getRow('notificationPrefs', recipientId)!.d, notification.category, 'push')).toBe(false);
});
it('persists reminder cooldown and permits exactly the ten-minute boundary', async () => {
  const date = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-11T12:00:00Z'));
  try {
    expect((await post('/notify-shift/remind', {})).status).toBe(200);
    date.mockReturnValue(Date.parse('2026-10-11T12:00:00Z') + 599999);
    expect((await post('/notify-shift/remind', {})).status).toBe(429);
    date.mockReturnValue(Date.parse('2026-10-11T12:00:00Z') + 600000);
    expect((await post('/notify-shift/remind', {})).status).toBe(200);
    expect(alerts()).toHaveLength(3);
  } finally { date.mockRestore(); }
});
it('revoked view permission and removed roster members are not alerted', async () => {
  const row = server.db.getRow('users', recipientId)!;
  server.db.writeRow('users', recipientId, { ...row.d, customPermissions: ['!handover.view'] }, row.p, null);
  const date = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-11T13:00:00Z'));
  try {
    expect((await post('/notify-shift/remind', {})).body.sent).toBe(0);
    expect(alerts()).toHaveLength(3);
  } finally { date.mockRestore(); }
});
