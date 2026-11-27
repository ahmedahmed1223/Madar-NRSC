import { afterAll, beforeAll, expect, it } from 'vitest';
import type request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
let owner: request.Agent;
let colleague: request.Agent;
let outsider: request.Agent;

beforeAll(async () => {
  server = await createTestServer();
  const settings = server.db.getRow('settings', 'singleton')!;
  server.db.writeRow('settings', settings.id, {
    ...settings.d,
    stations: [
      { id: 'gaza', name: 'غزة', linkedIds: [] },
      { id: 'beirut', name: 'بيروت', linkedIds: [] },
      { id: 'istanbul', name: 'إسطنبول', isMain: true },
    ],
    stationGroups: [],
  }, settings.p, null);
  for (const [id, stationId] of [['usr-7', 'gaza'], ['usr-3', 'gaza'], ['usr-6', 'beirut']]) {
    const account = server.db.getRow('users', id)!;
    server.db.writeRow('users', id, { ...account.d, stationId, customPermissions: ['media.view', 'media.upload'] }, account.p, null);
  }
  owner = await loginAgent(server.app, 'media@akhbar.tv');
  colleague = await loginAgent(server.app, 'journalist@akhbar.tv');
  outsider = await loginAgent(server.app, 'reporter@akhbar.tv');
});
afterAll(() => server.close());

const write = async (agent: request.Agent, op: Record<string, unknown>) => {
  const response = await agent.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [op] });
  return response.body.results[0];
};
const folder = (id: string, patch: Record<string, unknown> = {}) => ({
  id, ownerId: 'usr-7', stationId: 'gaza', name: 'مواد التغطية', ...patch,
});
const create = (agent: request.Agent, data: ReturnType<typeof folder>) =>
  write(agent, { c: 'mediaFolders', op: 'upsert', id: data.id, d: data });
const patchFolder = (agent: request.Agent, id: string, patch: Record<string, unknown>) => {
  const row = server.db.getRow('mediaFolders', id)!;
  return write(agent, { c: 'mediaFolders', op: 'upsert', id, baseV: row.v, d: { ...row.d, ...patch } });
};

it('enforces folder ownership, station and tree integrity on collection writes', async () => {
  expect(await create(owner, folder('folder-main'))).toMatchObject({ ok: true });
  expect(await create(owner, folder('folder-duplicate'))).toMatchObject({ ok: false });
  expect(await create(owner, folder('folder-invalid', { name: '../مواد' }))).toMatchObject({ ok: false });
  expect(await create(owner, folder('folder-foreign', { stationId: 'beirut' }))).toMatchObject({ ok: false });
  expect(await create(owner, folder('folder-child', { parentId: 'folder-main' }))).toMatchObject({ ok: true });
  expect(await patchFolder(owner, 'folder-main', { parentId: 'folder-child' })).toMatchObject({ ok: false });
  expect(await patchFolder(colleague, 'folder-main', { name: 'تعديل لا يملكه الزميل' })).toMatchObject({ ok: false });
  const main = server.db.getRow('mediaFolders', 'folder-main')!;
  expect(await write(owner, { c: 'mediaFolders', op: 'delete', id: main.id, baseV: main.v })).toMatchObject({ ok: false });
  const visible = async (agent: request.Agent) => (await agent.get('/api/v1/data')).body.collections.mediaFolders;
  expect((await visible(colleague)).map((row: { id: string }) => row.id)).toContain(main.id);
  expect((await visible(outsider)).map((row: { id: string }) => row.id)).not.toContain(main.id);
});

it('validates asset moves and protects folders that still hold media', async () => {
  const record = server.db.listCollection('media').find(row => !row.d.deletedAt && !row.d.privateMessageMedia)!;
  server.db.writeRow('media', record.id, { ...record.d, ownerId: 'usr-7' }, record.p, null);
  const move = (folderId: string | null) => {
    const row = server.db.getRow('media', record.id)!;
    return write(owner, { c: 'media', op: 'upsert', id: row.id, baseV: row.v, d: { ...row.d, folderId } });
  };
  expect(await move('folder-missing')).toMatchObject({ ok: false });
  expect(await move('folder-child')).toMatchObject({ ok: true });
  expect(server.db.getRow('media', record.id)!.d.folderId).toBe('folder-child');
  expect(await patchFolder(owner, 'folder-child', { deletedAt: new Date().toISOString() })).toMatchObject({ ok: false });
  expect(await move(null)).toMatchObject({ ok: true });
  expect(await patchFolder(owner, 'folder-child', { deletedAt: new Date().toISOString() })).toMatchObject({ ok: true });
  expect(await move('folder-child')).toMatchObject({ ok: false });
});
