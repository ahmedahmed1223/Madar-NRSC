import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createTestServer, DEMO_PASSWORD, loginAgent } from '../helpers';
import { seedDatabase } from '../../src/server/seed';

const H = { 'X-NRCS-Client': 'web' };
const INSTALL_TOKEN = 'example-test-setup-token-1234567890';
const setupStatus = '/api/v1/auth/setup';
const setupAdministrator = '/api/v1/auth/setup/administrator';
let server: Awaited<ReturnType<typeof createTestServer>> | undefined;
afterEach(() => { server?.close(); server = undefined; });

it('allows a token holder to claim an opted-in clean installation exactly once', async () => {
  server = await createTestServer({ SEED_DEMO_DATA: 'false', INSTALL_SETUP_TOKEN: INSTALL_TOKEN });
  const { app, db, config } = server;
  const data = { fullName: 'مسؤول المؤسسة', email: 'owner@example.com', password: 'PrivateOwner2026' };
  expect(db.countCredentials()).toBe(0);
  await seedDatabase(db, config);
  const client = request(app);
  const setup = await client.get(setupStatus).expect(200).expect('Cache-Control', /no-store/);
  expect(setup.body.data).toEqual({ mode: 'browser' });
  await client.post(setupAdministrator).send({ ...data, token: INSTALL_TOKEN }).expect(403);
  await client.post(setupAdministrator).set(H).send({ ...data, token: 'wrong' }).expect(403);
  await client.post(setupAdministrator).set(H).send({ ...data, token: INSTALL_TOKEN, password: 'weak' }).expect(400);
  await client.post(setupAdministrator).set(H).send({ ...data, token: INSTALL_TOKEN, temporaryPassword: 'true' }).expect(400);
  expect(db.countCredentials()).toBe(0);
  const results = await Promise.all([
    client.post(setupAdministrator).set(H).send({ ...data, token: INSTALL_TOKEN, role: 'ADMIN' }),
    client.post(setupAdministrator).set(H).send({ ...data, token: INSTALL_TOKEN, role: 'ADMIN' }),
  ]);
  expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
  expect(db.countCredentials()).toBe(1);
  await seedDatabase(db, config);
  expect((await client.get(setupStatus).expect(200)).body.data).toEqual({ mode: null });
  await client.post(setupAdministrator).set(H).send({ ...data, token: INSTALL_TOKEN }).expect(409);
  const owner = await loginAgent(app, data.email, data.password);
  const session = (await owner.get('/api/v1/auth/me').expect(200)).body;
  expect(session.user.role).toBe('SUPER_ADMIN');
  expect(session.mustChangePassword).toBe(false);
  expect(session.setupReviewId).toEqual(expect.any(String));
});

it('creates a team profile and usable temporary credentials in one transaction', async () => {
  server = await createTestServer();
  const { app, db } = server;
  const admin = await loginAgent(app, 'admin@akhbar.tv');
  const staff = await loginAgent(app, 'journalist@akhbar.tv');
  const user = { fullName: 'محرر المناوبة', role: 'JOURNALIST', email: 'shift-editor@example.com', jobTitle: 'صحفي', departmentId: 'newsroom' };
  const password = 'ShiftEditor2026';
  const endpoint = '/api/v1/users';
  await staff.post(endpoint).set(H).send({ user, password }).expect(403);
  await admin.post(endpoint).set(H).send({ user, password: 'weak' }).expect(400);
  expect(db.findUserIdByEmail(user.email)).toBeFalsy();
  const interrupted = vi.spyOn(db, 'setPassword').mockImplementationOnce(() => { throw new Error('simulated credential storage failure'); });
  try {
    await admin.post(endpoint).set(H).send({ user, password }).expect(500);
    expect(db.findUserIdByEmail(user.email)).toBeFalsy();
    expect(db.getCredentialsByEmail(user.email)).toBeFalsy();
  } finally {
    interrupted.mockRestore();
  }
  const { body } = await admin.post(endpoint).set(H).send({ user, password }).expect(201);
  expect(body.row.d.email).toBe(user.email);
  expect(JSON.stringify(body)).not.toContain(password);
  const accounts = (await admin.get('/api/v1/data').expect(200)).body.collections.users;
  expect(accounts.filter((row: any) => row.d.email === user.email)).toHaveLength(1);
  await admin.post(endpoint).set(H).send({ user, password: 'OtherPassword2026' }).expect(409);
  const member = await loginAgent(app, user.email, password);
  expect((await member.get('/api/v1/auth/me').expect(200)).body).toMatchObject({ user: { id: body.row.id }, mustChangePassword: true });
});

it('requires replacement of a temporary password created through browser setup', async () => {
  server = await createTestServer({ SEED_DEMO_DATA: 'false', INSTALL_SETUP_TOKEN: INSTALL_TOKEN });
  const data = { fullName: 'مسؤول المؤسسة', email: 'first@example.com', password: 'TemporaryOwner2026' };
  await request(server.app).post(setupAdministrator).set(H).send({ ...data, token: INSTALL_TOKEN, temporaryPassword: true }).expect(201);
  const owner = await loginAgent(server.app, data.email, data.password);
  expect((await owner.get('/api/v1/auth/me').expect(200)).body.mustChangePassword).toBe(true);
  await owner.get('/api/v1/data').expect(403);
  await owner.post('/api/v1/auth/change-password').set(H).send({ currentPassword: data.password, newPassword: 'PrivateOwner2026' }).expect(200);
  await owner.get('/api/v1/data').expect(200);
  await request(server.app).post('/api/v1/auth/login').set(H).send(data).expect(401);
});

