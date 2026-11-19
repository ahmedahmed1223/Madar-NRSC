import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';
import { jobRuns, recordJob, registerJob, resetJobRuns, trackJob } from '../../src/server/jobs';
import { adminOverview } from '../../src/server/adminOverview';
import { bytesLabel } from '../../src/shared/adminOverview';

let server: Awaited<ReturnType<typeof createTestServer>>;
const H = { 'X-NRCS-Client': 'web' };
let admin: request.Agent; // usr-1, SUPER_ADMIN
let director: request.Agent; // usr-8, ADMIN
let journalist: request.Agent; // usr-3

beforeAll(async () => {
  server = await createTestServer();
  admin = await loginAgent(server.app, 'admin@akhbar.tv');
  director = await loginAgent(server.app, 'director@akhbar.tv');
  journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
});
afterAll(() => server.close());

describe('administrator overview', () => {
  it('is for administrators only', async () => {
    expect((await journalist.get('/api/v1/admin/overview')).status).toBe(403);
    const res = await admin.get('/api/v1/admin/overview');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('reports who is signed in, storage, people and content', async () => {
    // A second device for the journalist.
    await loginAgent(server.app, 'journalist@akhbar.tv');
    const { data } = (await admin.get('/api/v1/admin/overview')).body;
    const row = data.sessions.list.find((s: any) => s.userId === 'usr-3');
    expect(row).toMatchObject({ devices: 2 });
    expect(row.name).toBeTruthy();
    expect(data.sessions.users).toBe(3);
    expect(data.sessions.devices).toBe(4);
    expect(data.sessions.activeNow).toBe(3);
    expect(data.storage.databaseBytes).toBeGreaterThan(0);
    expect(data.storage.uploads).toEqual({ files: 0, bytes: 0 });
    expect(data.people.active).toBeGreaterThanOrEqual(10);
    expect(data.people.withoutStation).toBe(data.people.active);
    expect(data.content.stations).toBe(3);
    expect(data.content).toMatchObject({ openCards: 0, blockedCards: 0, lateCards: 0 });
    // No secrets: sessions are listed without their identifiers.
    expect(JSON.stringify(data)).not.toMatch(/passwordHash|totpSecret|"id":"ses/);
  });

  it('points at what needs attention', async () => {
    const { data } = (await admin.get('/api/v1/admin/overview')).body;
    const texts = data.alerts.map((a: any) => a.text).join(' | ');
    expect(texts).toContain('النسخ الاحتياطي الدوري معطل');
    expect(texts).toContain('بلا تحقق بخطوتين');
    expect(texts).toContain('بلا محطة');
    expect(data.people.privilegedWithout2fa.map((u: any) => u.id)).toContain('usr-1');
  });

  it('counts blocked and late production cards', () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    const card = (id: string, step: Record<string, unknown>) => server.db.writeRow('productionCards', id, { id, title: id, kind: 'NEWS', priority: 'NORMAL', status: 'OPEN', steps: [{ id: 's', type: 'edit', complexity: 1, ...step }] }, 0, null);
    card('c-blocked', { status: 'BLOCKED', blockedReason: 'x' });
    card('c-late', { status: 'TODO', dueAt: past });
    card('c-fine', { status: 'TODO' });
    expect(adminOverview(server.db, server.config).content).toMatchObject({ openCards: 3, blockedCards: 1, lateCards: 1 });
  });
});

describe('ending a colleague\'s sessions', () => {
  it('signs them out of every device and is audited', async () => {
    expect((await journalist.get('/api/v1/auth/me')).status).toBe(200);
    expect((await journalist.post('/api/v1/admin/sessions/revoke').set(H).send({ userId: 'usr-2' })).status).toBe(403);
    expect((await admin.post('/api/v1/admin/sessions/revoke').set(H).send({ userId: 'usr-3' })).status).toBe(200);
    expect((await journalist.get('/api/v1/auth/me')).status).toBe(401);
    const audit = server.db.listCollection('auditLogs').map((r) => r.d).find((a) => a.actionType === 'SESSIONS_REVOKED');
    expect(audit).toMatchObject({ userId: 'usr-1', targetId: 'usr-3', severity: 'SECURITY' });
    expect((await admin.post('/api/v1/admin/sessions/revoke').set(H).send({ userId: 'usr-none' })).status).toBe(404);
  });

  it('protects the system administrator and keeps my own device signed in', async () => {
    expect((await director.post('/api/v1/admin/sessions/revoke').set(H).send({ userId: 'usr-1' })).status).toBe(403);
    const other = await loginAgent(server.app, 'admin@akhbar.tv');
    expect((await admin.post('/api/v1/admin/sessions/revoke').set(H).send({ userId: 'usr-1' })).status).toBe(200);
    expect((await admin.get('/api/v1/auth/me')).status).toBe(200);
    expect((await other.get('/api/v1/auth/me')).status).toBe(401);
  });
});

describe('background jobs', () => {
  it('remember their last run without leaking error details', async () => {
    resetJobRuns();
    registerJob('جلب المصادر', 5);
    expect(jobRuns()).toEqual([{ name: 'جلب المصادر', everyMinutes: 5 }]);
    await trackJob('جلب المصادر', () => 1);
    expect(jobRuns()[0]).toMatchObject({ ok: true, everyMinutes: 5 });
    await expect(trackJob('جلب المصادر', () => Promise.reject(new Error('password=secret')))).rejects.toThrow();
    expect(jobRuns()[0].ok).toBe(false);
    expect(jobRuns()[0].error).not.toContain('secret');
    recordJob('النسخ الاحتياطي');
    expect(adminOverview(server.db, server.config).alerts.some((a) => a.text.includes('جلب المصادر'))).toBe(true);
    resetJobRuns();
  });

  it('formats sizes', () => {
    expect(bytesLabel(0)).toBe('0 ك.ب');
    expect(bytesLabel(5 * 1024 ** 2)).toBe('5.0 م.ب');
    expect(bytesLabel(3 * 1024 ** 3)).toBe('3.0 غ.ب');
  });
});
