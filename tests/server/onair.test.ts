import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';
import { liveTiming } from '../../src/shared/onair';

let server: Awaited<ReturnType<typeof createTestServer>>;
const H = { 'X-NRCS-Client': 'web' };
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(() => server.close());

const sync = (agent: request.Agent, ops: any[]) => agent.post('/api/v1/data/sync').set(H).send({ ops });

describe('on-air mode', () => {
  it('only the director/control room runs the show; times and episode status come from the server', async () => {
    const ep = server.db.listCollection('episodes').find((e) => (e.d.rundown || []).length >= 2)!;
    const [s1, s2] = ep.d.rundown;
    const op = (d: any, baseV?: number) => ({ c: 'onAir', op: 'upsert', id: ep.id, d: { id: ep.id, episodeId: ep.id, ...d }, ...(baseV ? { baseV } : {}) });

    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const denied = await sync(journalist, [op({ status: 'LIVE', currentSegmentId: s1.id })]);
    expect(denied.body.results[0].code).toBe('FORBIDDEN');

    const control = await loginAgent(server.app, 'director@akhbar.tv'); // control department
    const bad = await sync(control, [op({ status: 'LIVE', currentSegmentId: 'seg-not-here' })]);
    expect(bad.body.results[0].ok).toBe(false);

    const live = await sync(control, [op({ status: 'LIVE', currentSegmentId: s1.id, startedAt: '2000-01-01T00:00:00Z' })]);
    expect(live.body.results[0].ok).toBe(true);
    let row = server.db.getRow('onAir', ep.id)!;
    expect(new Date(row.d.startedAt).getFullYear()).toBeGreaterThan(2020); // forged time ignored
    expect(server.db.getRow('episodes', ep.id)!.d.status).toBe('ON_AIR');

    const next = await sync(control, [op({ status: 'LIVE', currentSegmentId: s2.id }, row.v)]);
    expect(next.body.results[0].ok).toBe(true);
    row = server.db.getRow('onAir', ep.id)!;
    expect(row.d.log.map((l: any) => l.segmentId)).toEqual([s1.id, s2.id]);
    expect(row.d.log[0].endedAt).toBeTruthy();

    const end = await sync(control, [op({ status: 'ENDED', currentSegmentId: s2.id }, row.v)]);
    expect(end.body.results[0].ok).toBe(true);
    expect(server.db.getRow('episodes', ep.id)!.d.status).toBe('BROADCASTED');
  });

  it('computes remaining time and drift from the plan', () => {
    const episode = { rundown: [{ id: 'a', durationSeconds: 60 }, { id: 'b', durationSeconds: 120 }, { id: 'c', durationSeconds: 30 }] };
    const t0 = Date.parse('2026-09-26T20:00:00Z');
    const state: any = { status: 'LIVE', startedAt: new Date(t0).toISOString(), segmentStartedAt: new Date(t0 + 90_000).toISOString(), currentSegmentId: 'b' };
    const t = liveTiming(state, episode, t0 + 90_000 + 150_000)!; // b started 30s late, has run 150s of 120s
    expect(t.next.id).toBe('c');
    expect(t.remaining).toBe(-30);
    expect(t.drift).toBe(60); // 30s late start + 30s overrun
  });
});

describe('on-air alerts', () => {
  it('control sends to departments; recipients can only acknowledge', async () => {
    const control = await loginAgent(server.app, 'director@akhbar.tv');
    const presenter = await loginAgent(server.app, 'presenter@akhbar.tv');
    const sent = await sync(control, [{ c: 'cues', op: 'upsert', id: 'cue-1', d: { id: 'cue-1', targetDepartmentIds: ['presenters'], message: 'دقيقة واحدة', level: 'standby', fromId: 'usr-x' } }]);
    expect(sent.body.results[0].ok).toBe(true);
    const cue = server.db.getRow('cues', 'cue-1')!;
    expect(cue.d.fromId).toBe('usr-8');

    const forged = await sync(presenter, [{ c: 'cues', op: 'upsert', id: 'cue-2', d: { id: 'cue-2', targetDepartmentIds: [], message: 'x', level: 'info' } }]);
    expect(forged.body.results[0].code).toBe('FORBIDDEN');

    const ack = await sync(presenter, [{ c: 'cues', op: 'upsert', id: 'cue-1', d: { ...cue.d, message: 'تغيير', acks: [{ userId: 'usr-x' }] }, baseV: cue.v }]);
    expect(ack.body.results[0].ok).toBe(true);
    const after = server.db.getRow('cues', 'cue-1')!.d;
    expect(after.message).toBe('دقيقة واحدة');
    expect(after.acks.map((a: any) => a.userId)).toEqual(['usr-5']);
  });
});
