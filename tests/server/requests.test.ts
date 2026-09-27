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
const put = (d: any, baseV?: number) => ({ c: 'requests', op: 'upsert', id: d.id, d, ...(baseV ? { baseV } : {}) });
const row = (id: string) => server.db.getRow('requests', id)!;

describe('requests between departments', () => {
  it('routes a montage request, and only the montage desk can take and finish it', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv'); // newsroom
    const media = await loginAgent(server.app, 'media@akhbar.tv'); // montage department
    const created = await sync(journalist, [
      put({ id: 'req-1', type: 'MONTAGE', title: 'مونتاج تقرير القمة', status: 'DONE', requesterId: 'usr-9', departmentId: 'graphics', link: { kind: 'segment', episodeId: 'ep-101', segmentId: 'seg-x', title: 'تقرير' } }),
    ]);
    expect(created.body.results[0].ok).toBe(true);
    const r = row('req-1').d;
    expect(r.status).toBe('OPEN'); // forged fields are replaced by the server
    expect(r.requesterId).toBe('usr-3');
    expect(r.departmentId).toBe('montage');

    // The montage member was notified (nobody on the roster, so the whole department).
    const notes = server.db.listCollection('notifications').filter((n) => n.d.userId === 'usr-7' && n.d.linkUrl === '/requests');
    expect(notes.length).toBe(1);

    const stolen = await sync(journalist, [put({ ...r, status: 'ACCEPTED' }, row('req-1').v)]);
    expect(stolen.body.results[0].code).toBe('FORBIDDEN');

    const accepted = await sync(media, [put({ ...r, status: 'ACCEPTED' }, row('req-1').v)]);
    expect(accepted.body.results[0].ok).toBe(true);
    expect(row('req-1').d.assigneeId).toBe('usr-7');

    const noReason = await sync(media, [put({ ...row('req-1').d, status: 'REJECTED' }, row('req-1').v)]);
    expect(noReason.body.results[0].code).toBe('FORBIDDEN');

    const done = await sync(media, [put({ ...row('req-1').d, status: 'DONE' }, row('req-1').v)]);
    expect(done.body.results[0].ok).toBe(true);
    expect(row('req-1').d.history.map((h: any) => h.status)).toEqual(['OPEN', 'ACCEPTED', 'DONE']);
    // The requester hears back.
    expect(server.db.listCollection('notifications').some((n) => n.d.userId === 'usr-3' && /منجز/.test(n.d.title))).toBe(true);
  });

  it('only the requester edits the details, and viewers cannot send requests', async () => {
    const media = await loginAgent(server.app, 'media@akhbar.tv');
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    await sync(journalist, [put({ id: 'req-2', type: 'GRAPHICS', title: 'شارة الضيف', lines: ['د. خالد'] })]);
    const edit = await sync(media, [put({ ...row('req-2').d, title: 'عنوان آخر' }, row('req-2').v)]);
    expect(edit.body.results[0].code).toBe('FORBIDDEN');
    const trainee = await loginAgent(server.app, 'trainee@akhbar.tv');
    const denied = await sync(trainee, [put({ id: 'req-3', type: 'STUDIO', title: 'x' })]);
    expect(denied.body.results[0].code).toBe('FORBIDDEN');
  });
});

describe('on-air readiness gate', () => {
  it('refuses READY_FOR_BROADCAST while a segment is not ready', async () => {
    const producer = await loginAgent(server.app, 'producer@akhbar.tv');
    const ep = server.db.listCollection('episodes').find((e) => e.d.status !== 'READY_FOR_BROADCAST' && !e.d.deletedAt)!;
    const rundown = [
      { id: 'seg-a', title: 'تقرير بلا فيديو', segmentType: 'REPORT', scriptText: 'نص', durationSeconds: 60 },
    ];
    const withRundown = await sync(producer, [{ c: 'episodes', op: 'upsert', id: ep.id, d: { ...ep.d, rundown }, baseV: ep.v }]);
    expect(withRundown.body.results[0].ok).toBe(true);
    const cur = server.db.getRow('episodes', ep.id)!;
    const blocked = await sync(producer, [{ c: 'episodes', op: 'upsert', id: ep.id, d: { ...cur.d, status: 'READY_FOR_BROADCAST' }, baseV: cur.v }]);
    expect(blocked.body.results[0].code).toBe('FORBIDDEN');
    expect(blocked.body.results[0].message).toMatch(/فيديو/);

    server.db.writeRow('media', 'med-ready', { id: 'med-ready', mediaType: 'VIDEO', videoStatus: 'READY', title: 'v', url: '/x' }, 0, null);
    const cur2 = server.db.getRow('episodes', ep.id)!;
    const fixed = await sync(producer, [{ c: 'episodes', op: 'upsert', id: ep.id, d: { ...cur2.d, rundown: [{ ...rundown[0], mediaIds: ['med-ready'] }] }, baseV: cur2.v }]);
    expect(fixed.body.results[0].ok).toBe(true);
    const cur3 = server.db.getRow('episodes', ep.id)!;
    const ok = await sync(producer, [{ c: 'episodes', op: 'upsert', id: ep.id, d: { ...cur3.d, status: 'READY_FOR_BROADCAST' }, baseV: cur3.v }]);
    expect(ok.body.results[0].ok).toBe(true);
  });
});

describe('requests addressed to a named colleague', () => {
  it('reaches only that person, who alone (or a desk chief) can take it', async () => {
    const producer = await loginAgent(server.app, 'producer@akhbar.tv');
    const bad = await sync(producer, [put({ id: 'req-a0', type: 'FIELD', title: 'تقرير', addressedToId: 'usr-7' })]); // usr-7 is montage
    expect(bad.body.results[0].ok).toBe(false);

    const res = await sync(producer, [put({ id: 'req-a1', type: 'FIELD', title: 'تقرير ميداني', addressedToId: 'usr-6', addressedToName: 'مزيف' })]);
    expect(res.body.results[0].ok).toBe(true);
    const r = row('req-a1').d;
    expect(r.addressedToId).toBe('usr-6');
    expect(r.addressedToName).not.toBe('مزيف');
    const notes = server.db.listCollection('notifications').filter((n) => n.d.title.includes('باسمك'));
    expect(notes.map((n) => n.d.userId)).toEqual(['usr-6']);

    const reporter = await loginAgent(server.app, 'reporter@akhbar.tv'); // usr-6
    const ok = await sync(reporter, [put({ ...r, status: 'ACCEPTED' }, row('req-a1').v)]);
    expect(ok.body.results[0].ok).toBe(true);
    expect(row('req-a1').d.assigneeId).toBe('usr-6');
  });
});

describe('episode plan validation', () => {
  it('refuses a report assigned to nobody', async () => {
    const producer = await loginAgent(server.app, 'producer@akhbar.tv');
    const ep = server.db.getRow('episodes', 'ep-101')!;
    const rundown = ep.d.rundown.map((s: any, i: number) => (i === 1 ? { ...s, report: { source: 'ASSIGNED' } } : s));
    const res = await sync(producer, [{ c: 'episodes', op: 'upsert', id: 'ep-101', d: { ...ep.d, rundown }, baseV: ep.v }]);
    expect(res.body.results[0].ok).toBe(false);
  });
});
