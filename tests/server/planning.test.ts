import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';
import { alertForWires } from '../../src/server/notifications';
import { deliverPending } from '../../src/server/delivery';
import { localDateString } from '../../src/shared/dates';
import { publishDueScheduledNews } from '../../src/server/scheduler';

let server: Awaited<ReturnType<typeof createTestServer>>;
const H = { 'X-NRCS-Client': 'web' };
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(() => server.close());

const sync = (agent: request.Agent, ops: any[]) => agent.post('/api/v1/data/sync').set(H).send({ ops });
const put = (c: string, d: any, baseV?: number) => ({ c, op: 'upsert', id: d.id, d, ...(baseV ? { baseV } : {}) });
const row = (c: any, id: string) => server.db.getRow(c, id)!;
const now = new Date().toISOString();
const notes = (userId: string) => server.db.listCollection('notifications').map((r) => r.d).filter((n: any) => n.userId === userId);

describe('resource bookings', () => {
  const at = (h: number) => new Date(Date.UTC(2030, 0, 10, h)).toISOString();
  const booking = (id: string, extra: any = {}) => ({ id, resourceId: 'res-studio-2', title: 'تسجيل حلقة', start: at(9), end: at(11), status: 'CONFIRMED', createdAt: now, updatedAt: now, ...extra });

  it('refuses overlapping bookings of the same resource and stamps the booker', async () => {
    const producer = await loginAgent(server.app, 'producer@akhbar.tv'); // usr-4
    const first = await sync(producer, [put('bookings', booking('bkg-t1', { bookedById: 'usr-9', bookedByName: 'مزيف' }))]);
    expect(first.body.results[0].ok).toBe(true);
    expect(row('bookings', 'bkg-t1').d).toMatchObject({ bookedById: 'usr-4', assigneeId: 'usr-4' });

    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const clash = await sync(journalist, [put('bookings', booking('bkg-t2', { start: at(10), end: at(12) }))]);
    expect(clash.body.results[0].code).toBe('INVALID');
    expect(clash.body.results[0].message).toContain('محجوز');

    // Back-to-back is fine; another resource at the same time too.
    expect((await sync(journalist, [put('bookings', booking('bkg-t3', { start: at(11), end: at(12) }))])).body.results[0].ok).toBe(true);
    expect((await sync(journalist, [put('bookings', booking('bkg-t4', { resourceId: 'res-studio-1' }))])).body.results[0].ok).toBe(true);
  });

  it('only the booker or a resources manager changes a booking; trainees cannot book', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const b = row('bookings', 'bkg-t1');
    expect((await sync(journalist, [put('bookings', { ...b.d, status: 'CANCELLED' }, b.v)])).body.results[0].code).toBe('FORBIDDEN');
    const trainee = await loginAgent(server.app, 'trainee@akhbar.tv');
    expect((await sync(trainee, [put('bookings', booking('bkg-t5', { start: at(20), end: at(21) }))])).body.results[0].code).toBe('FORBIDDEN');
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    expect((await sync(editor, [put('bookings', { ...b.d, status: 'CANCELLED' }, b.v)])).body.results[0].ok).toBe(true);
    // Once cancelled the slot is free again.
    expect((await sync(journalist, [put('bookings', booking('bkg-t6', { start: at(9), end: at(10) }))])).body.results[0].ok).toBe(true);
  });

  it('tells the colleague a resource was booked for', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    await sync(editor, [put('bookings', booking('bkg-t7', { resourceId: 'res-cam-2', assigneeId: 'usr-6' }))]);
    expect(notes('usr-6').some((n: any) => n.category === 'booking' && n.linkUrl === '/bookings/bkg-t7')).toBe(true);
  });
});

