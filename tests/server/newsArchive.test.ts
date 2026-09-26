import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
const H = { 'X-NRCS-Client': 'web' };
beforeAll(async () => {
  server = await createTestServer({ NEWS_ACTIVE_DAYS: '30' });
});
afterAll(() => server.close());

/** Writes a news row and back-dates its server timestamp. */
function putNews(id: string, data: Record<string, any>, daysAgo: number) {
  server.db.writeRow('news', id, { id, title: id, summary: '', content: '', ...data }, 0, null);
  const ts = new Date(Date.now() - daysAgo * 86400000).toISOString();
  (server.db as any).db.prepare(`UPDATE entities SET updated_at = ? WHERE collection = 'news' AND id = ?`).run(ts, id);
}

describe('news archive window', () => {
  it('keeps old finished news out of the synced newsroom but reachable by search', async () => {
    putNews('nws-old-pub', { status: 'PUBLISHED', title: 'قمة المناخ 2020 50%_done' }, 200);
    putNews('nws-old-draft', { status: 'DRAFT', title: 'مسودة قديمة' }, 200);
    putNews('nws-new-pub', { status: 'PUBLISHED', title: 'خبر حديث' }, 1);

    const reporter = await loginAgent(server.app, 'reporter@akhbar.tv');
    const boot = await reporter.get('/api/v1/data');
    const ids = boot.body.collections.news.map((r: any) => r.id);
    expect(ids).not.toContain('nws-old-pub'); // finished and untouched for 200 days
    expect(ids).toContain('nws-old-draft'); // unfinished work always stays
    expect(ids).toContain('nws-new-pub');

    const all = await reporter.get('/api/v1/archive/news');
    expect(all.body.data.items.map((i: any) => i.id)).toContain('nws-old-pub');
    const hit = await reporter.get('/api/v1/archive/news').query({ q: 'المناخ' });
    expect(hit.body.data.items.map((i: any) => i.id)).toEqual(['nws-old-pub']);
    const literal = await reporter.get('/api/v1/archive/news').query({ q: '50%_' });
    expect(literal.body.data.total).toBe(1); // LIKE wildcards are matched literally
    const miss = await reporter.get('/api/v1/archive/news').query({ q: '%' });
    expect(miss.body.data.items.map((i: any) => i.id)).toEqual(['nws-old-pub']);

    const full = await reporter.get('/api/v1/archive/news/nws-old-pub');
    expect(full.body.data.title).toContain('قمة المناخ');
  });

  it('only editors can bring a story back, and it then syncs to everyone', async () => {
    const reporter = await loginAgent(server.app, 'reporter@akhbar.tv');
    const denied = await reporter.post('/api/v1/archive/news/nws-old-pub/reactivate').set(H);
    expect(denied.status).toBe(403);

    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const before = (await editor.get('/api/v1/data')).body.rev;
    const ok = await editor.post('/api/v1/archive/news/nws-old-pub/reactivate').set(H);
    expect(ok.body.success).toBe(true);
    const changes = await reporter.get('/api/v1/data/changes').query({ since: before });
    expect(changes.body.changes.map((r: any) => r.id)).toContain('nws-old-pub');
    const archive = await reporter.get('/api/v1/archive/news');
    expect(archive.body.data.items.map((i: any) => i.id)).not.toContain('nws-old-pub');
  });
});
