import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

beforeAll(async () => {
  server = await createTestServer({ NEWS_ACTIVE_DAYS: '30' });
  const settings = server.db.getRow('settings', 'singleton')!;
  server.db.writeRow('settings', 'singleton', {
    ...settings.d,
    stations: [{ id: 'gaza', name: 'غزة', linkedIds: [] }, { id: 'beirut', name: 'بيروت', linkedIds: [] }],
    stationGroups: [{ id: 'all-test', name: 'المجموعتان', stationIds: ['gaza', 'beirut'] }],
  }, settings.p, null);
  for (const [email, stationId] of [['editor@akhbar.tv', 'gaza'], ['journalist@akhbar.tv', 'beirut']]) {
    const user = server.db.getRow('users', server.db.getCredentialsByEmail(email)!.userId)!;
    server.db.writeRow('users', user.id, { ...user.d, stationId }, user.p, null);
  }
  const put = (id: string, email: string, days: number, extra: Record<string, unknown> = {}) => {
    const authorId = server.db.getCredentialsByEmail(email)!.userId;
    const createdAt = ago(days);
    const approvedAt = new Date(Date.parse(createdAt) + 90_000).toISOString();
    server.db.writeRow('news', id, {
      id, title: 'مادة إحصائية', authorId, status: 'PUBLISHED', categoryId: 'report-fixture', createdAt, approvedAt, updatedAt: createdAt,
      ...extra,
    }, 0, null);
    // The archive window also uses the storage timestamp, independently of report dates.
    (server.db as any).db.prepare("UPDATE entities SET updated_at = ? WHERE collection = 'news' AND id = ?").run(createdAt, id);
  };
  put('report-archive', 'editor@akhbar.tv', 200);
  put('report-current', 'editor@akhbar.tv', 1, { status: 'DRAFT', approvedAt: null });
  put('report-other', 'journalist@akhbar.tv', 200);
  put('report-trash', 'editor@akhbar.tv', 1, { deletedAt: ago(0) });
});

afterAll(() => server.close());

it('aggregates archived and active news once, with date, category and station filters', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const boot = await admin.get('/api/v1/data');
  expect(boot.body.collections.news.map((row: { id: string }) => row.id)).not.toContain('report-archive');
  const report = (filters: Record<string, string>) => admin.get('/api/v1/reports/news').query({ category: 'report-fixture', ...filters });
  const all = await report({ station: 'group:all-test' });
  expect(all.status).toBe(200);
  expect(all.body.data).toMatchObject({
    totals: { total: 3, published: 2, drafts: 1 },
    byStation: { gaza: { total: 2 }, beirut: { total: 1 } },
    byCategory: { 'report-fixture': 3 },
    avgApprovalMinutes: 2,
  });
  const recent = await report({ station: 'gaza', since: ago(7) });
  expect(recent.body.data).toMatchObject({ totals: { total: 1, drafts: 1 }, avgApprovalMinutes: null });
  expect((await report({ since: 'invalid' })).status).toBe(400);
});

it('does not aggregate other stations for a restricted editor or allow a hidden report screen', async () => {
  const editor = await loginAgent(server.app, 'editor@akhbar.tv');
  const response = await editor.get('/api/v1/reports/news').query({ category: 'report-fixture', station: 'group:all-test' });
  expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({ totals: { total: 2 }, byCategory: { 'report-fixture': 2 } });
  expect(response.body.data.byStation.beirut).toBeUndefined();
  const source = await editor.get('/api/v1/reports/news').query({ category: 'report-fixture', station: 'group:all-test', records: 'PUBLISHED' });
  expect(source.status).toBe(200);
  expect(source.body.data.rows.map((row: { id: string }) => row.id)).toEqual(['report-archive']);
  const viewer = await loginAgent(server.app, 'trainee@akhbar.tv');
  expect((await viewer.get('/api/v1/reports/news')).status).toBe(403);
});

it('refreshes a previously requested report after an archived record changes', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const query = { category: 'report-fixture', station: 'gaza' };
  const report = () => admin.get('/api/v1/reports/news').query(query);
  expect((await report()).body.data.totals.published).toBe(1);
  const row = server.db.getRow('news', 'report-archive')!;
  server.db.writeRow('news', row.id, { ...row.d, status: 'ARCHIVED' }, row.p, null);
  expect((await report()).body.data.totals).toMatchObject({ published: 0, total: 2 });
});
