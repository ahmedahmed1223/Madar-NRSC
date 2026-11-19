import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
let admin: request.Agent;
let journalist: request.Agent;
const H = { 'X-NRCS-Client': 'web' };
const sync = (agent: request.Agent, ops: any[]) => agent.post('/api/v1/data/sync').set(H).send({ ops });
const row = (c: string, id: string) => server.db.getRow(c as any, id)!;

beforeAll(async () => {
  server = await createTestServer();
  admin = await loginAgent(server.app, 'admin@akhbar.tv');
  journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
});
afterAll(() => server.close());

describe('source renames', () => {
  it('propagate the new name to news and agency wires that reference the source', async () => {
    const source = server.db.listCollection('sources')[0];
    const other = server.db.listCollection('sources').find((s) => s.id !== source.id)!;
    const now = new Date().toISOString();
    const baseNews = server.db.listCollection('news')[0];
    server.db.writeRow('news', 'nws-src-a', { ...baseNews.d, id: 'nws-src-a', sourceId: source.id, sourceName: source.d.name }, 9001, null);
    server.db.writeRow('news', 'nws-src-b', { ...baseNews.d, id: 'nws-src-b', sourceId: other.id, sourceName: other.d.name }, 9002, null);
    const wire = { id: 'wir-src-a', sourceId: source.id, sourceName: source.d.name, guid: 'g-1', title: 'مادة وكالة', summary: '', link: '', publishedAt: now, fetchedAt: now, categories: [] };
    server.db.writeRow('wires', 'wir-src-a', wire, -1, null);
    server.db.writeRow('wires', 'wir-src-b', { ...wire, id: 'wir-src-b', guid: 'g-2', sourceId: other.id, sourceName: other.d.name }, -2, null);

    // Renaming needs system.settings; a refused rename touches nothing.
    const denied = await sync(journalist, [{ c: 'sources', op: 'upsert', id: source.id, d: { ...source.d, name: 'اسم مرفوض' }, baseV: source.v }]);
    expect(denied.body.results[0].ok).toBe(false);
    expect(row('news', 'nws-src-a').d.sourceName).toBe(source.d.name);

    const res = await sync(admin, [{ c: 'sources', op: 'upsert', id: source.id, d: { ...source.d, name: 'وكالة باسم جديد' }, baseV: source.v }]);
    expect(res.body.results[0].ok).toBe(true);
    expect(row('sources', source.id).d.name).toBe('وكالة باسم جديد');
    expect(row('news', 'nws-src-a').d.sourceName).toBe('وكالة باسم جديد');
    expect(row('wires', 'wir-src-a').d.sourceName).toBe('وكالة باسم جديد');
    // Rows of other sources keep their names.
    expect(row('news', 'nws-src-b').d.sourceName).toBe(other.d.name);
    expect(row('wires', 'wir-src-b').d.sourceName).toBe(other.d.name);
  });

  it('leaves references alone when other fields of the source change', async () => {
    const source = server.db.listCollection('sources')[0];
    const versionBefore = row('wires', 'wir-src-a').v;
    const res = await sync(admin, [{ c: 'sources', op: 'upsert', id: source.id, d: { ...source.d, reliabilityScore: 2 }, baseV: source.v }]);
    expect(res.body.results[0].ok).toBe(true);
    expect(row('wires', 'wir-src-a').v).toBe(versionBefore);
  });
});

describe('category renames', () => {
  it('propagate the new name to stories as well as news', async () => {
    const cat = server.db.listCollection('categories')[0];
    const story = server.db.listCollection('stories')[0];
    expect(story).toBeTruthy();
    server.db.writeRow('stories', story.id, { ...story.d, categoryId: cat.id, categoryName: cat.d.nameAr }, story.p, null);
    const baseNews = server.db.listCollection('news')[0];
    server.db.writeRow('news', 'nws-cat-a', { ...baseNews.d, id: 'nws-cat-a', categoryId: cat.id, categoryName: cat.d.nameAr }, 9003, null);

    const res = await sync(admin, [{ c: 'categories', op: 'upsert', id: cat.id, d: { ...cat.d, nameAr: 'قسم بعد التسمية' }, baseV: cat.v }]);
    expect(res.body.results[0].ok).toBe(true);
    expect(row('stories', story.id).d.categoryName).toBe('قسم بعد التسمية');
    expect(row('news', 'nws-cat-a').d.categoryName).toBe('قسم بعد التسمية');
  });
});

describe('program type renames', () => {
  it('propagate the new name to programs of that type', async () => {
    const program = server.db.listCollection('programs')[0];
    server.db.writeRow('programTypes', 'ptype-rename', { id: 'ptype-rename', nameAr: 'حواري', name: 'حواري' }, 50, null);
    server.db.writeRow('programs', program.id, { ...program.d, typeId: 'ptype-rename', typeName: 'حواري' }, program.p, null);
    const type = row('programTypes', 'ptype-rename');
    const res = await sync(admin, [{ c: 'programTypes', op: 'upsert', id: type.id, d: { ...type.d, nameAr: 'حواري سياسي', name: 'حواري سياسي' }, baseV: type.v }]);
    expect(res.body.results[0].ok).toBe(true);
    expect(row('programs', program.id).d.typeName).toBe('حواري سياسي');
  });
});

describe('programme types in use', () => {
  it('cannot be deleted while a programme uses them', async () => {
    const { createTestServer: create, loginAgent: login } = await import('../helpers');
    const srv = await create();
    try {
      const admin = await login(srv.app, 'admin@akhbar.tv');
      const program = srv.db.listCollection('programs').find((r) => !r.d.deletedAt && r.d.typeId)!;
      const type = srv.db.getRow('programTypes', program.d.typeId)!;
      const H = { 'X-NRCS-Client': 'web' };
      const refused = await admin.post('/api/v1/data/sync').set(H).send({ ops: [{ c: 'programTypes', op: 'delete', id: type.id }] });
      expect(refused.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
      expect(refused.body.results[0].message).toContain('البرامج تستخدمه');
      const created = await admin.post('/api/v1/data/sync').set(H).send({ ops: [{ c: 'programTypes', op: 'upsert', id: 'ptype-unused', d: { id: 'ptype-unused', nameAr: 'نوع غير مستخدم' } }] });
      expect(created.body.results[0].ok).toBe(true);
      const removed = await admin.post('/api/v1/data/sync').set(H).send({ ops: [{ c: 'programTypes', op: 'delete', id: 'ptype-unused' }] });
      expect(removed.body.results[0].ok).toBe(true);
    } finally {
      srv.close();
    }
  });
});