it('offers setup on a clean install after the bootstrap password change and remembers a displayed review across restarts', async () => {
  server = await createTestServer({ SEED_DEMO_DATA: 'false', ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: 'InitialPass2026' });
  const client = request(server.app);
  const status = await client.get(setupStatus).expect(200);
  expect(status.body.data).toEqual({ mode: 'sign-in' });
  await client.post(setupAdministrator).set(H).send({ token: INSTALL_TOKEN }).expect(409);
  await seedDatabase(server.db, { ...server.config, installSetupToken: INSTALL_TOKEN });
  expect(server.db.countCredentials()).toBe(1);
  const owner = await loginAgent(server.app, 'owner@example.com', 'InitialPass2026');
  const session = (await owner.get('/api/v1/auth/me')).body;
  expect(session.mustChangePassword).toBe(true);
  expect(session.setupReviewId).toEqual(expect.any(String));
  await owner.post('/api/v1/auth/change-password').set(H).send({ currentPassword: 'InitialPass2026', newPassword: 'NewOwnerPass2026' }).expect(200);
  await owner.post('/api/v1/admin/setup/review-shown').set(H).send({ id: session.setupReviewId }).expect(200);
  await seedDatabase(server.db, server.config);
  expect((await owner.get('/api/v1/auth/me')).body.setupReviewId).toBeUndefined();
  expect((await client.get(setupStatus)).body.data).toEqual({ mode: null });
  expect((await client.get('/api/v1/auth/demo-accounts')).body.data).toEqual({ accounts: [] });
});

it('keeps real administrators and settings after cleanup, ignores stale acknowledgements, and never prompts ordinary staff', async () => {
  server = await createTestServer();
  const { app, db } = server;
  const client = request(app);
  expect((await client.get(setupStatus).expect(200)).body.data).toEqual({ mode: 'demo' });
  expect((await client.get('/api/v1/auth/demo-accounts')).body.data.password).toBe(DEMO_PASSWORD);
  const admin = await loginAgent(app, 'admin@akhbar.tv');
  const staff = await loginAgent(app, 'journalist@akhbar.tv');
  await staff.post('/api/v1/auth/change-password').set(H).send({ currentPassword: DEMO_PASSWORD, newPassword: 'PrivateStaff2026' }).expect(200);
  const available = (await client.get('/api/v1/auth/demo-accounts').expect(200)).body.data;
  expect(available.accounts).toContainEqual(expect.objectContaining({ email: 'admin@akhbar.tv' }));
  expect(available.accounts).not.toContainEqual(expect.objectContaining({ email: 'journalist@akhbar.tv' }));
  const begin = (await admin.get('/api/v1/auth/me')).body.setupReviewId;
  expect(begin).toEqual(expect.any(String));
  expect((await staff.get('/api/v1/auth/me')).body.setupReviewId).toBeUndefined();
  await staff.post('/api/v1/admin/setup/review-shown').set(H).send({ id: begin }).expect(403);
  const account = { fullName: 'مسؤول المؤسسة', email: 'owner@example.com', password: 'TempOwner2026', role: 'SUPER_ADMIN' };
  await staff.post('/api/v1/admin/setup/administrator').set(H).send(account).expect(403);
  await admin.post('/api/v1/admin/setup/administrator').set(H).send({ ...account, password: 'short' }).expect(400);
  expect(db.findUserIdByEmail(account.email)).toBeNull();
  await admin.post('/api/v1/admin/setup/administrator').set(H).send(account).expect(201);
  await admin.post('/api/v1/admin/setup/administrator').set(H).send(account).expect(409);
  const owner = await loginAgent(app, account.email, account.password);
  expect((await owner.get('/api/v1/auth/me')).body.mustChangePassword).toBe(true);
  await owner.post('/api/v1/auth/change-password').set(H).send({ currentPassword: account.password, newPassword: 'PrivateOwner2026' }).expect(200);
  const settings = db.getRow('settings', 'singleton')!;
  const original = { ...settings.d, organizationName: 'مؤسسة الفريق', setup: { confirmed: ['organization'], completedAt: new Date().toISOString() } };
  db.writeRow('settings', settings.id, original, settings.p, null);
  const cleanup = await owner.post('/api/v1/admin/demo-data/remove').set(H).send({ confirm: 'حذف', includeUsers: true }).expect(200);
  const next = cleanup.body.data.setupReviewId;
  expect(next).toEqual(expect.any(String));
  expect(next).not.toBe(begin);
  expect(db.getRow('settings', 'singleton')?.d).toEqual(original);
  expect(db.getCredentialsByEmail('admin@akhbar.tv')).toBeNull();
  expect((await client.get(setupStatus)).body.data).toEqual({ mode: null });
  expect((await client.get('/api/v1/auth/demo-accounts')).body.data).toEqual({ accounts: [] });
  await owner.post('/api/v1/admin/setup/review-shown').set(H).send({ id: begin }).expect(200);
  expect((await owner.get('/api/v1/auth/me')).body.setupReviewId).toBe(next);
  await owner.post('/api/v1/admin/setup/review-shown').set(H).send({ id: next }).expect(200);
  const noop = await owner.post('/api/v1/admin/demo-data/remove').set(H).send({ confirm: 'حذف', includeUsers: true }).expect(200);
  expect(noop.body.data).toEqual({ total: 0, removed: {} });
  await seedDatabase(db, server.config);
  const returning = await loginAgent(app, account.email, 'PrivateOwner2026');
  expect((await returning.get('/api/v1/auth/me')).body.setupReviewId).toBeUndefined();
});
