import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';

const headers = { 'X-NRCS-Client': 'web' };
let server: Awaited<ReturnType<typeof createTestServer>>;

beforeEach(async () => { server = await createTestServer(); });
afterEach(() => server.close());

function settingsOp(moduleAccess: Record<string, unknown>) {
  const current = server.db.getRow('settings', 'singleton')!;
  return { c: 'settings', op: 'upsert', id: current.id, baseV: current.v, d: { ...current.d, moduleAccess } };
}

it('revokes existing module sessions and writes, keeps the stored records, and allows administrator recovery', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const producer = await loginAgent(server.app, 'producer@akhbar.tv');
  const episode = server.db.listCollection('episodes')[0];
  const card = server.db.listCollection('productionCards')[0];
  const snapshot = (await producer.get('/api/v1/data')).body;
  expect(snapshot.collections.episodes.length).toBeGreaterThan(0);
  const locked = settingsOp({ programmes: { mode: 'disabled' }, assignments: { mode: 'disabled' } });
  const write = { c: 'episodes', op: 'delete', id: episode.id, baseV: episode.v };
  const submit = (agent: typeof admin, ops: unknown[]) => agent.post('/api/v1/data/sync').set(headers).send({ ops });

  expect((await submit(producer, [locked])).body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect((await submit(admin, [locked, write])).body.results.map((value: { ok: boolean }) => value.ok)).toEqual([true, false]);
  expect((await producer.get('/api/v1/data/changes').query({ since: snapshot.rev, access: snapshot.access })).body.reset).toBe(true);
  const hidden = (await producer.get('/api/v1/data')).body;
  expect(hidden.modules).toEqual({ programmes: false, assignments: false });
  for (const name of ['programs', 'episodes', 'programTypes', 'productionCards', 'workflowTemplates']) {
    expect(hidden.collections[name]).toEqual([]);
  }
  expect(hidden.collections.settings).toHaveLength(1);
  expect((await producer.get(`/api/v1/episodes/${episode.id}/mos`)).status).toBe(403);
  expect((await producer.get(`/api/v1/air-offline/packet/${episode.id}`)).status).toBe(403);
  expect((await submit(producer, [{ c: 'productionCards', op: 'delete', id: card?.id || 'missing-card' }])).body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });

  expect((await submit(admin, [settingsOp({})])).body.results[0].ok).toBe(true);
  const restored = (await producer.get('/api/v1/data')).body;
  expect(restored.collections.episodes.map((row: { id: string }) => row.id)).toContain(episode.id);
  if (card) expect(server.db.getRow('productionCards', card.id)).toBeTruthy();
});

it('applies selected users and effective roles as a ceiling over existing permissions', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const producer = await loginAgent(server.app, 'producer@akhbar.tv');
  const reporter = await loginAgent(server.app, 'reporter@akhbar.tv');
  const reporterId = (await reporter.get('/api/v1/auth/me')).body.user.id;
  const producerRole = server.db.listCollection('roles').find(row => row.d.roleCode === 'PRODUCER')!;
  const selected = settingsOp({ programmes: { mode: 'selected', roleIds: [producerRole.id], userIds: [reporterId] }, assignments: { mode: 'selected', userIds: [reporterId] } });
  expect((await admin.post('/api/v1/data/sync').set(headers).send({ ops: [selected] })).body.results[0].ok).toBe(true);
  const production = (await producer.get('/api/v1/data')).body;
  expect(production.modules).toEqual({ programmes: true, assignments: false });
  expect(production.collections.episodes.length).toBeGreaterThan(0);
  const report = (await reporter.get('/api/v1/data')).body;
  expect(report.modules).toEqual({ programmes: true, assignments: true });
  expect(report.collections.episodes).toEqual([]);
  expect(report.collections.programs).toEqual([]);
  expect(report.collections.settings[0].d).not.toHaveProperty('moduleAccess');
});

it('protects an active programme while allowing bulletins and their air state to remain available', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const episode = server.db.listCollection('episodes')[0];
  const bulletin = server.db.listCollection('bulletins')[0];
  server.db.writeRow('onAir', episode.id, { id: episode.id, episodeId: episode.id, status: 'LIVE' }, 0, null);
  server.db.writeRow('onAir', bulletin.id, { id: bulletin.id, episodeId: bulletin.id, status: 'LIVE' }, 0, null);
  const disableProgrammes = () => admin.post('/api/v1/data/sync').set(headers).send({ ops: [settingsOp({ programmes: { mode: 'disabled' } })] });

  expect((await disableProgrammes()).body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  server.db.writeRow('onAir', episode.id, { id: episode.id, episodeId: episode.id, status: 'ENDED' }, 0, null);
  expect((await disableProgrammes()).body.results[0].ok).toBe(true);
  const snapshot = (await admin.get('/api/v1/data')).body;
  expect(snapshot.collections.onAir.map((row: { id: string }) => row.id)).toEqual([bulletin.id]);
  expect(snapshot.collections.bulletins.map((row: { id: string }) => row.id)).toContain(bulletin.id);
  expect((await admin.post('/api/v1/data/locks/release').set(headers).send({ id: `episodes:${episode.id}` })).status).toBe(403);
});
