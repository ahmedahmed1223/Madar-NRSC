import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestServer, loginAgent, DEMO_PASSWORD } from '../helpers';
import { loadConfig } from '../../src/server/config';
import { tempPasswordKey } from '../../src/server/auth';
import { stationMinutes } from '../../src/server/delivery';
import { deploymentWarnings, scanDemoPasswords } from '../../src/server/deploymentChecks';
import { POLICIES } from '../../src/server/policy';
import { MAX_SESSIONS_PER_USER } from '../../src/server/app';

let server: Awaited<ReturnType<typeof createTestServer>>;
const H = { 'X-NRCS-Client': 'web' };
const sync = (agent: request.Agent, ops: any[]) => agent.post('/api/v1/data/sync').set(H).send({ ops });
const put = (c: string, d: any, baseV?: number) => ({ c, op: 'upsert', id: d.id, d, ...(baseV !== undefined ? { baseV } : {}) });
const row = (c: any, id: string) => server.db.getRow(c, id)!;
const audits = (type: string) => server.db.listCollection('auditLogs').map((r) => r.d).filter((a) => a.actionType === type);
let admin: request.Agent;

beforeAll(async () => {
  server = await createTestServer();
  admin = await loginAgent(server.app, 'admin@akhbar.tv');
});
afterAll(() => server.close());

it('honors a newsroom read restriction in sync, archive search and direct links', async () => {
  const person = server.db.getCredentialsByEmail('trainee@akhbar.tv');
  const user = row('users', person!.userId);
  server.db.writeRow('users', user.id, { ...user.d, customPermissions: ['!news.view'] }, user.p, null);
  try {
    const restricted = await loginAgent(server.app, 'trainee@akhbar.tv');
    const before = (await restricted.get('/api/v1/data')).body;
    expect(before.collections.news).toEqual([]);
    const article = row('news', 'nws-1');
    const id = 'nws-rehearsal-restricted';
    server.db.writeRow('news', id, { ...article.d, id, title: 'مادة لا تظهر في هذا الحساب' }, article.p, null);
    const changes = await restricted.get('/api/v1/data/changes').query({ since: before.rev });
    expect(changes.status).toBe(200);
    expect(changes.body.changes.some((entry: { c: string }) => entry.c === 'news')).toBe(false);
    expect((await restricted.get('/api/v1/archive/news').query({ q: id })).status).toBe(403);
    expect((await restricted.get(`/api/v1/archive/news/${id}`)).status).toBe(403);
    expect((await admin.get(`/api/v1/archive/news/${id}`)).status).toBe(200);
  } finally {
    server.db.writeRow('users', user.id, user.d, user.p, null);
  }
});