describe('planning diary', () => {
  const entry = (id: string, extra: any = {}) => ({
    id, title: 'مؤتمر صحفي', date: '2030-01-10', startTime: '10:00', kind: 'PRESSER', coverage: 'COVER', priority: 'NORMAL', assigneeIds: ['usr-6'], createdAt: now, updatedAt: now, ...extra,
  });

  it('planners add entries and assignees are notified; others cannot', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    expect((await sync(journalist, [put('diary', entry('diary-t1'))])).body.results[0].code).toBe('FORBIDDEN');
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    expect((await sync(editor, [put('diary', entry('diary-t1'))])).body.results[0].ok).toBe(true);
    expect(notes('usr-6').some((n: any) => n.category === 'diary' && n.title.includes('مؤتمر صحفي'))).toBe(true);
    expect((await sync(editor, [put('diary', entry('diary-bad', { assigneeIds: ['usr-nobody'] }))])).body.results[0].code).toBe('INVALID');
    expect((await sync(editor, [put('diary', entry('diary-bad2', { date: '10/1/2030' }))])).body.results[0].code).toBe('FORBIDDEN');
  });

  it('an assignee may update notes but not the time or assignment', async () => {
    const reporter = await loginAgent(server.app, 'reporter@akhbar.tv'); // usr-6
    const e = row('diary', 'diary-t1');
    expect((await sync(reporter, [put('diary', { ...e.d, notes: 'وصلت الموقع' }, e.v)])).body.results[0].ok).toBe(true);
    const e2 = row('diary', 'diary-t1');
    expect((await sync(reporter, [put('diary', { ...e2.d, startTime: '12:00' }, e2.v)])).body.results[0].code).toBe('FORBIDDEN');
  });
});

describe('notification preferences, wire alerts and delivery', () => {
  it('each colleague edits and reads only their own preferences', async () => {
    const reporter = await loginAgent(server.app, 'reporter@akhbar.tv'); // usr-6
    const prefs = { id: 'usr-6', userId: 'usr-6', channels: { wire: { push: true, email: true } }, watchWords: ['وزير الطاقة', 'أوبك'], flashAlerts: true };
    expect((await sync(reporter, [put('notificationPrefs', prefs)])).body.results[0].ok).toBe(true);
    expect((await sync(reporter, [put('notificationPrefs', { ...prefs, id: 'usr-3', userId: 'usr-3' })])).body.results[0].code).toBe('FORBIDDEN');
    expect((await sync(reporter, [put('notificationPrefs', { ...prefs, id: 'usr-6b', watchWords: 'x' })])).body.results[0].code).toBe('FORBIDDEN');
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const boot = await journalist.get('/api/v1/data').set(H);
    const rows = boot.body.data?.collections?.notificationPrefs || boot.body.collections?.notificationPrefs || [];
    expect(rows.some((r: any) => r.id === 'usr-6')).toBe(false);
  });

  it('alerts on fresh urgent wires and watch words, not on old ones', () => {
    const fresh = new Date().toISOString();
    const old = new Date(Date.now() - 3 * 3600_000).toISOString();
    const base = { sourceId: 's', sourceName: 'وكالة', summary: '', categories: [], fetchedAt: fresh };
    const before = notes('usr-6').length;
    const n = alertForWires(server.db, [
      { ...base, id: 'w1', title: 'عاجل: انفجار في الميناء', publishedAt: fresh },
      { ...base, id: 'w2', title: 'تصريحات لوزير الطاقة حول الأسعار', publishedAt: fresh },
      { ...base, id: 'w3', title: 'عاجل: خبر قديم', publishedAt: old },
      { ...base, id: 'w4', title: 'أخبار الطقس', publishedAt: fresh },
    ] as any);
    expect(n).toBe(2);
    const mine = notes('usr-6').slice(0, notes('usr-6').length - before);
    expect(mine.map((x: any) => x.linkUrl).sort()).toEqual(['/wires/w1', '/wires/w2']);
    expect(mine.find((x: any) => x.linkUrl === '/wires/w1').urgent).toBe(true);
  });

  it('delivery starts from now and skips when nothing is configured', async () => {
    const first = await deliverPending(server.db, server.config);
    expect(first).toEqual({ push: 0, email: 0, skipped: 0 });
    const res = await deliverPending(server.db, server.config);
    expect(res.email).toBe(0);
  });

  it('exposes delivery status and validates push subscriptions', async () => {
    const reporter = await loginAgent(server.app, 'reporter@akhbar.tv');
    const status = await reporter.get('/api/v1/notifications/delivery').set(H);
    expect(status.status).toBe(200);
    expect(status.body.data).toMatchObject({ email: false });
    expect(status.body.data.publicKey.length).toBeGreaterThan(40);
    const bad = await reporter.post('/api/v1/notifications/push/subscribe').set(H).send({ subscription: { endpoint: 'http://evil', keys: {} } });
    expect(bad.status).toBe(400);
    const ok = await reporter
      .post('/api/v1/notifications/push/subscribe')
      .set(H)
      .send({ subscription: { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'BExample', auth: 'secret' } } });
    expect(ok.status).toBe(200);
    expect(server.db.listPushSubscriptions('usr-6')).toHaveLength(1);
    await reporter.post('/api/v1/notifications/push/unsubscribe').set(H).send({ endpoint: 'https://push.example.com/abc' });
    expect(server.db.listPushSubscriptions('usr-6')).toHaveLength(0);
  });
});

