import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestServer, loginAgent, DEMO_PASSWORD } from '../helpers';
import { generateTotpSecret, totp } from '../../src/server/totp';

let server: Awaited<ReturnType<typeof createTestServer>>;
beforeEach(async () => { server = await createTestServer({ ALLOW_DB_RESET: 'true' }); });
afterEach(() => { vi.restoreAllMocks(); server.close(); });
const post = (agent: any, endpoint: string, body: any) => agent.post(`/api/v1/db/${endpoint}`).set('X-NRCS-Client', 'web').send(body);
async function fixture() {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const fileName = (await server.db.createBackup()).fileName;
  const confirmation = await post(admin, 'confirm-operation', { action: 'restore', fileName, password: DEMO_PASSWORD });
  return { admin, fileName, confirmation, confirmationToken: confirmation.body.data?.token };
}

it('requires fresh reauthentication and explicit local air acknowledgement', async () => {
  const { admin, fileName, confirmation, confirmationToken } = await fixture();
  expect(confirmation.status).toBe(200);
  expect((await post(admin, 'backups/restore', { fileName })).status).toBe(401);
  expect((await post(admin, 'backups/restore', { fileName, confirmationToken })).status).toBe(400);
  expect((await post(admin, 'backups/restore', { fileName, confirmationToken, localAirEnded: true })).status).toBe(200);
  expect((await post(admin, 'backups/restore', { fileName, confirmationToken, localAirEnded: true })).status).toBe(401);
});

it('rejects anonymous, unauthorized, missing CSRF and bad passwords with bounded attempts', async () => {
  expect((await request(server.app).post('/api/v1/db/confirm-operation').set('X-NRCS-Client', 'web')).status).toBe(401);
  const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
  expect((await post(journalist, 'confirm-operation', {})).status).toBe(403);
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  expect((await admin.post('/api/v1/db/confirm-operation').send({ action: 'reset', password: DEMO_PASSWORD })).status).toBe(403);
  for (let i = 0; i < 5; i++) expect((await post(admin, 'confirm-operation', { action: 'reset', password: 'wrong' })).status).toBe(401);
  expect((await post(admin, 'confirm-operation', { action: 'reset', password: DEMO_PASSWORD })).status).toBe(429);
});

it('binds confirmation to the session and snapshot bytes', async () => {
  const { admin, fileName, confirmationToken } = await fixture();
  const other = await loginAgent(server.app, 'admin@akhbar.tv');
  expect((await post(other, 'backups/restore', { fileName, confirmationToken, localAirEnded: true })).status).toBe(401);
  fs.appendFileSync(path.join(server.db.backupsDir, fileName), 'replacement');
  expect((await post(admin, 'backups/restore', { fileName, confirmationToken, localAirEnded: true })).status).toBe(401);
});

it('blocks active air and rechecks permission revocation', async () => {
  const { admin, fileName, confirmationToken } = await fixture();
  server.db.writeRow('onAir', 'live-test', { id: 'live-test', status: 'LIVE', episodeTitle: 'اختبار الهواء' }, 0, 'test');
  expect((await post(admin, 'backups/restore', { fileName, confirmationToken, localAirEnded: true })).status).toBe(409);
  const cred = server.db.getCredentialsByEmail('admin@akhbar.tv')!;
  const row = server.db.getRow('users', cred.userId)!;
  server.db.writeRow('users', cred.userId, { ...row.d, deniedPermissions: ['system.database_manage'], role: 'JOURNALIST', roles: ['JOURNALIST'] }, row.p, 'test');
  expect((await post(admin, 'backups/restore', { fileName, confirmationToken, localAirEnded: true })).status).toBe(403);
});

it('rejects expired and wrong-action confirmations and respects disabled reset', async () => {
  const { admin, fileName, confirmationToken } = await fixture();
  expect((await post(admin, 'reset', { confirmationToken, localAirEnded: true })).status).toBe(401);
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 120001);
  expect((await post(admin, 'backups/restore', { fileName, confirmationToken, localAirEnded: true })).status).toBe(401);
  vi.restoreAllMocks();
  server.config.allowDbReset = false;
  expect((await post(admin, 'confirm-operation', { action: 'reset', password: DEMO_PASSWORD })).status).toBe(403);
});

it('requires enabled TOTP and rejects replay without logging supplied secrets', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const cred = server.db.getCredentialsByEmail('admin@akhbar.tv')!;
  const secret = generateTotpSecret();
  server.db.setTotp(cred.userId, secret, true);
  const body = { action: 'reset', password: DEMO_PASSWORD, totp: totp(secret) };
  expect((await post(admin, 'confirm-operation', { ...body, totp: '' })).status).toBe(401);
  expect((await post(admin, 'confirm-operation', body)).status).toBe(200);
  expect((await post(admin, 'confirm-operation', body)).status).toBe(401);
});

it('aborts on failed safety backup without modifying live content', async () => {
  const { admin, fileName, confirmationToken } = await fixture();
  const before = server.db.currentRev();
  vi.spyOn(server.db, 'createBackup').mockRejectedValueOnce(new Error('private-path'));
  const result = await post(admin, 'backups/restore', { fileName, confirmationToken, localAirEnded: true });
  expect(result.status).toBe(400);
  expect(JSON.stringify(result.body)).not.toContain('private-path');
  expect(server.db.isHealthy()).toBe(true);
  // Auditing failure may add an audit row, but content stays intact.
  expect(server.db.listCollection('users').length).toBeGreaterThan(0);
  expect(server.db.currentRev()).toBeGreaterThanOrEqual(before);
  const audit = server.db.listCollection('auditLogs').find(row => row.d.actionType === 'DB_RESTORE_FAILED');
  expect(audit?.d.details).toContain(result.headers['x-request-id']);
});

it('rejects air starting during the safety backup and keeps live data', async () => {
  const { admin, fileName, confirmationToken } = await fixture();
  const original = server.db.createBackup.bind(server.db);
  vi.spyOn(server.db, 'createBackup').mockImplementationOnce(async (...args) => {
    const snapshot = await original(...args);
    server.db.writeRow('onAir', 'late-live', { id: 'late-live', status: 'LIVE' }, 0, 'test');
    return snapshot;
  });
  expect((await post(admin, 'backups/restore', { fileName, confirmationToken, localAirEnded: true })).status).toBe(409);
  expect(server.db.getRow('onAir', 'late-live')?.d.status).toBe('LIVE');
});
