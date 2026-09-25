import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
const H = { 'X-NRCS-Client': 'web' };
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(() => server.close());

const sync = (agent: request.Agent, ops: any[]) => agent.post('/api/v1/data/sync').set(H).send({ ops });
const row = (c: string, id: string) => server.db.getRow(c as any, id)!;

describe('privilege escalation is blocked', () => {
  it('an ADMIN cannot grant their own role database rights', async () => {
    const director = await loginAgent(server.app, 'director@akhbar.tv'); // ADMIN
    const adminRole = server.db.listCollection('roles').find((r) => r.d.roleCode === 'ADMIN')!;
    const res = await sync(director, [
      { c: 'roles', op: 'upsert', id: adminRole.id, d: { ...adminRole.d, permissions: [...adminRole.d.permissions, 'system.database_manage'] }, baseV: adminRole.v },
    ]);
    expect(res.body.results[0].code).toBe('FORBIDDEN');
  });

  it('an ADMIN cannot grant permissions they do not hold to another role', async () => {
    const director = await loginAgent(server.app, 'director@akhbar.tv');
    const editorRole = server.db.listCollection('roles').find((r) => r.d.roleCode === 'EDITOR')!;
    const res = await sync(director, [
      { c: 'roles', op: 'upsert', id: editorRole.id, d: { ...editorRole.d, permissions: [...editorRole.d.permissions, 'system.database_manage'] }, baseV: editorRole.v },
    ]);
    expect(res.body.results[0].code).toBe('FORBIDDEN');
    const ok = await sync(director, [
      { c: 'roles', op: 'upsert', id: editorRole.id, d: { ...editorRole.d, permissions: [...editorRole.d.permissions, 'programs.manage'] }, baseV: editorRole.v },
    ]);
    expect(ok.body.results[0].ok).toBe(true);
  });

  it('new roles cannot hijack a system role code, and system roles cannot be deleted', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const dup = await sync(admin, [{ c: 'roles', op: 'upsert', id: 'role-fake', d: { id: 'role-fake', roleCode: 'EDITOR', permissions: [] } }]);
    expect(dup.body.results[0].code).toBe('FORBIDDEN');
    const sys = server.db.listCollection('roles').find((r) => r.d.roleCode === 'VIEWER')!;
    const del = await sync(admin, [{ c: 'roles', op: 'delete', id: sys.id }]);
    expect(del.body.results[0].code).toBe('FORBIDDEN');
  });

  it('an ADMIN cannot delete a SUPER_ADMIN or change their e-mail', async () => {
    const director = await loginAgent(server.app, 'director@akhbar.tv');
    const del = await sync(director, [{ c: 'users', op: 'delete', id: 'usr-1' }]);
    expect(del.body.results[0].code).toBe('FORBIDDEN');
    const su = row('users', 'usr-1');
    const email = await sync(director, [{ c: 'users', op: 'upsert', id: 'usr-1', d: { ...su.d, email: 'hijack@x.tv' }, baseV: su.v }]);
    expect(email.body.results[0].code).toBe('FORBIDDEN');
  });

  it('creating an account with an admin role needs role-management rights', async () => {
    const director = await loginAgent(server.app, 'director@akhbar.tv');
    const ok = await sync(director, [
      { c: 'users', op: 'upsert', id: 'usr-new-admin', d: { id: 'usr-new-admin', fullName: 'مدير', email: 'new.admin@x.tv', role: 'ADMIN', isActive: true } },
    ]);
    expect(ok.body.results[0].ok).toBe(true); // ADMIN holds users.manage_roles_permissions
    const superAttempt = await sync(director, [
      { c: 'users', op: 'upsert', id: 'usr-new-super', d: { id: 'usr-new-super', fullName: 'س', email: 'su2@x.tv', role: 'SUPER_ADMIN', isActive: true } },
    ]);
    expect(superAttempt.body.results[0].code).toBe('FORBIDDEN');
  });
});

describe('category renames', () => {
  it('propagate to stories on the server, including trashed and locked ones', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const story = row('news', 'nws-2');
    server.db.writeRow('news', 'nws-2', { ...story.d, deletedAt: new Date().toISOString() }, story.p, null);
    const cat = row('categories', story.d.categoryId);
    const res = await sync(admin, [{ c: 'categories', op: 'upsert', id: cat.id, d: { ...cat.d, nameAr: 'اسم جديد' }, baseV: cat.v }]);
    expect(res.body.results[0].ok).toBe(true);
    expect(row('news', 'nws-2').d.categoryName).toBe('اسم جديد');
    expect(row('news', 'nws-2').d.deletedAt).toBeTruthy(); // still in the trash, not destroyed
  });
});

describe('reference data in use', () => {
  it('categories and sources referenced by active news cannot be deleted', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const active = server.db.listCollection('news').find((r) => !r.d.deletedAt && r.d.categoryId && r.d.sourceId)!;
    const cat = await sync(admin, [{ c: 'categories', op: 'delete', id: active.d.categoryId }]);
    expect(cat.body.results[0].code).toBe('FORBIDDEN');
    const src = await sync(admin, [{ c: 'sources', op: 'delete', id: active.d.sourceId }]);
    expect(src.body.results[0].code).toBe('FORBIDDEN');

    const created = await sync(admin, [{ c: 'categories', op: 'upsert', id: 'cat-unused', d: { id: 'cat-unused', nameAr: 'غير مستخدم' } }]);
    expect(created.body.results[0].ok).toBe(true);
    const removed = await sync(admin, [{ c: 'categories', op: 'delete', id: 'cat-unused' }]);
    expect(removed.body.results[0].ok).toBe(true);
  });
});