describe('embargo', () => {
  it('blocks publishing before the embargo ends and the scheduler waits for it', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const until = new Date(Date.now() + 3600_000).toISOString();
    const base = { ...row('news', 'nws-1').d, id: 'nws-emb-1', status: 'APPROVED', embargoUntil: until, workflowLogs: [] };
    server.db.writeRow('news', base.id, base, 0, null);
    const res = await sync(editor, [put('news', { ...base, status: 'PUBLISHED' }, row('news', base.id).v)]);
    expect(res.body.results[0].ok).toBe(false);
    expect(res.body.results[0].message).toContain('الحظر');
  });

  it('scheduled items under embargo are not published by the scheduler', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const until = new Date(Date.now() + 3600_000).toISOString();
    const r = row('news', 'nws-2');
    server.db.writeRow('news', 'nws-2', { ...r.d, status: 'SCHEDULED', scheduledDate: past, embargoUntil: until }, r.p, null);
    publishDueScheduledNews(server.db);
    expect(row('news', 'nws-2').d.status).toBe('SCHEDULED');
    // Once the embargo has passed, it goes out.
    const r2 = row('news', 'nws-2');
    server.db.writeRow('news', 'nws-2', { ...r2.d, embargoUntil: past }, r2.p, null);
    publishDueScheduledNews(server.db);
    expect(row('news', 'nws-2').d.status).toBe('PUBLISHED');
  });
});

describe('demo data removal', () => {
  it('needs settings rights and a typed confirmation, then removes seeded samples only', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    expect((await journalist.get('/api/v1/admin/demo-data').set(H)).status).toBe(403);
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const info = await admin.get('/api/v1/admin/demo-data').set(H);
    expect(info.body.data.counts.news).toBeGreaterThan(0);
    expect(info.body.data.counts.diary).toBeGreaterThan(0);
    // Something a person created must survive.
    const mine = { id: 'nws-real-1', title: 'خبر حقيقي', content: '', status: 'DRAFT', authorId: 'usr-1', createdAt: now, updatedAt: now };
    server.db.writeRow('news', mine.id, mine, 0, null);
    expect((await admin.post('/api/v1/admin/demo-data/remove').set(H).send({})).status).toBe(400);
    const res = await admin.post('/api/v1/admin/demo-data/remove').set(H).send({ confirm: 'حذف', includeUsers: false });
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThan(10);
    expect(server.db.getRow('news', 'nws-1')).toBeNull();
    expect(server.db.getRow('news', 'nws-real-1')).not.toBeNull();
    expect(server.db.getRow('users', 'usr-3')).not.toBeNull();
    expect(server.db.getMeta('demo_removed')).toBe('1');
    const after = await admin.get('/api/v1/admin/demo-data').set(H);
    expect(Object.values(after.body.data.counts).reduce((a: any, b: any) => a + b, 0)).toBe(0);
  });

  it('can also remove demo accounts but never the acting administrator', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const me = (await admin.get('/api/v1/auth/me').set(H)).body;
    const myId = me.data?.user?.id || me.user?.id || me.data?.id;
    const res = await admin.post('/api/v1/admin/demo-data/remove').set(H).send({ confirm: 'حذف', includeUsers: true });
    expect(res.status).toBe(200);
    expect(server.db.getRow('users', 'usr-3')).toBeNull();
    expect(server.db.getRow('users', myId)).not.toBeNull();
    expect(localDateString()).toBeTruthy();
  });
});
