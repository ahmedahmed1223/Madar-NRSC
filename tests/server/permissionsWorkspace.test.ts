import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { DEFAULT_ROLE_DEFINITIONS } from '../../src/shared/rbac';
import { buildAuthContext } from '../../src/server/auth';
import { canRead } from '../../src/server/policy';
let server: Awaited<ReturnType<typeof createTestServer>>;
let admin: Awaited<ReturnType<typeof loginAgent>>;
beforeAll(async () => {
  server = await createTestServer();
  admin = await loginAgent(server.app, 'admin@akhbar.tv');
});
afterAll(() => server.close());
it('loads a versioned permissions workspace and saves a department policy without altering other settings', async () => {
  const response = await admin.get('/api/v1/admin/permissions');
  expect(response.status).toBe(200);
  const snapshot = response.body.data;
  const original = server.db.getRow('settings', 'singleton')!.d;
  const saved = await admin.put('/api/v1/admin/permissions').set('X-NRCS-Client', 'web')
    .send({ version: snapshot.version, kind: 'department', id: 'newsroom', permissions: ['!news.publish', 'media.upload'] });
  expect(saved.status).toBe(200);
  const next = server.db.getRow('settings', 'singleton')!.d;
  expect(next.organizationName).toBe(original.organizationName);
  expect(next.departments.find((d: any) => d.id === 'newsroom').permissionOverrides).toEqual(['!news.publish', 'media.upload']);
  expect(server.db.listCollection('auditLogs').some(r => r.d.actionType === 'PERMISSIONS_UPDATED' && r.d.targetId === 'newsroom')).toBe(true);
  const stale = await admin.put('/api/v1/admin/permissions').set('X-NRCS-Client', 'web')
    .send({ version: snapshot.version, kind: 'department', id: 'newsroom', permissions: [] });
  expect(stale.status).toBe(409);
});
it.each([['news.view', '!news.view'], ['unknown.permission'], ['!work.assigned_only']])('rejects invalid or scope-widening department policies %j', async (...permissions) => {
  const snapshot = (await admin.get('/api/v1/admin/permissions')).body.data;
  const response = await admin.put('/api/v1/admin/permissions').set('X-NRCS-Client', 'web')
    .send({ version: snapshot.version, kind: 'department', id: 'newsroom', permissions });
  expect(response.status).toBe(400);
});
it('applies department changes to an already signed-in account and its sync access token', async () => {
  const person = await loginAgent(server.app, 'producer@akhbar.tv');
  const row = server.db.listCollection('users').find(r => r.d.email === 'producer@akhbar.tv')!;
  server.db.writeRow('users', row.id, { ...row.d, departmentId: 'production' }, row.p, null);
  const bootstrap = (await person.get('/api/v1/data')).body;
  const snapshot = (await admin.get('/api/v1/admin/permissions')).body.data;
  expect((await person.get('/api/v1/auth/me')).body.permissions).toContain('news.view');
  expect((await admin.put('/api/v1/admin/permissions').set('X-NRCS-Client', 'web')
    .send({ version: snapshot.version, kind: 'department', id: 'production', permissions: ['!news.view'] })).status).toBe(200);
  expect((await person.get('/api/v1/auth/me')).body.permissions).not.toContain('news.view');
  const changes = await person.get(`/api/v1/data/changes?since=${bootstrap.rev}&access=${bootstrap.access}`);
  expect(changes.body.reset).toBe(true);
});

