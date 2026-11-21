import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppUpdates } from '../../src/server/appUpdates';
import { createFullBackup } from '../../src/server/backupDelivery';
import { createTestServer, loginAgent } from '../helpers';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('persists acceptance and confirms it from the running version after a restart', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
  const metadata = new Map<string, string>();
  const store = { getMeta: (name: string) => metadata.get(name), setMeta: (name: string, value: string) => { metadata.set(name, value); } };
  const config = { mode: 'github', githubToken: 'test-token', workflow: 'deploy.yml' } as const;
  expect(await createAppUpdates(config, store).dispatch('4.2.3', '4.2.2')).toBe('accepted');
  const restarted = createAppUpdates(config, store);
  expect(restarted.tracking('4.2.2')).toEqual({ version: '4.2.3', requestedAt: '2026-11-21T10:00:00.000Z', state: 'accepted' });
  expect(restarted.tracking('4.2.3')?.state).toBe('deployed');
  expect(restarted.requestedVersion('4.2.3')).toBeNull();
  vi.setSystemTime(new Date('2026-11-21T11:00:00Z'));
  expect(restarted.tracking('4.2.2')?.state).toBe('unverified');
  expect(restarted.requestedVersion('4.2.2')).toBeNull();
});

it('gates automated production deployment on a checksum-verified external full backup', async () => {
  const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'madar-deploy-evidence-'));
  const server = await createTestServer({
    NODE_ENV: 'production', ALLOW_DEMO_IN_PRODUCTION: 'true', COOKIE_SECURE: 'false',
    UPDATE_MODE: 'github', UPDATE_GITHUB_TOKEN: 'fake-dispatch-token', UPDATE_GITHUB_WORKFLOW: 'deploy.yml',
    BACKUP_DIRECTORY: destination,
  });
  try {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const fetch = vi.fn(async (url: string) => url.endsWith('/releases/latest')
      ? Response.json({ tag_name: 'v99.0.0', draft: false, prerelease: false }) : new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const headers = { 'X-NRCS-Client': 'web' };
    const update = () => admin.post('/api/v1/updates/deploy').set(headers).send({ version: '99.0.0', localAirEnded: true });
    const preflight = await update();
    expect(preflight.status).toBe(409);
    expect(preflight.body.code).toBe('UPDATE_BACKUP_REQUIRED');
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/dispatches'))).toBe(false);

    await createFullBackup(server.db, server.config);
    expect((await admin.get('/api/v1/updates')).body.data.backupRequired).toBe(false);
    expect((await update()).status).toBe(202);
    expect((await admin.get('/api/v1/updates')).body.data.tracking).toMatchObject({ version: '99.0.0', state: 'accepted' });
  } finally {
    server.close();
    await fs.rm(destination, { recursive: true, force: true });
  }
});
