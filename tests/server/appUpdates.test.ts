import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { createAppUpdates } from '../../src/server/appUpdates';
import { isNewerVersion } from '../../src/shared/appUpdates';

const release = () => Response.json({ tag_name: 'v9.10.0', draft: false, prerelease: false });
afterEach(() => vi.unstubAllGlobals());

it('checks releases and admits only a manager requesting the exact newer version off air', async () => {
  const upstream = vi.fn<typeof fetch>().mockImplementation(async (_url, options) =>
    options?.method === 'POST' ? new Response(null, { status: 204 }) : release());
  vi.stubGlobal('fetch', upstream);
  const server = await createTestServer({ UPDATE_MODE: 'github', UPDATE_GITHUB_TOKEN: 'test-token', UPDATE_GITHUB_WORKFLOW: 'deploy.yml' });
  const headers = { 'X-NRCS-Client': 'web' };
  try {
    expect((await request(server.app).get('/api/v1/updates')).status).toBe(401);
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const status = await journalist.get('/api/v1/updates');
    expect(status.body.data).toMatchObject({ latest: { version: '9.10.0' }, deployment: null, broadcastActive: false });
    expect(JSON.stringify(status.body)).not.toContain('test-token');
    expect((await journalist.post('/api/v1/updates/deploy').set(headers).send({ version: '9.10.0', localAirEnded: true })).status).toBe(403);
    const deploy = (version: string, localAirEnded = true) => admin.post('/api/v1/updates/deploy').set(headers).send({ version, localAirEnded });
    expect((await deploy('9.10.0', false)).status).toBe(400);
    expect((await deploy('9.9.0')).status).toBe(409);
    server.db.writeRow('onAir', 'update-test-broadcast', { status: 'LIVE' }, 0, null);
    expect((await deploy('9.10.0')).body.code).toBe('AIR_ACTIVE');
    server.db.writeRow('onAir', 'update-test-broadcast', { status: 'ENDED' }, 0, null);
    expect((await deploy('9.10.0')).status).toBe(202);
    expect((await deploy('9.10.0')).status).toBe(409);
    const calls = upstream.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatch(/\/actions\/workflows\/deploy\.yml\/dispatches$/);
    expect(JSON.parse(calls[0][1]!.body as string)).toEqual({ ref: 'main', inputs: { version: 'v9.10.0' } });
    expect((await admin.get('/api/v1/updates')).body.data.requestedVersion).toBe('9.10.0');
  } finally { server.close(); }
});

it('coalesces release calls, ignores prereleases and signs an HTTPS deployment request', async () => {
  const upstream = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ tag_name: 'v9.10.0-rc.1', draft: false, prerelease: true }))
    .mockResolvedValueOnce(new Response(null, { status: 202 }));
  vi.stubGlobal('fetch', upstream);
  const secret = 'development-test-secret-with-length';
  const service = createAppUpdates({ mode: 'webhook', webhookSecret: secret, webhookUrl: 'https://deploy.example.test/compose' });
  expect(await Promise.all([service.latest(), service.latest()])).toEqual([null, null]);
  expect(upstream).toHaveBeenCalledTimes(1);
  expect(await service.dispatch('9.10.0')).toBe('accepted');
  const [target, options] = upstream.mock.calls[1];
  expect(String(target)).toBe('https://deploy.example.test/compose');
  const headers = new Headers(options!.headers);
  const signature = createHmac('sha256', secret).update(`${headers.get('X-Madar-Timestamp')}.${options!.body}`).digest('hex');
  expect(headers.get('X-Madar-Signature')).toBe(`sha256=${signature}`);
  expect(headers.get('Idempotency-Key')).toBe('madar-release:v9.10.0');
  expect(options?.redirect).toBe('error');
  expect(createAppUpdates({ mode: 'webhook', webhookSecret: secret, webhookUrl: 'http://deploy.example.test' }).deployment).toBeNull();
  expect(isNewerVersion('4.10.0', '4.9.3')).toBe(true);
  expect(isNewerVersion('4.1.2-rc.1', '4.1.1')).toBe(false);
});
