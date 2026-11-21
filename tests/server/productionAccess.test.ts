import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';

const headers = { 'X-NRCS-Client': 'web' };
let server: Awaited<ReturnType<typeof createTestServer>>;

beforeEach(async () => { server = await createTestServer(); });
afterEach(() => server.close());

describe('production access', () => {
  it('excludes programs, episodes and air data from a reporter without production read rights', async () => {
    const reporter = await loginAgent(server.app, 'reporter@akhbar.tv');
    const episode = server.db.listCollection('episodes')[0];
    const start = (await reporter.get('/api/v1/data').set(headers)).body;
    expect(start.collections.programs).toEqual([]);
    expect(start.collections.episodes).toEqual([]);
    expect(start.collections.guests[0]?.d).toBeDefined();
    expect(start.collections.guests[0].d).not.toHaveProperty('phone');
    expect(start.collections.guests[0].d).not.toHaveProperty('email');
    server.db.writeRow('onAir', episode.id, { id: episode.id, episodeId: episode.id, status: 'PLANNING' }, 0, null);
    const changes = await reporter.get('/api/v1/data/changes').query({ since: start.rev });
    expect(changes.body.changes).toEqual([]);
    expect((await reporter.get(`/api/v1/air-offline/packet/${episode.id}`)).status).toBe(403);
    expect((await reporter.get(`/api/v1/episodes/${episode.id}/mos`)).status).toBe(403);
  });

  it('confines a cross-station assignment to its linked episode and invalidates the view on revocation', async () => {
    const reporter = await loginAgent(server.app, 'reporter@akhbar.tv');
    const me = (await reporter.get('/api/v1/auth/me')).body.user;
    const episode = server.db.listCollection('episodes')[0];
    const start = (await reporter.get('/api/v1/data')).body;
    expect(start.collections.episodes).toEqual([]);
    const card = {
      id: 'card-access-cross-station', title: 'مساهمة ميدانية في حلقة', kind: 'EPISODE', status: 'OPEN', ownerStationId: 'other-station',
      target: { kind: 'episode', id: episode.id, title: episode.d.title },
      steps: [{ id: 's1', status: 'IN_PROGRESS', assigneeId: me.id }],
    };
    server.db.writeRow('productionCards', card.id, card, 0, null);
    const granted = (await reporter.get('/api/v1/data/changes').query({ since: start.rev, access: start.access })).body;
    expect(granted.reset).toBe(true);
    const opened = (await reporter.get('/api/v1/data')).body;
    expect(opened.collections.episodes.map((row: { id: string }) => row.id)).toEqual([episode.id]);
    expect(opened.collections.programs).toEqual([]);
    expect((await reporter.get(`/api/v1/episodes/${episode.id}/mos`)).status).toBe(200);
    server.db.writeRow('productionCards', card.id, { ...card, steps: [] }, 0, null);
    const revoked = (await reporter.get('/api/v1/data/changes').query({ since: opened.rev, access: opened.access })).body;
    expect(revoked.reset).toBe(true);
    expect((await reporter.get('/api/v1/data')).body.collections.episodes).toEqual([]);
  });
});
