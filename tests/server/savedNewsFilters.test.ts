import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { DEFAULT_NEWS_FILTER } from '../../src/shared/savedNewsFilters';

let server: Awaited<ReturnType<typeof createTestServer>>;
let journalist: Awaited<ReturnType<typeof loginAgent>>;
let admin: Awaited<ReturnType<typeof loginAgent>>;
const draft = (name = 'Private filter') => ({ schemaVersion: 1, name, pinned: false, definition: { ...DEFAULT_NEWS_FILTER } });
const send = async (agent: typeof admin, id: string, d?: any, baseV?: number, op = 'upsert') => {
  const response = await agent.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [{ c: 'savedNewsFilters', op, id, d, baseV }] });
  expect(response.status).toBe(200);
  return response.body.results[0];
};
beforeAll(async () => {
  server = await createTestServer();
  journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
  admin = await loginAgent(server.app, 'admin@akhbar.tv');
});
afterAll(() => server.close());

it('stamps authenticated owner and timestamps and trims the name', async () => {
  const result = await send(journalist, 'private-a', { ...draft('  My news  '), ownerId: 'forged', createdAt: '2000-01-01', updatedAt: '2000-01-01' });
  expect(result.ok).toBe(true);
  expect(result.row.d.ownerId).not.toBe('forged');
  expect(result.row.d.createdAt).not.toBe('2000-01-01');
  expect(result.row.d.name).toBe('My news');
});
it('keeps filters private in bootstrap and changes even from an admin', async () => {
  const rev = server.db.currentRev();
  expect((await send(journalist, 'private-b', draft())).ok).toBe(true);
  const own = await journalist.get('/api/v1/data');
  const foreign = await admin.get('/api/v1/data');
  expect(own.status).toBe(200);
  expect(foreign.status).toBe(200);
  expect(own.body.collections.savedNewsFilters.some((r: any) => r.id === 'private-b')).toBe(true);
  expect(foreign.body.collections.savedNewsFilters).toEqual([]);
  const changes = await admin.get(`/api/v1/data/changes?since=${rev}`);
  expect(changes.body.changes.filter((r: any) => r.c === 'savedNewsFilters')).toEqual([]);
});
it('rejects foreign mutation and stale guesses without a current payload', async () => {
  for (const [op, baseV] of [['upsert', undefined], ['upsert', 999], ['delete', undefined], ['delete', 1]] as const) {
    const result = await send(admin, 'private-a', draft('Hijacked'), baseV, op);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('current');
  }
});
it('rejects unsupported definitions and enforces the per-owner cap', async () => {
  expect((await send(admin, 'bad-filter', { ...draft(), definition: { ...DEFAULT_NEWS_FILTER, query: 'SELECT *' } })).ok).toBe(false);
  for (let i = 0; i < 30; i++) expect((await send(admin, `cap-${i}`, draft())).ok).toBe(true);
  expect((await send(admin, 'cap-over', draft())).ok).toBe(false);
  expect((await send(journalist, 'different-owner', draft())).ok).toBe(true);
});
it('rejects stale updates and deletes and retries never create duplicate records', async () => {
  const first = await send(journalist, 'versioned', draft());
  expect(first.ok).toBe(true);
  const next = await send(journalist, 'versioned', draft('New name'), first.row.v);
  expect(next.ok).toBe(true);
  expect((await send(journalist, 'versioned', draft('Stale'), first.row.v)).code).toBe('CONFLICT');
  expect((await send(journalist, 'versioned', undefined, first.row.v, 'delete')).code).toBe('CONFLICT');
  expect((await send(journalist, 'versioned', draft())).code).toBe('CONFLICT');
  const own = await journalist.get('/api/v1/data');
  expect(own.status).toBe(200);
  expect(own.body.collections.savedNewsFilters.filter((r: any) => r.id === 'versioned')).toHaveLength(1);
  expect((await send(journalist, 'versioned', undefined, next.row.v, 'delete')).ok).toBe(true);
});
it('sends a private tombstone only to its owner and blocks foreign recreation', async () => {
  const created = await send(journalist, 'deleted-private', draft());
  const rev = server.db.currentRev();
  expect((await send(journalist, 'deleted-private', undefined, created.row.v, 'delete')).ok).toBe(true);
  const own = await journalist.get(`/api/v1/data/changes?since=${rev}`);
  expect(own.body.changes.some((r: any) => r.id === 'deleted-private' && r.deleted)).toBe(true);
  const foreign = await admin.get(`/api/v1/data/changes?since=${rev}`);
  expect(foreign.body.changes.some((r: any) => r.id === 'deleted-private')).toBe(false);
  const result = await send(admin, 'deleted-private', draft());
  expect(result.ok).toBe(false);
  expect(result).not.toHaveProperty('current');
});
