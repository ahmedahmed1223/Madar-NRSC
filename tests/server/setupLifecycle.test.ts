import { afterEach, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { seedDatabase } from '../../src/server/seed';

const H = { 'X-NRCS-Client': 'web' };
let server: Awaited<ReturnType<typeof createTestServer>> | undefined;
afterEach(() => { server?.close(); server = undefined; });

it('offers setup on a clean install after the bootstrap password change and remembers a displayed review across restarts', async () => {
  server = await createTestServer({ SEED_DEMO_DATA: 'false', ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: 'InitialPass2026' });
  const owner = await loginAgent(server.app, 'owner@example.com', 'InitialPass2026');
  const session = (await owner.get('/api/v1/auth/me')).body;
  expect(session.mustChangePassword).toBe(true);
  expect(session.setupReviewId).toEqual(expect.any(String));
  await owner.post('/api/v1/auth/change-password').set(H).send({ currentPassword: 'InitialPass2026', newPassword: 'NewOwnerPass2026' }).expect(200);
  await owner.post('/api/v1/admin/setup/review-shown').set(H).send({ id: session.setupReviewId }).expect(200);
  await seedDatabase(server.db, server.config);
  expect((await owner.get('/api/v1/auth/me')).body.setupReviewId).toBeUndefined();
});

it('keeps real administrators and settings after cleanup, ignores stale acknowledgements, and never prompts ordinary staff', async () => {
  server = await createTestServer();
  const { app, db } = server;
  const admin = await loginAgent(app, 'admin@akhbar.tv');
  const staff = await loginAgent(app, 'journalist@akhbar.tv');
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
  await owner.post('/api/v1/admin/setup/review-shown').set(H).send({ id: begin }).expect(200);
  expect((await owner.get('/api/v1/auth/me')).body.setupReviewId).toBe(next);
  await owner.post('/api/v1/admin/setup/review-shown').set(H).send({ id: next }).expect(200);
  const noop = await owner.post('/api/v1/admin/demo-data/remove').set(H).send({ confirm: 'حذف', includeUsers: true }).expect(200);
  expect(noop.body.data).toEqual({ total: 0, removed: {} });
  await seedDatabase(db, server.config);
  const returning = await loginAgent(app, account.email, 'PrivateOwner2026');
  expect((await returning.get('/api/v1/auth/me')).body.setupReviewId).toBeUndefined();
});
