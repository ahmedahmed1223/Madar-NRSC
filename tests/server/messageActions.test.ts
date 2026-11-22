import { afterAll, beforeAll, expect, it } from 'vitest';
import type request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';
import { dmChannel } from '../../src/shared/chat';

const headers = { 'X-NRCS-Client': 'web' };
const sync = (agent: request.Agent, ops: unknown[]) => agent.post('/api/v1/data/sync').set(headers).send({ ops });
let fixture: Awaited<ReturnType<typeof createTestServer>>;
beforeAll(async () => { fixture = await createTestServer(); });
afterAll(() => fixture?.close());

it('stamps the source and sender while keeping a promoted chat attachment private', async () => {
  const sender = await loginAgent(fixture.app, 'journalist@akhbar.tv');
  const recipient = await loginAgent(fixture.app, 'editor@akhbar.tv');
  const outsider = await loginAgent(fixture.app, 'admin@akhbar.tv');
  const messageId = 'private-action-message';
  const upload = await sender.post('/api/v1/chat/upload').set(headers).set('X-File-Name', 'private-sample.wav').set('Content-Type', 'audio/wav').send(Buffer.from('synthetic audio')).expect(201);
  const sent = await sync(sender, [{ c: 'messages', op: 'upsert', id: messageId, d: {
    id: messageId, channel: dmChannel('usr-2', 'usr-3'), text: 'مقابلة تجريبية', attachments: [{ id: upload.body.data.id }],
  } }]);
  expect(sent.body.results[0].ok).toBe(true);

  const action = (agent: request.Agent, includeAttachments = true) => agent.post(`/api/v1/chat/actions/messages/${messageId}`).set(headers).send({ action: 'library', includeAttachments });
  await action(outsider).expect(404);
  const initial = await action(recipient, false).expect(200);
  expect(initial.body.data.mediaIds).toEqual([]);
  const first = await action(recipient).expect(200);
  const second = await action(recipient).expect(200);
  const { origin, mediaIds } = first.body.data;
  expect(origin).toMatchObject({ messageId, senderId: 'usr-3' });
  expect(origin.channel).toBeUndefined();
  expect(second.body.data.mediaIds).toEqual(mediaIds);
  expect(mediaIds).toHaveLength(1);
  const asset = fixture.db.getRow('media', mediaIds[0])!.d;
  expect(asset.privateMessageMedia).toEqual({ messageId, uploadId: upload.body.data.id });
  await recipient.get(asset.url).expect(200);
  await sender.get(asset.url).expect(404);
  await outsider.get(asset.url).expect(404);
  expect((await sender.get('/api/v1/data')).body.collections.media.map((row: any) => row.id)).not.toContain(asset.id);

  const story = { id: 'message-origin-draft', title: 'مقابلة تجريبية', content: '<p>مسودة</p>', status: 'DRAFT', mediaIds, messageOrigin: { ...origin, senderName: 'اسم مزيف' } };
  const saved = await sync(recipient, [{ c: 'news', op: 'upsert', id: story.id, d: story }]);
  expect(saved.body.results[0].ok).toBe(true);
  expect(fixture.db.getRow('news', story.id)?.d.messageOrigin).toEqual(origin);
  const refused = await sync(outsider, [{ c: 'news', op: 'upsert', id: 'forged-private-draft', d: { ...story, id: 'forged-private-draft' } }]);
  expect(refused.body.results[0].ok).toBe(false);
  fixture.db.deleteRow('messages', messageId, null);
  await recipient.get(asset.url).expect(404);
});

it('shares a message attachment with the destination montage department once the request is saved', async () => {
  const editor = fixture.db.getRow('users', 'usr-2')!;
  fixture.db.writeRow('users', editor.id, { ...editor.d, departmentId: 'montage', customPermissions: ['media.view', 'requests.view', '!requests.manage'] }, editor.p, null);
  const sender = await loginAgent(fixture.app, 'journalist@akhbar.tv');
  const creator = await loginAgent(fixture.app, 'admin@akhbar.tv');
  const montage = await loginAgent(fixture.app, 'editor@akhbar.tv');
  const messageId = 'montage-action-message';
  const workId = 'message-montage-request';
  const upload = await sender.post('/api/v1/chat/upload').set(headers).set('X-File-Name', 'montage-sample.wav')
    .set('Content-Type', 'audio/wav').send(Buffer.from('synthetic audio')).expect(201);
  const sent = await sync(sender, [{ c: 'messages', op: 'upsert', id: messageId, d: {
    id: messageId, channel: dmChannel('usr-1', 'usr-3'), text: 'مادة للمونتاج', attachments: [{ id: upload.body.data.id }],
  } }]);
  expect(sent.body.results[0].ok).toBe(true);

  const prepared = await creator.post(`/api/v1/chat/actions/messages/${messageId}`).set(headers)
    .send({ action: 'request', workId, includeAttachments: true }).expect(200);
  const { origin, mediaIds } = prepared.body.data;
  const asset = fixture.db.getRow('media', mediaIds[0])!.d;
  await montage.get(asset.url).expect(404);
  const cursor = (await montage.get('/api/v1/data')).body.rev;
  const record = { id: workId, type: 'MONTAGE', title: 'مونتاج المقابلة', status: 'OPEN', sourceMediaIds: mediaIds, messageOrigin: origin };
  const saved = await sync(creator, [{ c: 'requests', op: 'upsert', id: workId, d: record }]);
  expect(saved.body.results[0].ok).toBe(true);
  const changes = await montage.get(`/api/v1/data/changes?since=${cursor}`).expect(200);
  expect(changes.body.changes).toContainEqual(expect.objectContaining({ c: 'media', id: asset.id }));
  await montage.get(asset.url).expect(200);
  await sender.get(asset.url).expect(404);
  fixture.db.deleteRow('requests', workId, null);
  await montage.get(asset.url).expect(404);
});
