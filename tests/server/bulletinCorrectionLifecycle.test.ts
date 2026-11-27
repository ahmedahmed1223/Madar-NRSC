import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
const header = { 'X-NRCS-Client': 'web' };
const bulletinId = 'correction-live-bulletin';
const stories = ['correction-first', 'correction-middle', 'correction-later'];
const source = (storyId: string) => `${storyId}-news`;
const journal = `/api/v1/onair/${bulletinId}/correction-requests`;

beforeEach(async () => {
  server = await createTestServer();
  const { db } = server;
  const bulletin = db.listCollection('bulletins')[0].d;
  const templateNews = db.listCollection('news')[0].d;
  const earlier = new Date(Date.now() - 60_000).toISOString();
  db.writeRow('bulletins', bulletinId, { ...bulletin, id: bulletinId, editorId: 'usr-2', approvalSteps: [], status: 'PLANNING' }, 0, null);
  stories.forEach((id, index) => {
    db.writeRow('news', source(id), { ...templateNews, id: source(id), title: `خبر المصدر ${index + 1}`, status: 'PUBLISHED',
      deletedAt: undefined, embargoUntil: undefined, updatedAt: earlier }, index, 'usr-2');
    db.writeRow('bulletinStories', id, { id, bulletinId, rank: (index + 1) * 1000, slug: id, script: `صياغة خاصة للنشرة ${index + 1}`,
      type: 'READER', status: 'APPROVED', newsId: source(id), newsUpdatedAt: earlier, writerId: 'usr-2' }, index, 'usr-2');
  });
});
afterEach(() => server.close());

const actor = (role: 'admin' | 'editor' | 'journalist') => loginAgent(server.app, `${role}@akhbar.tv`);
type Agent = Awaited<ReturnType<typeof actor>>;
const state = () => server.db.getRow('onAir', bulletinId);
const take = async (control: Agent, segmentId: string, status: 'LIVE' | 'ENDED' = 'LIVE') => {
  const response = await control.post('/api/v1/data/sync').set(header).send({ ops: [{ c: 'onAir', id: bulletinId, op: 'upsert', baseV: state()?.v,
    d: { id: bulletinId, episodeId: bulletinId, status, currentSegmentId: segmentId } }] });
  expect(response.body.results[0]).toMatchObject({ ok: true });
};

const correct = async (editor: Agent, id: string, requestId: string) => {
  const newsId = source(id);
  const res = await editor.post(`/api/v1/news/${newsId}/corrections`).set(header).send({ expectedVersion: server.db.getRow('news', newsId)!.v,
    reason: 'تدقيق التحرير', summary: 'تعديل اسم الموقع', requestId });
  expect(res.status).toBe(200);
  return res.body.data;
};

it('alerts the operator when a corrected source is current or next, once per correction and air run', async () => {
  const control = await actor('admin');
  const editor = await actor('editor');
  await take(control, stories[0]);
  const notices = () => server.db.listCollection('notifications').filter(row => row.d.type === 'BULLETIN_SOURCE_CORRECTION');
  const original = server.db.getRow('bulletinStories', stories[2])!.d;
  const operatorId = state()!.d.operatorId;
  await correct(editor, stories[2], 'request-ahead');
  expect(notices()).toHaveLength(0);
  await take(control, stories[1]);
  expect(notices()).toHaveLength(1);
  expect(notices()[0].d).toMatchObject({ userId: operatorId, message: expect.stringContaining(stories[2]) });
  await take(control, stories[2]);
  expect(notices()).toHaveLength(1);
  await correct(editor, stories[2], 'request-current');
  expect(notices()).toHaveLength(2);
  expect(server.db.getRow('bulletinStories', stories[2])!.d).toEqual(original);
});

it('records one authorized request linked to the aired archive segment and its source correction', async () => {
  const control = await actor('admin');
  const editor = await actor('editor');
  const journalist = await actor('journalist');
  await take(control, stories[0]);
  const correction = await correct(editor, stories[0], 'request-journal');
  const payload = { segmentId: stories[0], startedAt: state()!.d.startedAt, reason: 'يلزم تصحيح الاسم في النشرة المقبلة', correctionId: correction.id, requestId: 'post-air-note-1' };
  const submit = (user: Agent, body: object = payload) => user.post(journal).set(header).send(body);
  expect((await submit(control)).status).toBe(409);
  await take(control, stories[0], 'ENDED');
  expect((await submit(journalist)).status).toBe(403);
  expect((await submit(control, { ...payload, segmentId: stories[1] })).status).toBe(404);
  const created = await submit(control);
  expect(created.status).toBe(201);
  expect(created.body.data).toMatchObject({ segmentId: stories[0], reason: payload.reason, newsId: source(stories[0]), correctionId: correction.id });
  const replay = await submit(control);
  expect(replay.status).toBe(200);
  expect(replay.body.data).toEqual(created.body.data);
  expect(state()!.d.correctionRequests).toEqual([created.body.data]);
  expect(state()!.d.archivedPlan.some((item: { id: string }) => item.id === stories[0])).toBe(true);
  expect((await submit(control, { ...payload, reason: 'طلب مختلف بالمعرّف نفسه' })).status).toBe(409);
  await take(control, stories[0]);
  expect((await submit(control)).status).toBe(409);
  expect(state()!.d.correctionRequests).toEqual([created.body.data]);
});
