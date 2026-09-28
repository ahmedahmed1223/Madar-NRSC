import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
const H = { 'X-NRCS-Client': 'web' };
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(() => server.close());

const sync = (agent: request.Agent, ops: any[]) => agent.post('/api/v1/data/sync').set(H).send({ ops });
const now = new Date().toISOString();
const news = (id: string, videos: unknown) => ({
  c: 'news',
  op: 'upsert',
  id,
  d: { id, title: 'خبر بمقاطع', shortTitle: 'خبر', slug: id, content: '<p>نص</p>', summary: '', mainImageUrl: '', sourceId: '', categoryId: 'cat-1', status: 'DRAFT', priority: 'NORMAL', keywords: [], createdAt: now, updatedAt: now, videos },
});

describe('news video clips on the server', () => {
  it('stores several ordered clips, including written locations', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const clips = [
      { id: 'v1', title: 'الافتتاح', kind: 'location', location: 'خادم المونتاج \\\\NAS01\\القمة', seconds: 40 },
      { id: 'v2', title: 'تصريح', kind: 'link', url: 'https://cdn.example/c.mp4' },
    ];
    const res = await sync(journalist, [news('nws-vid-1', clips)]);
    expect(res.body.results[0].ok).toBe(true);
    expect(server.db.getRow('news', 'nws-vid-1')!.d.videos.map((v: any) => v.id)).toEqual(['v1', 'v2']);
  });

  it('refuses incomplete or malformed clips with a clear reason', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const res = await sync(journalist, [news('nws-vid-2', [{ id: 'v1', title: 'x', kind: 'location', location: '' }])]);
    expect(res.body.results[0].ok).toBe(false);
    expect(res.body.results[0].message).toMatch(/أين يوجد المقطع/);
    const bad = await sync(journalist, [news('nws-vid-3', [{ id: 'v1', title: 'x', kind: 'link', url: 'javascript:alert(1)' }])]);
    expect(bad.body.results[0].ok).toBe(false);
  });
});
