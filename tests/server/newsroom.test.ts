import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
const H = { 'X-NRCS-Client': 'web' };

beforeAll(async () => {
  server = await createTestServer();
});

afterAll(() => server.close());

async function row(agent: request.Agent, collection: string, id: string) {
  const res = await agent.get('/api/v1/data');
  return res.body.collections[collection].find((r: any) => r.id === id);
}

function sync(agent: request.Agent, ops: any[]) {
  return agent.post('/api/v1/data/sync').set(H).send({ ops });
}

const lockOp = (entityId: string, baseV?: number) => ({
  c: 'editLocks',
  op: 'upsert',
  id: `news:${entityId}`,
  d: { id: `news:${entityId}`, collection: 'news', entityId },
  ...(baseV ? { baseV } : {}),
});

describe('story edit locks', () => {
  it('lets only one person hold a story and blocks others from saving it', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const reporter = await loginAgent(server.app, 'reporter@akhbar.tv');
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');

    const acquired = await sync(journalist, [lockOp('nws-5')]);
    expect(acquired.body.results[0].ok).toBe(true);
    const lock = acquired.body.results[0].row;
    expect(lock.d.userId).toBe('usr-3');
    expect(new Date(lock.d.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // A second journalist-level user cannot grab it.
    const grab = await sync(reporter, [lockOp('nws-5', lock.v)]);
    expect(grab.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    // Nobody else can save the story while it is locked, even an editor.
    const story = await row(editor, 'news', 'nws-5');
    const blocked = await sync(editor, [{ c: 'news', op: 'upsert', id: 'nws-5', d: { ...story.d, title: 'تعديل متزامن' }, baseV: story.v }]);
    expect(blocked.body.results[0]).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(blocked.body.results[0].message).toContain('قيد التحرير');

    // The lock holder can save.
    const own = await sync(journalist, [{ c: 'news', op: 'upsert', id: 'nws-5', d: { ...story.d, summary: 'تحديث صاحب القفل' }, baseV: story.v }]);
    expect(own.body.results[0].ok).toBe(true);

    // An editor may take the lock over, after which the original holder is blocked.
    const takeover = await sync(editor, [lockOp('nws-5', lock.v)]);
    expect(takeover.body.results[0].ok).toBe(true);
    expect(takeover.body.results[0].row.d.userId).toBe('usr-2');
    const latest = await row(journalist, 'news', 'nws-5');
    const late = await sync(journalist, [{ c: 'news', op: 'upsert', id: 'nws-5', d: { ...latest.d, title: 'متأخر' }, baseV: latest.v }]);
    expect(late.body.results[0].code).toBe('CONFLICT');

    // Releasing frees the story.
    await sync(editor, [{ c: 'editLocks', op: 'delete', id: 'news:nws-5' }]);
    const after = await row(journalist, 'news', 'nws-5');
    const free = await sync(journalist, [{ c: 'news', op: 'upsert', id: 'nws-5', d: { ...after.d, title: 'بعد الإفراج' }, baseV: after.v }]);
    expect(free.body.results[0].ok).toBe(true);
  });

  it('treats expired locks as free', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const reporter = await loginAgent(server.app, 'reporter@akhbar.tv');
    const got = await sync(journalist, [lockOp('nws-4')]);
    const lockRow = got.body.results[0].row;
    // Simulate an abandoned editor (browser closed without releasing).
    server.db.writeRow('editLocks', 'news:nws-4', { ...lockRow.d, expiresAt: new Date(Date.now() - 1000).toISOString() }, lockRow.p, 'usr-3');
    const current = server.db.getRow('editLocks', 'news:nws-4')!;
    const res = await sync(reporter, [lockOp('nws-4', current.v)]);
    expect(res.body.results[0].ok).toBe(true);
    await sync(reporter, [{ c: 'editLocks', op: 'delete', id: 'news:nws-4' }]);
  });

  it('rejects malformed lock ids', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const res = await sync(journalist, [{ c: 'editLocks', op: 'upsert', id: 'news:x', d: { id: 'news:x', collection: 'news', entityId: 'y' } }]);
    expect(res.body.results[0].code).toBe('FORBIDDEN');
  });
});

describe('revision history', () => {
  it('keeps every previous version of a story with who changed it', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    let story = await row(editor, 'news', 'nws-3');
    const originalTitle = story.d.title;
    for (const title of ['نسخة أولى', 'نسخة ثانية']) {
      const res = await sync(editor, [{ c: 'news', op: 'upsert', id: 'nws-3', d: { ...story.d, title }, baseV: story.v }]);
      story = res.body.results[0].row;
    }
    const history = await editor.get('/api/v1/history/news/nws-3');
    expect(history.status).toBe(200);
    const titles = history.body.data.map((h: any) => h.data.title);
    expect(titles).toEqual(['نسخة أولى', originalTitle]);
    expect(history.body.data[0].changedByName).toBeTruthy();
    expect(history.body.data[0].version).toBeGreaterThan(history.body.data[1].version);
  });

  it('is limited to supported collections', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    expect((await editor.get('/api/v1/history/users/usr-1')).status).toBe(404);
  });
});

