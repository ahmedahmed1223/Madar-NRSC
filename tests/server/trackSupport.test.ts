import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
beforeAll(async () => { server = await createTestServer(); });
afterAll(() => server.close());

it('routes support through the other track manager, records redirection and notifies the owner of the result', async () => {
  async function account(email: string, workflowRoles: object) {
    const agent = await loginAgent(server.app, email);
    const id = (await agent.get('/api/v1/auth/me')).body.user.id;
    const user = server.db.getRow('users', id)!;
    server.db.writeRow('users', id, { ...user.d, workflowRoles, customPermissions: ['requests.create', 'media.view'], stationId: 'gaza' }, user.p, null);
    return { id, agent };
  }
  const owner = await account('journalist@akhbar.tv', { news: 'PREPARER' });
  const chief = await account('producer@akhbar.tv', { programmes: 'MANAGER' });
  const preparer = await account('media@akhbar.tv', { programmes: 'PREPARER' });
  const unrelated = await account('editor@akhbar.tv', { news: 'MANAGER' });
  const cardId = 'crd-support-source';
  server.db.writeRow('media', 'med-source', { id: 'med-source', mediaType: 'IMAGE', title: 'صورة الموقع' }, 0, null);
  server.db.writeRow('media', 'med-other', { id: 'med-other', mediaType: 'IMAGE', title: 'مادة أخرى' }, 0, null);
  server.db.writeRow('productionCards', cardId, { id: cardId, kind: 'REPORT', status: 'OPEN', ownerId: owner.id, title: 'تقرير خاص', steps: [], mediaIds: ['med-source'] }, 0, null);
  const id = 'req-cross-track';
  const source = { id, type: 'SUPPORT_PROGRAMMES', supportCardId: cardId, title: 'طلب معدّ للمقابلة', addressedToId: chief.id, sourceMediaIds: ['med-source'] };
  const write = async (actor: typeof owner, data: object) => {
    const row = server.db.getRow('requests', id);
    const result = await actor.agent.post('/api/v1/data/sync').set('X-NRCS-Client', 'web')
      .send({ ops: [{ c: 'requests', op: 'upsert', id, d: { ...row?.d, ...data }, baseV: row?.v }] });
    return result.body.results[0];
  };
  const visible = async (actor: typeof owner) => (await actor.agent.get('/api/v1/data')).body.collections.requests.some((row: any) => row.id === id);
  expect((await write(owner, { ...source, addressedToId: preparer.id })).ok).toBe(false);
  expect((await write(owner, { ...source, addressedToId: unrelated.id })).ok).toBe(false);
  expect((await write(unrelated, source)).ok).toBe(false);
  expect((await write(owner, { ...source, sourceMediaIds: ['med-other'] })).ok).toBe(false);
  expect(await write(owner, source)).toMatchObject({ ok: true });
  expect(await visible(chief)).toBe(true);
  expect(await visible(unrelated)).toBe(false);
  expect((await write(owner, { addressedToId: preparer.id })).ok).toBe(false);
  const beforeRedirect = server.db.currentRev();
  expect(await write(chief, { addressedToId: preparer.id })).toMatchObject({ ok: true });
  const changes = await chief.agent.get(`/api/v1/data/changes?since=${beforeRedirect}`);
  expect(changes.body.changes.find((change: any) => change.c === 'requests' && change.id === id)).toMatchObject({ deleted: true });
  expect(await visible(preparer)).toBe(true);
  expect(await visible(chief)).toBe(false);
  expect((await write(chief, { status: 'ACCEPTED' })).ok).toBe(false);
  expect((await write(preparer, { status: 'DONE' })).ok).toBe(false);
  expect((await write(preparer, { status: 'ACCEPTED' })).ok).toBe(true);
  expect((await write(preparer, { status: 'REJECTED', resolution: 'تعذر حجز الاستديو' })).ok).toBe(true);
  expect(await visible(owner)).toBe(true);
  const request = server.db.getRow('requests', id)!.d;
  expect(request.history.map((entry: any) => [entry.status, entry.byId])).toEqual([
    ['OPEN', owner.id], ['OPEN', chief.id], ['ACCEPTED', preparer.id], ['REJECTED', preparer.id],
  ]);
  expect(request.history.at(-1).note).toBe('تعذر حجز الاستديو');
  const alerts = server.db.listCollection('notifications').map(row => row.d).filter(n => n.linkUrl === `/requests/${id}`);
  expect(alerts.some(n => n.userId === preparer.id && n.title.includes('توجيه'))).toBe(true);
  expect(alerts.some(n => n.userId === owner.id && n.title.includes('مرفوض'))).toBe(true);
});
