import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { searchArchive } from '../../src/server/archiveSearch';

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
  expect(hidden.modules).toMatchObject({ programmes: false, assignments: false });
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
  expect(production.modules).toMatchObject({ programmes: true, assignments: false });
  expect(production.collections.episodes.length).toBeGreaterThan(0);
  const report = (await reporter.get('/api/v1/data')).body;
  expect(report.modules).toMatchObject({ programmes: true, assignments: true });
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

it('limits a feature by station and department, preserves news and restores the policy from history', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const editor = await loginAgent(server.app, 'editor@akhbar.tv');
  const { user } = (await editor.get('/api/v1/auth/me')).body;
  const row = server.db.getRow('users', user.id)!;
  server.db.writeRow('users', row.id, { ...row.d, stationId: 'beirut', departmentId: 'newsroom' }, row.p, null);
  const original = (await editor.get('/api/v1/data')).body;
  const save = (policy: Record<string, unknown>) => admin.post('/api/v1/data/sync').set(headers).send({ ops: [settingsOp(policy)] });
  const copilot = () => editor.post('/api/v1/ai/copilot').set(headers).send({ mode: 'PROOFREAD', sensitive: true });
  expect((await copilot()).status).toBe(400);
  expect((await save({
    editorialAi: { mode: 'everyone', scopes: [{ stationId: 'beirut', departmentId: 'newsroom', mode: 'disabled' }] },
    messaging: { mode: 'disabled' },
  })).body.results[0].ok).toBe(true);
  const data = (await editor.get('/api/v1/data')).body;
  expect(data.modules).toMatchObject({ news: true, editorialAi: false, messaging: false, tasks: true, assignments: true });
  expect(data.collections.news.map((entry: { id: string }) => entry.id)).toEqual(original.collections.news.map((entry: { id: string }) => entry.id));
  expect((await editor.get('/api/v1/data/changes').query({ since: original.rev, access: original.access })).body.reset).toBe(true);
  expect((await editor.get('/api/v1/chat/history')).status).toBe(403);
  expect((await copilot()).status).toBe(403);
  expect((await editor.get('/api/v1/settings/module-history')).status).toBe(403);
  const history = (await admin.get('/api/v1/settings/module-history')).body.rows;
  expect(history[0].policy).toEqual({});
  expect((await save(history[0].policy)).body.results[0].ok).toBe(true);
  expect((await copilot()).status).toBe(400);
});

it('stops new production cards while keeping existing work and the tasks module available', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const submit = (ops: unknown[]) => admin.post('/api/v1/data/sync').set(headers).send({ ops });
  const before = (await admin.get('/api/v1/data')).body;
  expect((await submit([settingsOp({ assignments: { mode: 'finishing' } })])).body.results[0].ok).toBe(true);
  const snapshot = (await admin.get('/api/v1/data')).body;
  expect(snapshot.modules).toMatchObject({ assignments: true, assignmentIntake: false, tasks: true });
  expect(snapshot.collections.productionCards).toEqual(before.collections.productionCards);
  const existing = snapshot.collections.productionCards[0]?.d ?? {
    title: 'متابعة اختبار', kind: 'OTHER', status: 'OPEN', priority: 'NORMAL', steps: [],
  };
  const id = 'new-card-while-finishing';
  const result = (await submit([{ c: 'productionCards', id, op: 'upsert', d: { ...existing, id } }])).body.results[0];
  expect(result).toMatchObject({ ok: false, message: expect.stringContaining('إنهاء الأعمال القائمة') });
  expect(server.db.getRow('productionCards', id)).toBeFalsy();
});

it('keeps only the media referenced by readable work when the library is stopped', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const news = server.db.listCollection('news')[0];
  const ids = ['material-linked-to-news', 'unrelated-library-material'];
  for (const id of ids) server.db.writeRow('media', id, { id, title: id, mediaType: 'DOCUMENT' }, 0, null);
  server.db.writeRow('news', news.id, { ...news.d, mediaIds: [ids[0]] }, news.p, null);
  const save = (policy: Record<string, unknown>) => admin.post('/api/v1/data/sync').set(headers).send({ ops: [settingsOp(policy)] });
  expect((await save({ media: { mode: 'disabled' } })).body.results[0].ok).toBe(true);
  const data = (await admin.get('/api/v1/data')).body;
  expect(data.modules).toMatchObject({ media: false, transcription: false, news: true });
  expect(data.collections.media.map((entry: { id: string }) => entry.id)).toContain(ids[0]);
  expect(data.collections.media.map((entry: { id: string }) => entry.id)).not.toContain(ids[1]);
  expect((await admin.get('/api/v1/media/transcription')).status).toBe(403);
});

it('excludes restricted stations from archive totals and ranked results', () => {
  const cutoff = new Date(Date.now() + 60_000).toISOString();
  const base = { status: 'PUBLISHED', title: 'الاكتشاف الميداني', summary: 'الاكتشاف الميداني' };
  server.db.writeRow('news', 'archive-visible', { ...base, id: 'archive-visible', stationId: 'gaza' }, 0, null);
  server.db.writeRow('news', 'archive-hidden', { ...base, id: 'archive-hidden', stationId: 'beirut' }, 0, null);
  for (const query of ['', 'الاكتشاف الميداني']) {
    const result = searchArchive(server.db, cutoff, query, 100, 0, { excludedStations: ['beirut'] });
    const ids = result.items.map(item => item.id);
    expect(ids).toContain('archive-visible');
    expect(ids).not.toContain('archive-hidden');
    expect(result.total).toBeLessThan(searchArchive(server.db, cutoff, query, 100, 0).total);
  }
});
