import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
const H = { 'X-NRCS-Client': 'web' };
beforeAll(async () => {
  server = await createTestServer();
  server.db.writeRow('news', 'news-c1', { id: 'news-c1', title: 'خبر للنقاش', authorId: 'usr-3', status: 'DRAFT' }, 0, null);
});
afterAll(() => server.close());

const sync = (agent: request.Agent, ops: any[]) => agent.post('/api/v1/data/sync').set(H).send({ ops });
const put = (d: any, baseV?: number) => ({ c: 'comments', op: 'upsert', id: d.id, d, ...(baseV ? { baseV } : {}) });
const row = (id: string) => server.db.getRow('comments', id)!;
const target = { kind: 'news', id: 'news-c1', title: 'خبر للنقاش' };

describe('team comments', () => {
  it('stamps the author, keeps only real mentions and notifies mentioned colleagues and the story author', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv'); // usr-2
    const res = await sync(editor, [
      put({ id: 'cm-1', target, text: '  راجع الفقرة الثانية @محمد  ', mentions: ['usr-7', 'usr-2', 'usr-ghost'], authorId: 'usr-9', authorName: 'مزيف' }),
    ]);
    expect(res.body.results[0].ok).toBe(true);
    const c = row('cm-1').d;
    expect(c.authorId).toBe('usr-2');
    expect(c.authorName).not.toBe('مزيف');
    expect(c.text).toBe('راجع الفقرة الثانية @محمد');
    expect(c.mentions).toEqual(['usr-7']); // self and unknown users are dropped

    const notes = server.db.listCollection('notifications').map((n) => n.d).filter((n) => n.linkUrl === '/news/news-c1');
    expect(notes.some((n) => n.userId === 'usr-7' && /أشار إليك/.test(n.title))).toBe(true);
    expect(notes.some((n) => n.userId === 'usr-3' && /على خبرك/.test(n.title))).toBe(true);
    expect(notes.some((n) => n.userId === 'usr-2')).toBe(false);
  });

  it('comments cannot be edited, only their author deletes them, and bad input is refused', async () => {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const edit = await sync(editor, [put({ ...row('cm-1').d, text: 'نص معدل' }, row('cm-1').v)]);
    expect(edit.body.results[0].code).toBe('FORBIDDEN');

    const stranger = await sync(journalist, [put({ ...row('cm-1').d, deletedAt: new Date().toISOString() }, row('cm-1').v)]);
    expect(stranger.body.results[0].code).toBe('FORBIDDEN');

    const own = await sync(editor, [put({ ...row('cm-1').d, deletedAt: new Date().toISOString() }, row('cm-1').v)]);
    expect(own.body.results[0].ok).toBe(true);

    const empty = await sync(journalist, [put({ id: 'cm-2', target, text: '   ' })]);
    expect(empty.body.results[0].ok).toBe(false);
    const badTarget = await sync(journalist, [put({ id: 'cm-3', target: { kind: 'x', id: '1', title: 'x' }, text: 'مرحبا' })]);
    expect(badTarget.body.results[0].ok).toBe(false);
  });
});
