import { expect, it, vi } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';

it('requires a fresh workspace snapshot after a track role is revoked or its delegation expires', async () => {
  const server = await createTestServer();
  try {
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const { id } = (await editor.get('/api/v1/auth/me')).body.user;
    const user = server.db.getRow('users', id)!;
    const snapshot = async () => (await editor.get('/api/v1/data')).body;
    const changes = async (before: { rev: number; access: string }) => (await editor.get(`/api/v1/data/changes?since=${before.rev}&access=${before.access}`)).body;
    server.db.writeRow('users', id, { ...user.d, workflowRoles: { news: 'MANAGER', programmes: 'PREPARER' } }, user.p, null);
    const both = await snapshot();
    server.db.writeRow('users', id, { ...user.d, workflowRoles: { news: 'MANAGER' } }, user.p, null);
    expect((await changes(both)).reset).toBe(true);
    const now = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    server.db.writeRow('users', id, { ...user.d, workflowRoles: { news: 'MANAGER' }, workflowDelegations: {
      programmes: { permissions: ['manageAssignments'], expiresAt: new Date(now + 60_000).toISOString() },
    } }, user.p, null);
    const temporary = await snapshot();
    expect((await changes(temporary)).reset).toBe(false);
    vi.setSystemTime(now + 61_000);
    expect((await changes(temporary)).reset).toBe(true);
  } finally {
    vi.useRealTimers();
    server.close();
  }
});
