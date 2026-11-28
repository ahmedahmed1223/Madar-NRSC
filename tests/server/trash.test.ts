import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runRetention } from '../../src/server/retention';
import { createTestServer, loginAgent } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
const clientHeader = { 'X-NRCS-Client': 'web' };
const deletedAt = new Date().toISOString();

beforeAll(async () => { server = await createTestServer(); });
afterAll(() => server.close());

function restore(agent: request.Agent, collection: string, id: string, baseV: number) {
  return agent.post(`/api/v1/trash/${collection}/${id}/restore`).set(clientHeader).send({ baseV });
}

describe('shared recycle bin', () => {
  it('returns deleted rows only from the chosen screen and requires a screen for the section directory', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const program = server.db.listCollection('programs')[0];
    const episode = server.db.listCollection('episodes').find(row => row.d.programId === program.id)!;
    const removed = [
      server.db.writeRow('programs', program.id, { ...program.d, deletedAt }, program.p, null),
      server.db.writeRow('episodes', episode.id, { ...episode.d, deletedAt }, episode.p, null),
    ];
    try {
      const directory = (await admin.get('/api/v1/trash').expect(200)).body.data;
      expect(directory.items).toEqual([]);
      const programmes = (await admin.get('/api/v1/trash?section=programs').expect(200)).body.data;
      expect(programmes.collections).toEqual(['programs']);
      expect(programmes.items.map((item: { id: string }) => item.id)).toEqual([program.id]);
      const preparation = (await admin.get('/api/v1/trash?section=episodes').expect(200)).body.data;
      expect(preparation.collections).toEqual(['episodes']);
      expect(preparation.items.map((item: { id: string }) => item.id)).toEqual([episode.id]);
      await admin.get('/api/v1/trash?section=dashboard').expect(400);
      await admin.get('/api/v1/trash?section=programs&collection=episodes').expect(400);
    } finally {
      for (const row of removed) await restore(admin, row.c, row.id, row.v).expect(200);
    }
  });

  it('includes related collections in a single bulletin section', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const bulletin = server.db.listCollection('bulletins')[0];
    const format = server.db.listCollection('bulletinFormats')[0];
    const rows = [bulletin, format].map(row => server.db.writeRow(row.c, row.id, { ...row.d, deletedAt }, row.p, null));
    try {
      const listed = (await admin.get('/api/v1/trash?section=bulletins').expect(200)).body.data;
      expect(listed.collections).toEqual(['bulletins', 'bulletinStories', 'bulletinFormats']);
      expect(listed.items.map((item: { collection: string }) => item.collection).sort()).toEqual(['bulletinFormats', 'bulletins']);
    } finally {
      for (const row of [bulletin, format]) server.db.writeRow(row.c, row.id, row.d, row.p, null);
    }
  });

  it('restores deleted personal tasks only for their owner and keeps their details out of the work task bin', async () => {
    const owner = await loginAgent(server.app, 'journalist@akhbar.tv');
    const other = await loginAgent(server.app, 'admin@akhbar.tv');
    const id = 'personal-trash-task';
    const input = { title: 'Private task', notes: 'Private notes', dueAt: null, reminderAt: null, completed: false };
    const sync = (op: object) => owner.post('/api/v1/data/sync').set(clientHeader).send({ ops: [{ c: 'personalTasks', id, ...op }] });
    const created = (await sync({ op: 'upsert', d: input }).expect(200)).body.results[0];
    expect(created.ok).toBe(true);
    const since = server.db.currentRev();
    const deleted = (await sync({ op: 'delete', baseV: created.row.v }).expect(200)).body.results[0];
    expect(deleted).toMatchObject({ ok: true, row: { deleted: true } });
    expect((await owner.get('/api/v1/data').expect(200)).body.collections.personalTasks).not.toContainEqual(expect.objectContaining({ id }));
    const delta = async (agent: request.Agent) => (await agent.get('/api/v1/data/changes').query({ since }).expect(200)).body.changes;
    expect((await delta(owner)).find((row: { id: string }) => row.id === id)).toEqual({
      c: 'personalTasks', id, v: deleted.row.v, p: deleted.row.p, deleted: true,
    });
    expect((await delta(other)).some((row: { id: string }) => row.id === id)).toBe(false);
    const personal = (await owner.get('/api/v1/trash?section=personal-tasks').expect(200)).body.data;
    expect(personal.items).toContainEqual(expect.objectContaining({ collection: 'personalTasks', id, title: input.title }));
    expect((await other.get('/api/v1/trash?section=personal-tasks').expect(200)).body.data.items).not.toContainEqual(expect.objectContaining({ id }));
    expect((await other.get('/api/v1/trash?section=tasks').expect(200)).body.data.items).not.toContainEqual(expect.objectContaining({ id }));
    await restore(other, 'personalTasks', id, deleted.row.v).expect(404);
    await restore(owner, 'personalTasks', id, deleted.row.v).expect(200);
    expect((await owner.get('/api/v1/data').expect(200)).body.collections.personalTasks).toContainEqual(expect.objectContaining({ id, d: expect.objectContaining(input) }));
  });

  it('moves normal team-task deletions to the work task bin while keeping them out of active sync', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const user = server.db.listCollection('users').find(row => row.d.email === 'journalist@akhbar.tv')!;
    const task = server.db.writeRow('tasks', 'work-trash-task', {
      id: 'work-trash-task', title: 'Team task', status: 'PENDING', assigneeId: user.id,
    }, 0, null);
    const workKey = 'tasks:' + task.id;
    expect(server.db.assignedWorkIds(user.id)).toContain(workKey);
    const deleted = (await admin.post('/api/v1/data/sync').set(clientHeader).send({ ops: [
      { c: 'tasks', id: task.id, op: 'delete', baseV: task.v },
    ] }).expect(200)).body.results[0];
    expect(deleted).toMatchObject({ ok: true, row: { deleted: true } });
    expect(server.db.assignedWorkIds(user.id)).not.toContain(workKey);
    expect((await admin.get('/api/v1/data').expect(200)).body.collections.tasks).not.toContainEqual(expect.objectContaining({ id: task.id }));
    const work = (await admin.get('/api/v1/trash?section=tasks').expect(200)).body.data;
    expect(work.items).toContainEqual(expect.objectContaining({ collection: 'tasks', id: task.id, title: 'Team task' }));
    expect((await journalist.get('/api/v1/trash?section=tasks').expect(200)).body.data.items).not.toContainEqual(expect.objectContaining({ id: task.id }));
    await restore(journalist, 'tasks', task.id, deleted.row.v).expect(403);
    await restore(admin, 'tasks', task.id, deleted.row.v).expect(200);
    expect(server.db.assignedWorkIds(user.id)).toContain(workKey);
    expect(server.db.getRow('tasks', task.id)?.d).toMatchObject({ title: 'Team task', status: 'PENDING', deletedAt: null });
  });

  it('lists scoped metadata and restores a program with its original fields', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const program = server.db.listCollection('programs')[0];
    const episode = server.db.listCollection('episodes').find(row => row.d.programId === program.id)!;
    const deletedProgram = server.db.writeRow('programs', program.id, { ...program.d, deletedAt }, program.p, null);
    const guest = server.db.listCollection('guests')[0];
    const deletedGuest = server.db.writeRow('guests', guest.id, { ...guest.d, deletedAt }, guest.p, null);
    const programmes = await admin.get('/api/v1/trash?section=programs').expect(200);
    expect(programmes.body.data.items).toEqual([
      { collection: 'programs', id: program.id, title: program.d.name, deletedAt, version: deletedProgram.v, retentionDays: 30 },
    ]);
    const guests = await admin.get('/api/v1/trash?section=guests').expect(200);
    expect(guests.body.data.items).toContainEqual(
      { collection: 'guests', id: guest.id, title: guest.d.fullName, deletedAt, version: deletedGuest.v, retentionDays: 30 },
    );
    expect(programmes.body.data.items).not.toContainEqual(expect.objectContaining({ collection: 'episodes', id: episode.id }));
    await restore(admin, 'programs', program.id, program.v).expect(409);
    await restore(admin, 'programs', program.id, deletedProgram.v).expect(200);
    const restored = server.db.getRow('programs', program.id)!;
    expect(restored.d).toMatchObject({ ...program.d, deletedAt: null });
    expect((await admin.get('/api/v1/trash?collection=programs').expect(200)).body.data.items).not.toContainEqual(expect.objectContaining({ id: program.id }));
  });

  it('does not show coverage to a news creator who lacks delete permission', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const coverage = server.db.writeRow('stories', 'trash-coverage', { id: 'trash-coverage', title: 'تغطية محذوفة', deletedAt }, 0, null);
    const listed = await journalist.get('/api/v1/trash').expect(200);
    expect(listed.body.data.collections).not.toContain('stories');
    expect(listed.body.data.items).not.toContainEqual(expect.objectContaining({ id: coverage.id }));
    await restore(journalist, 'stories', coverage.id, coverage.v).expect(403);
    const sync = await journalist.post('/api/v1/data/sync').set(clientHeader).send({ ops: [
      { c: 'stories', op: 'upsert', id: coverage.id, baseV: coverage.v, d: { ...coverage.d, deletedAt: null } },
    ] });
    expect(sync.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('does not recreate purged rows', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const guest = server.db.writeRow('guests', 'trash-purged-guest', { id: 'trash-purged-guest', fullName: 'ضيف قديم', deletedAt: old }, 0, null);
    runRetention(server.db, server.config.dataDir, server.config.retention);
    await restore(admin, 'guests', guest.id, guest.v).expect(404);
    const sync = await admin.post('/api/v1/data/sync').set(clientHeader).send({ ops: [
      { c: 'guests', op: 'upsert', id: guest.id, baseV: guest.v, d: { ...guest.d, deletedAt: null } },
    ] });
    expect(sync.body.results[0]).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(server.db.getRow('guests', guest.id)).toBeNull();
  });

  it('continues the selected collection past a page of rows with the same deletion time', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const date = new Date(Date.parse(deletedAt) + 1000).toISOString();
    const ids = Array.from({ length: 51 }, (_, index) => `trash-page-${String(index).padStart(2, '0')}`);
    for (const id of ids) server.db.writeRow('guests', id, { id, fullName: `ضيف ${id}`, deletedAt: date }, 0, null);
    const first = (await admin.get('/api/v1/trash').query({ collection: 'guests' }).expect(200)).body.data;
    expect(first.items.map((item: { id: string }) => item.id)).toEqual(ids.slice(0, 50));
    const second = (await admin.get('/api/v1/trash').query({ collection: 'guests', cursor: first.nextCursor }).expect(200)).body.data;
    expect(second.items[0]).toMatchObject({ collection: 'guests', id: ids[50] });
    expect(second.nextCursor).toBeNull();
    await admin.get('/api/v1/trash').query({ section: 'programs', cursor: first.nextCursor }).expect(400);
  });

  it('requires access to the original screen and its module', async () => {
    const producer = await loginAgent(server.app, 'producer@akhbar.tv');
    const episode = server.db.listCollection('episodes')[0];
    const removed = server.db.writeRow('episodes', episode.id, { ...episode.d, deletedAt }, episode.p, null);
    const listed = (await producer.get('/api/v1/trash?collection=episodes').expect(200)).body.data;
    expect(listed.items).toContainEqual(expect.objectContaining({ id: episode.id }));

    const role = server.db.listCollection('roles').find(row => row.d.roleCode === 'PRODUCER')!;
    server.db.writeRow('roles', role.id, { ...role.d, screens: ['calendar'] }, role.p, null);
    try {
      expect((await producer.get('/api/v1/trash?collection=episodes').expect(200)).body.data.items).toEqual([]);
      await restore(producer, 'episodes', episode.id, removed.v).expect(403);
    } finally {
      server.db.writeRow('roles', role.id, role.d, role.p, null);
    }

    const settings = server.db.getRow('settings', 'singleton')!;
    server.db.writeRow('settings', settings.id, { ...settings.d, moduleAccess: { programmes: { mode: 'disabled' } } }, settings.p, null);
    try {
      expect((await producer.get('/api/v1/trash?collection=episodes').expect(200)).body.data.items).toEqual([]);
      await restore(producer, 'episodes', episode.id, removed.v).expect(403);
    } finally {
      server.db.writeRow('settings', settings.id, settings.d, settings.p, null);
    }
  });

  it('publishes the effective duration for each item and keeps the inherited default', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const settings = server.db.getRow('settings', 'singleton')!;
    server.db.writeRow('settings', settings.id, { ...settings.d, trashRetentionDays: { news: 7, guests: 0 } }, settings.p, null);
    try {
      const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
      server.db.writeRow('news', 'trash-timed-news', { id: 'trash-timed-news', title: 'خبر بمدة خاصة', deletedAt }, 0, null);
      server.db.writeRow('bulletins', 'trash-grandfathered-bulletin', { id: 'trash-grandfathered-bulletin', title: 'نشرة قديمة', deletedAt: old }, 0, null);
      const news = (await admin.get('/api/v1/trash?collection=news').expect(200)).body.data;
      expect(news.retentionDays).toBe(30);
      expect(news.items).toContainEqual(expect.objectContaining({ id: 'trash-timed-news', retentionDays: 7 }));
      const guests = (await admin.get('/api/v1/trash?collection=guests').expect(200)).body.data;
      expect(guests.items[0]).toMatchObject({ collection: 'guests', retentionDays: 0 });
      const bulletins = (await admin.get('/api/v1/trash?collection=bulletins').expect(200)).body.data;
      expect(bulletins.items).toContainEqual(expect.objectContaining({ id: 'trash-grandfathered-bulletin', retentionDays: 0 }));
      const me = (await admin.get('/api/v1/auth/me').expect(200)).body;
      expect(me.trashRetentionDays).toBe(30);
    } finally {
      server.db.writeRow('settings', settings.id, settings.d, settings.p, null);
    }
  });
});