async function editorFixture() {
  const fixture = await createTestServer();
  const original = fixture.db.listCollection('users').find(r => r.d.email === 'producer@akhbar.tv')!;
  fixture.db.writeRow('roles', 'policy-editor', { ...DEFAULT_ROLE_DEFINITIONS[0], id: 'policy-editor', roleCode: 'POLICY_EDITOR', isSystemRole: false,
    permissions: ['users.view', 'users.edit_profile', 'users.manage_roles_permissions', 'system.settings', 'news.view'] }, 100, null);
  fixture.db.writeRow('users', original.id, { ...original.d, customRoleId: 'policy-editor', departmentId: 'production' }, original.p, null);
  return { ...fixture, actorId: original.id, editor: await loginAgent(fixture.app, original.d.email) };
}
it('blocks own department writes and grants beyond the editor ceiling', async () => {
  const f = await editorFixture();
  try {
    const snapshot = (await f.editor.get('/api/v1/admin/permissions')).body.data;
    for (const target of [{ id: 'production', permissions: ['news.view'] }, { id: 'montage', permissions: ['media.upload'] }]) {
      const response = await f.editor.put('/api/v1/admin/permissions').set('X-NRCS-Client', 'web')
        .send({ version: snapshot.version, kind: 'department', ...target });
      expect(response.status).toBe(403);
    }
    // A harmless foreign-department grant held by the actor is allowed.
    expect((await f.editor.put('/api/v1/admin/permissions').set('X-NRCS-Client', 'web')
      .send({ version: snapshot.version, kind: 'department', id: 'montage', permissions: ['news.view'] })).status).toBe(200);
  } finally { f.close(); }
});
it('blocks ancestor writes and settings-path policy escalation', async () => {
  const f = await editorFixture();
  try {
    const settings = f.db.getRow('settings', 'singleton')!;
    const departments = [...(settings.d.departments || [{ id: 'production', name: 'الإنتاج' }, { id: 'newsroom', name: 'الأخبار' }])];
    const next = departments.map(d => d.id === 'production' ? { ...d, parentId: 'newsroom' } : d);
    f.db.writeRow('settings', 'singleton', { ...settings.d, departments: next }, settings.p, null);
    const snapshot = (await f.editor.get('/api/v1/admin/permissions')).body.data;
    expect((await f.editor.put('/api/v1/admin/permissions').set('X-NRCS-Client', 'web')
      .send({ version: snapshot.version, kind: 'department', id: 'newsroom', permissions: ['news.view'] })).status).toBe(403);
    const base = f.db.getRow('settings', 'singleton')!;
    const result = await f.editor.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [{
      c: 'settings', op: 'upsert', id: 'singleton', baseV: base.v,
      d: { ...base.d, departments: next.map(d => d.id === 'newsroom' ? { ...d, permissionOverrides: ['media.upload'] } : d) },
    }] });
    expect(result.body.results[0].ok).toBe(false);
  } finally { f.close(); }
});
it('blocks permission escalation through user overrides or transfer', async () => {
  const f = await editorFixture();
  try {
    const target = f.db.listCollection('users').find(r => r.d.email === 'journalist@akhbar.tv') || f.db.listCollection('users').find(r => r.id !== f.actorId && r.d.role !== 'SUPER_ADMIN')!;
    const snapshot = (await f.editor.get('/api/v1/admin/permissions')).body.data;
    expect((await f.editor.put('/api/v1/admin/permissions').set('X-NRCS-Client', 'web')
      .send({ version: snapshot.version, kind: 'user', id: target.id, permissions: ['media.delete'] })).status).toBe(403);
    const base = f.db.getRow('settings', 'singleton')!;
    f.db.writeRow('settings', 'singleton', { ...base.d, departments: [
      { id: 'production', name: 'الإنتاج' }, { id: 'old', name: 'القديم', permissionOverrides: ['!media.delete'] },
      { id: 'new', name: 'الجديد', permissionOverrides: ['media.delete'] },
    ] }, base.p, null);
    f.db.writeRow('users', target.id, { ...target.d, role: 'VIEWER', customRoleId: undefined, departmentId: 'old', customPermissions: [] }, target.p, null);
    const current = f.db.getRow('users', target.id)!;
    const response = await f.editor.post('/api/v1/data/sync').set('X-NRCS-Client', 'web')
      .send({ ops: [{ c: 'users', op: 'upsert', id: target.id, baseV: current.v, d: { ...current.d, departmentId: 'new' } }] });
    expect(response.body.results[0].ok).toBe(false);
  } finally { f.close(); }
});
it('cannot assign a powerful role to an inactive account as a latent privilege grant', async () => {
  const f = await editorFixture();
  try {
    const target = f.db.listCollection('users').find(r => r.id !== f.actorId && r.d.role !== 'SUPER_ADMIN')!;
    f.db.writeRow('users', target.id, { ...target.d, role: 'VIEWER', isActive: false, customRoleId: undefined, customPermissions: [] }, target.p, null);
    const row = f.db.getRow('users', target.id)!;
    const response = await f.editor.post('/api/v1/data/sync').set('X-NRCS-Client', 'web')
      .send({ ops: [{ c: 'users', op: 'upsert', id: row.id, baseV: row.v, d: { ...row.d, role: 'ADMIN' } }] });
    expect(response.body.results[0].ok).toBe(false);
  } finally { f.close(); }
});
it('department grants do not bypass module availability or assigned-resource scope', async () => {
  const f = await createTestServer();
  try {
    const row = f.db.listCollection('users').find(r => r.d.email === 'producer@akhbar.tv')!;
    const worker = { ...row.d, role: 'VIEWER', customRoleId: undefined, departmentId: 'field', customPermissions: ['work.assigned_only'] };
    f.db.writeRow('users', row.id, worker, row.p, null);
    const settings = f.db.getRow('settings', 'singleton')!;
    f.db.writeRow('settings', 'singleton', { ...settings.d,
      moduleAccess: { programmes: { mode: 'disabled' } },
      departments: [{ id: 'field', name: 'الميدان', permissionOverrides: ['cards.view', 'cards.work', 'programs.view'] }],
    }, settings.p, null);
    const auth = buildAuthContext(f.db, worker, '');
    expect(auth.can('cards.view')).toBe(true);
    expect(auth.can('programs.view')).toBe(true);
    expect(canRead(auth, 'programs', { id: 'foreign-program' })).toBe(false);
    expect(canRead(auth, 'productionCards', { id: 'foreign-card', steps: [{ assigneeId: 'another-user', stationId: 'foreign-station' }] })).toBe(false);
    expect(canRead(auth, 'productionCards', { id: 'own-card', steps: [{ assigneeId: worker.id }] })).toBe(true);
  } finally { f.close(); }
});
it('a department restriction constrains existing individual denials and rejects new ones in both write paths', async () => {
  const f = await createTestServer();
  try {
    const root = await loginAgent(f.app, 'admin@akhbar.tv');
    const target = f.db.listCollection('users').find(r => r.d.email === 'producer@akhbar.tv')!;
    const base = { ...target.d, role: 'VIEWER', customRoleId: undefined, departmentId: 'field', customPermissions: ['!work.assigned_only'] };
    f.db.writeRow('users', target.id, base, target.p, null);
    const settings = f.db.getRow('settings', 'singleton')!;
    f.db.writeRow('settings', 'singleton', { ...settings.d, departments: [{ id: 'field', name: 'الميدان', permissionOverrides: ['work.assigned_only', 'cards.view'] }] }, settings.p, null);
    const auth = buildAuthContext(f.db, base, '');
    expect(canRead(auth, 'productionCards', { id: 'foreign', steps: [{ assigneeId: 'other' }] })).toBe(false);
    expect(canRead(auth, 'productionCards', { id: 'own', steps: [{ assigneeId: target.id }] })).toBe(true);
    f.db.writeRow('users', target.id, { ...base, customPermissions: [] }, target.p, null);
    const version = (await root.get('/api/v1/admin/permissions')).body.data.version;
    const dedicated = await root.put('/api/v1/admin/permissions').set('X-NRCS-Client', 'web')
      .send({ version, kind: 'user', id: target.id, permissions: ['!work.assigned_only'] });
    expect([400, 403]).toContain(dedicated.status);
    const current = f.db.getRow('users', target.id)!;
    const legacy = await root.post('/api/v1/data/sync').set('X-NRCS-Client', 'web')
      .send({ ops: [{ c: 'users', op: 'upsert', id: target.id, baseV: current.v, d: { ...current.d, customPermissions: ['!work.assigned_only'] } }] });
    expect(legacy.body.results[0].ok).toBe(false);
  } finally { f.close(); }
});
it.each(['user', 'department', 'role'])('a scoped policy editor cannot remove restrictions through a %s update', async (kind) => {
  const f = await editorFixture();
  try {
    const actor = f.db.getRow('users', f.actorId)!;
    f.db.writeRow('users', actor.id, { ...actor.d, customPermissions: ['work.assigned_only'] }, actor.p, null);
    const role = { ...DEFAULT_ROLE_DEFINITIONS[0], id: 'restricted-viewer', roleCode: 'RESTRICTED_VIEWER', isSystemRole: false, permissions: ['news.view', 'work.assigned_only'] };
    f.db.writeRow('roles', role.id, role, 99, null);
    const target = f.db.listCollection('users').find(r => r.id !== actor.id && r.d.role !== 'SUPER_ADMIN')!;
    f.db.writeRow('users', target.id, { ...target.d, role: 'VIEWER', customRoleId: kind === 'role' ? role.id : undefined, departmentId: 'field', customPermissions: kind === 'user' ? ['work.assigned_only'] : [] }, target.p, null);
    const settings = f.db.getRow('settings', 'singleton')!;
    f.db.writeRow('settings', 'singleton', { ...settings.d, departments: [
      { id: 'production', name: 'الإنتاج', permissionOverrides: [] },
      { id: 'field', name: 'الميدان', permissionOverrides: kind === 'department' ? ['work.assigned_only'] : [] },
    ] }, settings.p, null);
    if (kind === 'role') {
      const row = f.db.getRow('roles', role.id)!;
      const result = await f.editor.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [{ c: 'roles', op: 'upsert', id: role.id, baseV: row.v, d: { ...role, permissions: ['news.view'] } }] });
      expect(result.body.results[0].ok).toBe(false);
    } else {
      const version = (await f.editor.get('/api/v1/admin/permissions')).body.data.version;
      const result = await f.editor.put('/api/v1/admin/permissions').set('X-NRCS-Client', 'web').send({
        version, kind, id: kind === 'user' ? target.id : 'field', permissions: kind === 'user' ? ['!work.assigned_only'] : [],
      });
      expect([400, 403]).toContain(result.status);
    }
  } finally { f.close(); }
});
it('rejects forged department administrative grants', async () => {
  const snapshot = (await admin.get('/api/v1/admin/permissions')).body.data;
  const response = await admin.put('/api/v1/admin/permissions').set('X-NRCS-Client', 'web')
    .send({ version: snapshot.version, kind: 'department', id: 'newsroom', permissions: ['users.manage_roles_permissions'] });
  expect(response.status).toBe(400);
});
it('refuses an ordinary employee access to the workspace', async () => {
  const viewer = await loginAgent(server.app, 'producer@akhbar.tv');
  expect((await viewer.get('/api/v1/admin/permissions')).status).toBe(403);
});
