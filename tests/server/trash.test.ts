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
  it('lists compact metadata across sections and restores a program with its original fields', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const program = server.db.listCollection('programs')[0];
    const episode = server.db.listCollection('episodes').find(row => row.d.programId === program.id)!;
    const deletedProgram = server.db.writeRow('programs', program.id, { ...program.d, deletedAt }, program.p, null);
    const guest = server.db.listCollection('guests')[0];
    const deletedGuest = server.db.writeRow('guests', guest.id, { ...guest.d, deletedAt }, guest.p, null);
    const listed = await admin.get('/api/v1/trash').expect(200);
    expect(listed.body.data.items).toEqual(expect.arrayContaining([
      { collection: 'programs', id: program.id, title: program.d.name, deletedAt, version: deletedProgram.v, retentionDays: 30 },
      { collection: 'guests', id: guest.id, title: guest.d.fullName, deletedAt, version: deletedGuest.v, retentionDays: 30 },
    ]));
    expect(listed.body.data.items).not.toContainEqual(expect.objectContaining({ collection: 'episodes', id: episode.id }));
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