describe('roles: codes are unique and custom roles go through customRoleId (C1)', () => {
  it('refuses a duplicate or empty code on update as on create, and audits role changes', async () => {
    const role = { id: 'role-archive-test', roleCode: 'ARCHIVE_TEST', nameAr: 'منسق أرشيف تجربة', nameEn: 'x', description: '', color: '#000', badgeBg: '', badgeText: '', isSystemRole: false, permissions: ['news.view'] };
    expect((await sync(admin, [put('roles', role)])).body.results[0].ok).toBe(true);
    expect(audits('ROLE_CREATE').some((a) => a.targetId === role.id)).toBe(true);
    const dup = await sync(admin, [put('roles', { ...role, roleCode: 'EDITOR' }, row('roles', role.id).v)]);
    expect(dup.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(dup.body.results[0].message).toContain('بنفس الرمز');
    const empty = await sync(admin, [put('roles', { ...role, roleCode: '' }, row('roles', role.id).v)]);
    expect(empty.body.results[0].message).toContain('رمز الدور مطلوب');
    const created2 = await sync(admin, [put('roles', { ...role, id: 'role-archive-2' })]);
    expect(created2.body.results[0].message).toContain('بنفس الرمز');
    // Permissions and screens changes are written by the server, readable.
    await sync(admin, [put('roles', { ...role, permissions: ['news.view', 'news.create'], screens: ['news'] }, row('roles', role.id).v)]);
    const update = audits('ROLE_UPDATE').find((a) => a.targetId === role.id)!;
    expect(update.details).toContain('أُضيفت');
    expect(update.details).not.toContain('{');
  });

  it('assigns custom roles by id only, never by writing their code into `role`', async () => {
    const byCode = await sync(admin, [put('users', { id: 'usr-c1', fullName: 'زميل دور مخصص', email: 'c1@akhbar.tv', role: 'ARCHIVE_TEST', isActive: true })]);
    expect(byCode.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const unknown = await sync(admin, [put('users', { id: 'usr-c1', fullName: 'زميل دور مخصص', email: 'c1@akhbar.tv', role: 'VIEWER', customRoleId: 'role-ghost', isActive: true })]);
    expect(unknown.body.results[0].message).toContain('غير موجود');
    const ok = await sync(admin, [put('users', { id: 'usr-c1', fullName: 'زميل دور مخصص', email: 'c1@akhbar.tv', role: 'VIEWER', customRoleId: 'role-archive-test', isActive: true, lastLogin: '2026-01-01T00:00:00.000Z' })]);
    expect(ok.body.results[0].ok).toBe(true);
    // lastLogin belongs to the server: empty until the first sign-in (M5).
    expect(row('users', 'usr-c1').d.lastLogin).toBeUndefined();
    expect(audits('USER_CREATE').find((a) => a.targetId === 'usr-c1')!.details).toContain('منسق أرشيف تجربة');
  });

  it('keeps the privileged-assignment check for custom roles', () => {
    const auth: any = { user: { id: 'usr-x', role: 'EDITOR' }, can: (p: string) => p === 'users.create' };
    const list = (c: string) => (c === 'roles' ? [{ id: 'role-c', roleCode: 'C_ROLE', isSystemRole: false }] : []);
    const denied = POLICIES.users({ auth, collection: 'users', kind: 'create', before: null, after: { id: 'u', role: 'VIEWER', customRoleId: 'role-c' }, list: list as any });
    expect(denied).toContain('إدارة الأدوار');
    expect(POLICIES.users({ auth, collection: 'users', kind: 'create', before: null, after: { id: 'u', role: 'VIEWER' }, list: list as any })).toBeNull();
  });
});

describe('server-written audit trail (C4)', () => {
  it('refuses audit rows from browsers, admins included', async () => {
    const res = await sync(admin, [put('auditLogs', { id: 'aud-x', actionType: 'DB_RESTORE', details: 'x' })]);
    expect(res.body.results[0].code).toBe('FORBIDDEN');
  });

  it('records role, exceptions, suspension and station changes with before ← after', async () => {
    const u = row('users', 'usr-3');
    const next = { ...u.d, role: 'EDITOR', customPermissions: ['news.breaking_push', '!news.create'], isActive: false, stationId: 'gaza' };
    expect((await sync(admin, [put('users', next, u.v)])).body.results[0].ok).toBe(true);
    expect(audits('ROLE_CHANGE').find((a) => a.targetId === 'usr-3')!.details).toMatch(/«.+» ← «.+»/);
    const overrides = audits('PERMISSION_OVERRIDE').find((a) => a.targetId === 'usr-3')!.details;
    expect(overrides).toContain('منح');
    expect(overrides).toContain('منع');
    expect(audits('USER_SUSPEND').find((a) => a.targetId === 'usr-3')!.severity).toBe('SECURITY');
    expect(audits('USER_STATION_CHANGE').find((a) => a.targetId === 'usr-3')!.details).toContain('غزة');
    const back = row('users', 'usr-3');
    await sync(admin, [put('users', { ...back.d, role: 'JOURNALIST', customPermissions: [], isActive: true, stationId: undefined }, back.v)]);
    expect(audits('USER_ACTIVATE').some((a) => a.targetId === 'usr-3')).toBe(true);
  });

  it('describes settings changes in words, not JSON', async () => {
    const s = row('settings', 'singleton');
    await sync(admin, [put('settings', { ...s.d, organizationName: 'مدار للأخبار' }, s.v)]);
    const entry = audits('SETTINGS_UPDATE')[0];
    expect(entry.details).toContain('اسم المؤسسة');
    expect(entry.details).not.toContain('[{');
  });
});

describe('temporary passwords (C2)', () => {
  it('holds every request except me/logout/change-password until the password is changed', async () => {
    await admin.post('/api/v1/users/usr-6/password').set(H).send({ password: 'Temporary2026x' });
    const user = await loginAgent(server.app, 'reporter@akhbar.tv', 'Temporary2026x');
    expect((await user.get('/api/v1/auth/me')).body.mustChangePassword).toBe(true);
    const data = await user.get('/api/v1/data');
    expect(data.status).toBe(403);
    expect(data.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await sync(user, [put('guests', { id: 'gst-temp', fullName: 'x' })])).body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await user.post('/api/v1/auth/change-password').set(H).send({ currentPassword: 'Temporary2026x', newPassword: 'Reporter2026new' })).status).toBe(200);
    expect((await user.get('/api/v1/data')).status).toBe(200);
    expect(server.db.getMeta(tempPasswordKey('usr-6'))).toBe('');
  });

  it('expires after TEMP_PASSWORD_HOURS', async () => {
    await admin.post('/api/v1/users/usr-10/password').set(H).send({ password: 'Temporary2026y' });
    expect(Date.parse(server.db.getMeta(tempPasswordKey('usr-10'))!)).toBeGreaterThan(Date.now() + 71 * 3600_000);
    server.db.setMeta(tempPasswordKey('usr-10'), new Date(Date.now() - 1000).toISOString());
    const res = await request(server.app).post('/api/v1/auth/login').set(H).send({ email: 'crew@akhbar.tv', password: 'Temporary2026y' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TEMP_PASSWORD_EXPIRED');
    expect(loadConfig({ NODE_ENV: 'test', TEMP_PASSWORD_HOURS: '24' }).tempPasswordHours).toBe(24);
  });
});

describe('stations (C3) and general managers', () => {
  it('refuses dropping a station that still has colleagues through plain settings sync', async () => {
    const u = row('users', 'usr-4');
    await sync(admin, [put('users', { ...u.d, stationId: 'beirut' }, u.v)]);
    const s = row('settings', 'singleton');
    const res = await sync(admin, [put('settings', { ...s.d, stations: [{ id: 'gaza', name: 'غزة' }, { id: 'istanbul', name: 'إسطنبول' }] }, s.v)]);
    expect(res.body.results[0].message).toContain('محطة بديلة');
  });

  it('removes a station by moving its people and open steps, keeping its name for history', async () => {
    const now = new Date().toISOString();
    const card = { id: 'crd-st', title: 'تكليف بيروت', status: 'OPEN', ownerId: 'usr-1', ownerStationId: 'beirut', createdAt: now, updatedAt: now,
      steps: [{ id: 's1', type: 'edit', status: 'TODO', complexity: 1, stationId: 'beirut' }, { id: 's2', type: 'edit', status: 'DONE', complexity: 1, stationId: 'beirut' }] };
    server.db.writeRow('productionCards', card.id, card, 0, null);
    const usage = await admin.get('/api/v1/admin/stations/beirut/usage');
    expect(usage.body.data.members.map((m: any) => m.id)).toContain('usr-4');
    expect(usage.body.data.openSteps).toHaveLength(1);
    expect((await admin.post('/api/v1/admin/stations/beirut/remove').set(H).send({})).status).toBe(409);
    const res = await admin.post('/api/v1/admin/stations/beirut/remove').set(H).send({ replacementId: 'gaza' });
    expect(res.body.data).toEqual({ movedUsers: 1, movedSteps: 1 });
    expect(row('users', 'usr-4').d.stationId).toBe('gaza');
    const after = row('productionCards', 'crd-st').d;
    expect(after.ownerStationId).toBe('gaza');
    expect(after.steps.map((s: any) => s.stationId)).toEqual(['gaza', 'beirut']); // finished work keeps its station
    const settings = row('settings', 'singleton').d;
    expect(settings.stations.map((s: any) => s.id)).not.toContain('beirut');
    expect(settings.stationsArchive).toEqual([expect.objectContaining({ id: 'beirut', name: 'بيروت' })]);
    expect(audits('STATION_REMOVE')[0].details).toContain('غزة');
  });

  it('validates the stations and groups a general manager follows (privileged)', async () => {
    const s = row('settings', 'singleton');
    expect((await sync(admin, [put('settings', { ...s.d, stationGroups: [{ id: 'north', name: 'الشمال', stationIds: ['gaza', 'istanbul'] }] }, s.v)])).body.results[0].ok).toBe(true);
    const u = row('users', 'usr-2');
    const bad = await sync(admin, [put('users', { ...u.d, role: 'GENERAL_MANAGER', managedStationIds: ['beirut'] }, u.v)]);
    expect(bad.body.results[0].message).toContain('غير موجودة');
    const ok = await sync(admin, [put('users', { ...u.d, role: 'GENERAL_MANAGER', managedGroupIds: ['north'] }, u.v)]);
    expect(ok.body.results[0].ok).toBe(true);
    expect(audits('MANAGED_SCOPE_CHANGE').some((a) => a.targetId === 'usr-2')).toBe(true);
    // Somebody who manages users' profiles but not roles cannot widen a manager's reach.
    const auth: any = { user: { id: 'usr-x', role: 'EDITOR' }, can: (p: string) => p === 'users.edit_profile' };
    const before = row('users', 'usr-2').d;
    expect(POLICIES.users({ auth, collection: 'users', kind: 'update', before, after: { ...before, managedStationIds: ['gaza'] }, list: () => [] })).not.toBeNull();
  });
});

describe('administrative departments (M6)', () => {
  it('archives a department in use instead of deleting it, and tells its head about new requests', async () => {
    const s = row('settings', 'singleton');
    const departments = [
      { id: 'newsroom', name: 'غرفة التحرير' },
      { id: 'production', name: 'الإنتاج' },
      { id: 'montage', name: 'المونتاج', parentId: 'production', headUserId: 'usr-4' },
      { id: 'social', name: 'السوشيال ميديا' },
    ];
    const removed = await sync(admin, [put('settings', { ...s.d, departments: departments.filter((d) => d.id !== 'montage') }, s.v)]);
    expect(removed.body.results[0].message).toContain('أرشفه');
    const res = await sync(admin, [put('settings', { ...s.d, departments: [...departments, { id: 'presenters', name: 'المذيعون' }, { id: 'field', name: 'المراسلون' }, { id: 'studio', name: 'الاستديو' }, { id: 'control', name: 'الكنترول', archived: true }] }, s.v)]);
    expect(res.body.results[0].ok).toBe(true);
    expect(audits('DEPARTMENT_CHANGE')[0].details).toContain('السوشيال ميديا');
    const loop = row('settings', 'singleton');
    const cyc = await sync(admin, [put('settings', { ...loop.d, departments: [{ id: 'a', name: 'أ', parentId: 'b' }, { id: 'b', name: 'ب', parentId: 'a' }] }, loop.v)]);
    expect(cyc.body.results[0].ok).toBe(false);

    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    await sync(journalist, [put('requests', { id: 'req-head', type: 'MONTAGE', title: 'مونتاج تقرير', status: 'OPEN' })]);
    expect(server.db.listCollection('notifications').some((n) => n.d.userId === 'usr-4' && n.d.linkUrl === '/requests')).toBe(true);
  });
});

describe('deployment hardening (D1–D7)', () => {
  it('refuses demo data in production unless explicitly allowed', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', SEED_DEMO_DATA: 'true' })).toThrow(/SEED_DEMO_DATA/);
    expect(loadConfig({ NODE_ENV: 'production', SEED_DEMO_DATA: 'true', ALLOW_DEMO_IN_PRODUCTION: 'true' }).seedDemoData).toBe(true);
  });

  it('warns about insecure production settings and demo passwords', async () => {
    const prod = loadConfig({ NODE_ENV: 'production', COOKIE_SECURE: 'false', SEED_DEMO_DATA: 'false' });
    const texts = deploymentWarnings(server.db, { ...prod, timeZone: undefined }).map((w) => w.text).join(' | ');
    expect(texts).toContain('COOKIE_SECURE');
    expect(texts).toContain('APP_URL');
    expect(texts).toContain('TZ');
    expect(await scanDemoPasswords(server.db, server.config, 3)).toBeGreaterThan(0);
    expect(deploymentWarnings(server.db, server.config).map((w) => w.text).join(' ')).toContain('كلمة المرور التجريبية');
  });

  it('hides the database identity from anonymous health checks', async () => {
    const anon = await request(server.app).get('/api/health');
    expect(anon.body.status).toBe('ok');
    expect(anon.body.dbId).toBeUndefined();
    expect(anon.body.instance).toBeUndefined();
    expect((await admin.get('/api/health')).body.dbId).toBe(server.db.dbId);
  });

  it('answers the sign-in screen without a 401 and in Arabic', async () => {
    const me = await request(server.app).get('/api/v1/auth/me?optional=1');
    expect(me.status).toBe(200);
    expect(me.body.user).toBeNull();
    expect((await request(server.app).get('/api/v1/auth/me')).status).toBe(401);
    const empty = await admin.post('/api/v1/data/sync').set(H).send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/[؀-ۿ]/);
  });

  it('keeps at most MAX_SESSIONS_PER_USER sessions per person', async () => {
    for (let i = 0; i < MAX_SESSIONS_PER_USER + 3; i++) await loginAgent(server.app, 'presenter@akhbar.tv', DEMO_PASSWORD);
    expect(server.db.listSessions(new Date().toISOString()).filter((s) => s.userId === 'usr-5')).toHaveLength(MAX_SESSIONS_PER_USER);
  });

  it('requires re-confirming identity before exporting the database', async () => {
    expect((await admin.get('/api/v1/db/export')).status).toBe(401);
    const confirm = await admin.post('/api/v1/db/confirm-operation').set(H).send({ action: 'export', password: DEMO_PASSWORD });
    const res = await admin.get(`/api/v1/db/export?confirmationToken=${confirm.body.data.token}`);
    expect(res.status).toBe(200);
  });

  it('computes quiet hours on the station clock', () => {
    const s = row('settings', 'singleton');
    server.db.writeRow('settings', 'singleton', { ...s.d, defaultTimezone: 'Asia/Riyadh' }, s.p, null);
    expect(stationMinutes(server.db, Date.parse('2026-11-19T20:30:00Z'))).toBe(23 * 60 + 30);
  });
});
