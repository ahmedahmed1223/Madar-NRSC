import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
beforeEach(async () => { server = await createTestServer(); });
afterEach(() => server.close());
const sync = (agent: request.Agent, op: any) => agent.post('/api/v1/data/sync')
  .set('X-NRCS-Client', 'web').send({ ops: [op] });

describe('concurrent newsroom work', () => {
  it('TEAM-05: studio crew cannot complete an audio desk request', async () => {
    const mediaUser = server.db.getRow('users', 'usr-7')!;
    server.db.writeRow('users', mediaUser.id, { ...mediaUser.d, departmentId: 'audio', department: 'الصوت' }, mediaUser.p, null);
    const producer = await loginAgent(server.app, 'producer@akhbar.tv');
    const audio = await loginAgent(server.app, 'media@akhbar.tv');
    const studio = await loginAgent(server.app, 'crew@akhbar.tv');
    const created = await sync(producer, { c: 'requests', op: 'upsert', id: 'audio-boundary',
      d: { id: 'audio-boundary', type: 'AUDIO', title: 'تجهيز الصوت للحلقة' },
    });
    expect(created.body.results[0].ok).toBe(true);
    const initial = server.db.getRow('requests', 'audio-boundary')!;
    const accepted = await sync(audio, { c: 'requests', op: 'upsert', id: initial.id,
      baseV: initial.v, d: { ...initial.d, status: 'ACCEPTED' },
    });
    expect(accepted.body.results[0].ok).toBe(true);
    const current = server.db.getRow('requests', initial.id)!;
    const denied = await sync(studio, { c: 'requests', op: 'upsert', id: initial.id,
      baseV: current.v, d: { ...current.d, status: 'DONE' },
    });
    expect(denied.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(server.db.getRow('requests', initial.id)!.d.status).toBe('ACCEPTED');
    const done = await sync(audio, { c: 'requests', op: 'upsert', id: initial.id,
      baseV: current.v, d: { ...current.d, status: 'DONE' },
    });
    expect(done.body.results[0].ok).toBe(true);
  });

  it('TEAM-13: permission revocation applies to an already signed-in colleague', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const before = await journalist.get('/api/v1/auth/me');
    expect(before.body.permissions).toContain('news.create');
    const user = server.db.getRow('users', before.body.user.id)!;
    const revoked = await sync(admin, { c: 'users', op: 'upsert', id: user.id, baseV: user.v,
      d: { ...user.d, customPermissions: [...(user.d.customPermissions || []), '!news.create'] },
    });
    expect(revoked.body.results[0].ok).toBe(true);
    const result = await sync(journalist, { c: 'news', op: 'upsert', id: 'revoked-news',
      d: { id: 'revoked-news', title: 'Revoked write', status: 'DRAFT' },
    });
    expect(result.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(server.db.getRow('news', 'revoked-news')).toBeNull();
    const current = server.db.getRow('users', user.id)!;
    const disabled = await sync(admin, { c: 'users', op: 'upsert', id: user.id, baseV: current.v,
      d: { ...current.d, isActive: false },
    });
    expect(disabled.body.results[0].ok).toBe(true);
    expect((await journalist.get('/api/v1/data')).status).toBe(401);
  });

  it('TEAM-06: only one concurrent booking wins the same resource and slot', async () => {
    const producer = await loginAgent(server.app, 'producer@akhbar.tv');
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const booking = (id: string) => ({ c: 'bookings', op: 'upsert', id, d: {
      id, resourceId: 'res-studio-2', title: 'Concurrent booking',
      start: '2030-02-10T09:00:00Z', end: '2030-02-10T10:00:00Z', status: 'CONFIRMED',
    } });
    const responses = await Promise.all([
      sync(producer, booking('race-booking-a')), sync(journalist, booking('race-booking-b')),
    ]);
    const results = responses.map(res => res.body.results[0]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.find(result => !result.ok).code).toBe('INVALID');
    expect(server.db.listCollection('bookings').filter(row => row.id.startsWith('race-booking-'))).toHaveLength(1);
  });

  it('TEAM-10: concurrent broadcast updates cannot silently overwrite the same version', async () => {
    const control = await loginAgent(server.app, 'director@akhbar.tv');
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const episode = server.db.listCollection('episodes').find(row => row.d.rundown?.length >= 3)!;
    const [first, second, third] = episode.d.rundown;
    const op = (segmentId: string, baseV?: number) => ({ c: 'onAir', op: 'upsert', id: episode.id,
      d: { id: episode.id, episodeId: episode.id, status: 'LIVE', currentSegmentId: segmentId },
      ...(baseV === undefined ? {} : { baseV }),
    });
    expect((await sync(control, op(first.id))).body.results[0].ok).toBe(true);
    const version = server.db.getRow('onAir', episode.id)!.v;
    const responses = await Promise.all([
      sync(control, op(second.id, version)), sync(admin, op(third.id, version)),
    ]);
    const results = responses.map(res => res.body.results[0]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.find(result => !result.ok).code).toBe('CONFLICT');
    const winner = results.find(result => result.ok).row;
    expect(server.db.getRow('onAir', episode.id)!.d.currentSegmentId).toBe(winner.d.currentSegmentId);
    expect(server.db.getRow('onAir', episode.id)!.d.log).toHaveLength(2);
  });
});

describe('role API creation boundary', () => {
  const roles = [
    ['admin', true], ['director', true], ['editor', true], ['journalist', true], ['producer', true],
    ['reporter', true], ['presenter', false], ['media', false], ['crew', false], ['trainee', false],
  ] as const;
  for (const [account, allowed] of roles) {
    it(`${account}: ${allowed ? 'allows' : 'denies'} news creation on the server`, async () => {
      const agent = await loginAgent(server.app, `${account}@akhbar.tv`);
      const result = (await sync(agent, { c: 'news', op: 'upsert', id: 'role-boundary-news', d: {
        id: 'role-boundary-news', title: 'اختبار صلاحيات إنشاء الأخبار', status: 'DRAFT',
        content: 'هذه مادة اختبار مستقلة للتحقق من حدود الصلاحيات بين أنواع المستخدمين داخل غرفة الأخبار',
      } })).body.results[0];
      expect(result.ok).toBe(allowed);
      if (!allowed) {
        expect(result.code).toBe('FORBIDDEN');
        expect(server.db.getRow('news', 'role-boundary-news')).toBeNull();
      }
    });
  }
});
