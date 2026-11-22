import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
let admin: Awaited<ReturnType<typeof loginAgent>>;
let journalist: Awaited<ReturnType<typeof loginAgent>>;

async function sync(agent: typeof admin, ops: unknown[]) {
  const result = await agent.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops });
  expect(result.status).toBe(200);
  return result.body.results;
}

beforeAll(async () => {
  server = await createTestServer();
  admin = await loginAgent(server.app, 'admin@akhbar.tv');
  journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
});
afterAll(() => server.close());

it('stores nested categories and rejects missing parents, cycles, and deletion with children', async () => {
  const category = (id: string, parentId?: string | null, baseV?: number) => (
    { c: 'categories', op: 'upsert', id, d: { id, nameAr: id, parentId }, baseV }
  );
  const [parent, child, grandchild] = await sync(admin, [
    category('cat-parent'), category('cat-child', 'cat-parent'), category('cat-grandchild', 'cat-child'),
  ]);
  expect([parent, child, grandchild].map(row => row.ok)).toEqual([true, true, true]);
  expect(grandchild.row.d.parentId).toBe('cat-child');

  const denied = await sync(admin, [
    category('cat-missing-parent', 'cat-unknown'),
    category('cat-self-parent', 'cat-self-parent'),
    category('cat-parent', 'cat-grandchild', parent.row.v),
    { c: 'categories', op: 'delete', id: 'cat-child', baseV: child.row.v },
  ]);
  expect(denied.map(row => row.ok)).toEqual([false, false, false, false]);
  expect((await sync(journalist, [category('cat-forbidden', 'cat-parent')]))[0].ok).toBe(false);

  const [moved, removed] = await sync(admin, [
    category('cat-grandchild', null, grandchild.row.v),
    { c: 'categories', op: 'delete', id: 'cat-child', baseV: child.row.v },
  ]);
  expect(moved).toMatchObject({ ok: true, row: { d: { parentId: null } } });
  expect(removed.ok).toBe(true);
});

it('sends one immediate private keyword alert for new and newly matching updated items', async () => {
  const prefs = { channels: {}, watchWords: [], newsWatchWords: ['أُوبك', 'اجتماع النفط'], flashAlerts: false, quietFrom: '00:00', quietTo: '23:59' };
  const savePrefs = (id: string) => ({ c: 'notificationPrefs', op: 'upsert', id, d: { id, userId: id, ...prefs } });
  const [saved] = await sync(journalist, [savePrefs('usr-3')]);
  expect(saved.ok).toBe(true);
  expect((await sync(admin, [{ ...savePrefs('usr-3'), baseV: saved.row.v }]))[0].ok).toBe(false);
  expect((await sync(journalist, [{
    ...savePrefs('usr-3'), baseV: saved.row.v, d: { ...prefs, userId: 'usr-3', newsWatchWords: ['،'] },
  }]))[0].ok).toBe(false);
  const noNewsUser = server.db.getRow('users', 'usr-3')!.d;
  server.db.writeRow('users', 'usr-no-news', {
    ...noNewsUser, id: 'usr-no-news', email: 'without-news@akhbar.tv', role: 'JOURNALIST',
    customPermissions: ['!news.view'],
  }, 100, null);
  server.db.writeRow('notificationPrefs', 'usr-no-news', { id: 'usr-no-news', userId: 'usr-no-news', ...prefs }, 100, null);

  const base = {
    status: 'DRAFT', authorId: 'usr-1', isBreaking: false, keywords: [],
    content: '<p>هذا خبر اختباري مكتمل يتيح متابعة المعلومات الواردة عن هذا الموضوع في غرفة الأخبار.</p>',
  };
  const news = (id: string, title: string, additional: object = {}, baseV?: number) => (
    { c: 'news', op: 'upsert', id, d: { ...base, id, title, ...additional }, baseV }
  );
  const rev = server.db.currentRev();
  expect((await sync(admin, [{
    c: 'notifications', op: 'upsert', id: 'forged-keyword-alert', d: { category: 'news-keyword', userId: 'usr-3' },
  }]))[0].ok).toBe(false);
  const [created, initial] = await sync(admin, [
    news('news-watch-new', 'أعلنت أوبك نتائج اجتماع النفط'),
    news('news-watch-edit', 'جدول الاجتماعات اليومية'),
  ]);
  expect([created.ok, initial.ok]).toEqual([true, true]);
  const edited = (await sync(admin, [
    news('news-watch-edit', 'جدول الاجتماعات اليومية', { keywords: ['أوبك'] }, initial.row.v),
  ]))[0];
  expect(edited.ok).toBe(true);
  expect((await sync(admin, [
    news('news-watch-edit', 'تفاصيل جديدة', { keywords: ['أوبك'] }, edited.row.v),
  ]))[0].ok).toBe(true);

  const own = await journalist.get(`/api/v1/data/changes?since=${rev}`);
  const alerts = own.body.changes.filter((row: any) => row.c === 'notifications' && row.d?.category === 'news-keyword');
  expect(alerts.map((row: any) => row.d.linkUrl).sort()).toEqual(['/news/news-watch-edit', '/news/news-watch-new']);
  expect(alerts.every((row: any) => row.d.userId === 'usr-3' && !row.d.isRead)).toBe(true);
  expect(server.db.listCollection('notifications').some(row => row.d.userId === 'usr-no-news')).toBe(false);
  const others = await admin.get(`/api/v1/data/changes?since=${rev}`);
  expect(others.body.changes.some((row: any) => row.c === 'notifications' && row.d?.category === 'news-keyword')).toBe(false);

  const alert = alerts.find((row: any) => row.d.linkUrl === '/news/news-watch-edit');
  expect((await sync(journalist, [
    { c: 'notifications', op: 'delete', id: alert.id, baseV: alert.v },
  ]))[0].ok).toBe(true);
  const current = server.db.getRow('news', 'news-watch-edit')!;
  expect((await sync(admin, [
    news('news-watch-edit', 'إضافة تفاصيل اجتماع النفط', {}, current.v),
  ]))[0].ok).toBe(true);
  expect(server.db.listCollection('notifications').some(row => row.d.linkUrl === '/news/news-watch-edit')).toBe(false);
});
