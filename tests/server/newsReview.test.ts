import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { contentSignature } from '../../src/shared/newsWorkflow';

let server: Awaited<ReturnType<typeof createTestServer>>;
const H = { 'X-NRCS-Client': 'web' };

beforeAll(async () => {
  server = await createTestServer();
  // The demo seed has no quality reviewer: make the media account one for these tests.
  const media = server.db.listCollection('users').find((r) => r.d.email === 'media@akhbar.tv')!;
  server.db.writeRow('users', media.id, { ...media.d, role: 'QUALITY' }, media.p, null);
});
afterAll(() => server.close());

const sync = (agent: any, ops: any[]) => agent.post('/api/v1/data/sync').set(H).send({ ops });
const me = async (agent: any) => (await agent.get('/api/v1/auth/me')).body.user;

/** A story by the journalist, freshly submitted for review. */
async function underReview(id: string) {
  const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
  const author = await me(journalist);
  const now = new Date().toISOString();
  const d = {
    id,
    title: `خبر للمراجعة ${id}`,
    shortTitle: 'خبر',
    slug: id,
    summary: 'مقدمة الخبر',
    content: '<p>نص الخبر الكامل يحتوي على أكثر من عشر كلمات حتى يصلح للمراجعة والاعتماد في النظام</p>',
    status: 'UNDER_REVIEW',
    authorId: author.id,
    authorName: author.fullName,
    priority: 'NORMAL',
    keywords: [],
    locationName: '',
    eventDate: now,
    isBreaking: false,
    mainImageUrl: '',
    sourceId: '',
    categoryId: '',
    workflowLogs: [{ id: `${id}-l0`, newsId: id, fromStatus: 'UNDER_REVIEW', toStatus: 'UNDER_REVIEW', changedBy: { id: author.id, name: author.fullName, role: 'JOURNALIST' }, timestamp: now }],
    viewsCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  const res = await sync(journalist, [{ c: 'news', op: 'upsert', id, d }]);
  expect(res.body.results[0].ok).toBe(true);
  return server.db.getRow('news', id)!;
}

describe('quality pass and review claims on the server', () => {
  it('records «اجتازت التدقيق» from quality, logged, without approving', async () => {
    const row = await underReview('nws-qc-1');
    const quality = await loginAgent(server.app, 'media@akhbar.tv');
    const q = await me(quality);
    const at = new Date().toISOString();
    const log = { id: 'qc-log', newsId: row.id, fromStatus: 'UNDER_REVIEW', toStatus: 'UNDER_REVIEW', changedBy: { id: q.id, name: q.fullName, role: 'QUALITY' }, timestamp: at, comment: 'اجتازت التدقيق', action: 'QUALITY_PASSED' };
    const pass = { byId: q.id, byName: q.fullName, at, signature: contentSignature(row.d) };
    const ok = await sync(quality, [{ c: 'news', op: 'upsert', id: row.id, baseV: row.v, d: { ...row.d, qualityCheck: pass, workflowLogs: [...row.d.workflowLogs, log] } }]);
    expect(ok.body.results[0]).toMatchObject({ ok: true });
    const saved = server.db.getRow('news', row.id)!;
    expect(saved.d.status).toBe('UNDER_REVIEW');
    expect(saved.d.qualityCheck.byId).toBe(q.id);
    // Quality still cannot approve.
    const approve = await sync(quality, [{ c: 'news', op: 'upsert', id: row.id, baseV: saved.v, d: { ...saved.d, status: 'APPROVED' } }]);
    expect(approve.body.results[0].ok).toBe(false);
  });

  it('refuses a pass in someone else’s name or by someone without review rights', async () => {
    const row = await underReview('nws-qc-2');
    const reporter = await loginAgent(server.app, 'reporter@akhbar.tv');
    const r = await me(reporter);
    const at = new Date().toISOString();
    const log = { id: 'qc-log2', newsId: row.id, fromStatus: 'UNDER_REVIEW', toStatus: 'UNDER_REVIEW', changedBy: { id: r.id, name: r.fullName, role: 'REPORTER' }, timestamp: at, action: 'QUALITY_PASSED' };
    const res = await sync(reporter, [{ c: 'news', op: 'upsert', id: row.id, baseV: row.v, d: { ...row.d, qualityCheck: { byId: r.id, byName: r.fullName, at, signature: contentSignature(row.d) }, workflowLogs: [...row.d.workflowLogs, log] } }]);
    expect(res.body.results[0].ok).toBe(false);
    const quality = await loginAgent(server.app, 'media@akhbar.tv');
    const forged = await sync(quality, [{ c: 'news', op: 'upsert', id: row.id, baseV: row.v, d: { ...row.d, qualityCheck: { byId: 'usr-1', byName: 'مزور', at, signature: contentSignature(row.d) }, workflowLogs: [...row.d.workflowLogs, log] } }]);
    expect(forged.body.results[0].ok).toBe(false);
  });

  it('a claim keeps a second reviewer from deciding the same story', async () => {
    const row = await underReview('nws-claim-1');
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const e = await me(editor);
    const at = new Date().toISOString();
    const claimed = await sync(editor, [{ c: 'news', op: 'upsert', id: row.id, baseV: row.v, d: { ...row.d, reviewClaim: { userId: e.id, userName: e.fullName, at } } }]);
    expect(claimed.body.results[0]).toMatchObject({ ok: true });
    const current = server.db.getRow('news', row.id)!;
    const quality = await loginAgent(server.app, 'media@akhbar.tv');
    const q = await me(quality);
    const ret = await sync(quality, [{ c: 'news', op: 'upsert', id: row.id, baseV: current.v, d: { ...current.d, status: 'NEEDS_REVISION' } }]);
    expect(ret.body.results[0].ok).toBe(false);
    expect(ret.body.results[0].message).toContain(e.fullName);
    // Nor can quality take the claim over or clear it.
    const steal = await sync(quality, [{ c: 'news', op: 'upsert', id: row.id, baseV: current.v, d: { ...current.d, reviewClaim: { userId: q.id, userName: q.fullName, at: new Date().toISOString() } } }]);
    expect(steal.body.results[0].ok).toBe(false);
    const clear = await sync(quality, [{ c: 'news', op: 'upsert', id: row.id, baseV: current.v, d: { ...current.d, reviewClaim: undefined } }]);
    expect(clear.body.results[0].ok).toBe(false);
    // The holder decides.
    const approve = await sync(editor, [{ c: 'news', op: 'upsert', id: row.id, baseV: current.v, d: { ...current.d, status: 'APPROVED' } }]);
    expect(approve.body.results[0].ok).toBe(true);
  });
});

describe('breaking from the field', () => {
  it('a reporter sends a breaking request for review but cannot put it on air', async () => {
    const reporter = await loginAgent(server.app, 'reporter@akhbar.tv');
    const r = await me(reporter);
    const now = new Date().toISOString();
    const base = {
      id: 'nws-field-1',
      title: 'انفجار في محيط الميناء',
      shortTitle: 'انفجار',
      slug: 'nws-field-1',
      summary: 'سُمع دوي انفجار قرب الميناء',
      content: '<p>غزة — سُمع دوي انفجار قرب الميناء قبل دقائق [عاجل من الميدان: يُستكمل النص في الديسك]</p>',
      status: 'UNDER_REVIEW',
      authorId: r.id,
      authorName: r.fullName,
      priority: 'URGENT',
      keywords: ['عاجل'],
      locationName: 'غزة',
      eventDate: now,
      isBreaking: false,
      mainImageUrl: '',
      sourceId: '',
      categoryId: '',
      workflowLogs: [],
      viewsCount: 0,
      createdAt: now,
      updatedAt: now,
      breakingRequest: { byId: r.id, byName: r.fullName, at: now },
    };
    const ok = await sync(reporter, [{ c: 'news', op: 'upsert', id: base.id, d: base }]);
    expect(ok.body.results[0]).toMatchObject({ ok: true });
    const onAir = await sync(reporter, [{ c: 'news', op: 'upsert', id: 'nws-field-2', d: { ...base, id: 'nws-field-2', slug: 'nws-field-2', isBreaking: true } }]);
    expect(onAir.body.results[0].ok).toBe(false);
  });
});

describe('«المصادر» desk actions', () => {
  it('stores a manual observation and per-colleague follow-up marks', async () => {
    const reporter = await loginAgent(server.app, 'reporter@akhbar.tv');
    const r = await me(reporter);
    const wire = {
      id: 'wire-manual-test1',
      manual: true,
      sourceId: 'manual',
      sourceName: 'قناة محلية',
      medium: 'TV',
      title: 'مؤتمر صحفي لوزير الصحة الآن',
      summary: 'يتحدث عن الإمدادات الطبية',
      categories: [],
      publishedAt: new Date(Date.now() - 120_000).toISOString(),
      fetchedAt: new Date().toISOString(),
      createdById: r.id,
      createdByName: r.fullName,
    };
    const created = await sync(reporter, [{ c: 'wires', op: 'upsert', id: wire.id, d: wire }]);
    expect(created.body.results[0]).toMatchObject({ ok: true });
    const row = server.db.getRow('wires', wire.id)!;

    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const e = await me(editor);
    const marked = await sync(editor, [{ c: 'wires', op: 'upsert', id: wire.id, baseV: row.v, d: { ...row.d, handled: [{ userId: e.id, userName: e.fullName, at: new Date().toISOString() }] } }]);
    expect(marked.body.results[0]).toMatchObject({ ok: true });
    const after = server.db.getRow('wires', wire.id)!;
    // Nobody marks for a colleague, removes a colleague's mark, or rewrites the item.
    expect((await sync(reporter, [{ c: 'wires', op: 'upsert', id: wire.id, baseV: after.v, d: { ...after.d, handled: [] } }])).body.results[0].ok).toBe(false);
    expect((await sync(editor, [{ c: 'wires', op: 'upsert', id: wire.id, baseV: after.v, d: { ...after.d, title: 'تغيير' } }])).body.results[0].ok).toBe(false);
    // Agency items cannot be created by hand.
    const fake = { ...wire, id: 'wire-abc', manual: false, sourceId: 'src-1' };
    expect((await sync(reporter, [{ c: 'wires', op: 'upsert', id: fake.id, d: fake }])).body.results[0].ok).toBe(false);
  });
});