describe('trash', () => {
  it('only users with news.delete can restore a deleted story', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    let story = await row(editor, 'news', 'nws-2');
    const del = await sync(editor, [{ c: 'news', op: 'upsert', id: 'nws-2', d: { ...story.d, deletedAt: new Date().toISOString() }, baseV: story.v }]);
    story = del.body.results[0].row;

    const denied = await sync(journalist, [{ c: 'news', op: 'upsert', id: 'nws-2', d: { ...story.d, deletedAt: null }, baseV: story.v }]);
    expect(denied.body.results[0].code).toBe('FORBIDDEN');

    const restored = await sync(editor, [{ c: 'news', op: 'upsert', id: 'nws-2', d: { ...story.d, deletedAt: null }, baseV: story.v }]);
    expect(restored.body.results[0].ok).toBe(true);
  });
});

describe('journalist workflow end to end', () => {
  it('creates a draft (breaking off), edits it, submits it, and cannot flag breaking', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const base = { title: 'خبر صحفي جديد', status: 'DRAFT', authorId: 'usr-3', isBreaking: false, keywords: [], content: '<p>نص خبر اختبار كامل يحتوي على أكثر من عشر كلمات حتى يمر من قاعدة المحتوى الإلزامي.</p>' };
    const created = await sync(journalist, [{ c: 'news', op: 'upsert', id: 'nws-j-1', d: base }]);
    expect(created.body.results[0].ok).toBe(true);

    const flagged = await sync(journalist, [
      { c: 'news', op: 'upsert', id: 'nws-j-1', d: { ...base, isBreaking: true }, baseV: created.body.results[0].row.v },
    ]);
    expect(flagged.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    const submitted = await sync(journalist, [
      { c: 'news', op: 'upsert', id: 'nws-j-1', d: { ...base, status: 'UNDER_REVIEW' }, baseV: created.body.results[0].row.v },
    ]);
    expect(submitted.body.results[0].ok).toBe(true);

    const direct = await sync(journalist, [{ c: 'news', op: 'upsert', id: 'nws-j-2', d: { ...base, status: 'PUBLISHED' } }]);
    expect(direct.body.results[0].code).toBe('FORBIDDEN');
  });
});

describe('scheduled publishing', () => {
  it('publishes due SCHEDULED stories on the server, with log, audit and history', async () => {
    const { publishDueScheduledNews } = await import('../../src/server/scheduler');
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const base = { title: 'خبر مجدول', content: '<p>نص خبر اختبار كامل يحتوي على أكثر من عشر كلمات حتى يمر من قاعدة المحتوى الإلزامي.</p>', status: 'DRAFT', authorId: 'usr-3', isBreaking: false, keywords: [], workflowLogs: [] };
    let r = (await sync(journalist, [{ c: 'news', op: 'upsert', id: 'nws-sched', d: base }])).body.results[0].row;
    r = (await sync(journalist, [{ c: 'news', op: 'upsert', id: 'nws-sched', d: { ...r.d, status: 'UNDER_REVIEW' }, baseV: r.v }])).body.results[0].row;
    r = (await sync(editor, [{ c: 'news', op: 'upsert', id: 'nws-sched', d: { ...r.d, status: 'APPROVED' }, baseV: r.v }])).body.results[0].row;

    // A journalist cannot schedule; missing dates are rejected.
    const noDate = await sync(editor, [{ c: 'news', op: 'upsert', id: 'nws-sched', d: { ...r.d, status: 'SCHEDULED' }, baseV: r.v }]);
    expect(noDate.body.results[0].code).toBe('FORBIDDEN');
    const when = new Date(Date.now() + 60_000).toISOString();
    r = (await sync(editor, [{ c: 'news', op: 'upsert', id: 'nws-sched', d: { ...r.d, status: 'SCHEDULED', scheduledDate: when }, baseV: r.v }])).body.results[0].row;
    expect(r.d.status).toBe('SCHEDULED');

    expect(publishDueScheduledNews(server.db, new Date())).not.toContain('nws-sched');
    expect(publishDueScheduledNews(server.db, new Date(Date.now() + 120_000))).toContain('nws-sched');
    const published = server.db.getRow('news', 'nws-sched')!.d;
    expect(published.status).toBe('PUBLISHED');
    expect(published.publishedByName).toBe('النشر المجدول');
    expect(published.workflowLogs.at(-1).toStatus).toBe('PUBLISHED');
    const history = await editor.get('/api/v1/history/news/nws-sched');
    expect(history.body.data[0].data.status).toBe('SCHEDULED');
  });
});
