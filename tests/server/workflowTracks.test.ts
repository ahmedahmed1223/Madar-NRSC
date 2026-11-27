import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { hasWorkflowDelegation, mayManageWorkflowTrack, mayReadWorkflowTrack, workflowTrackOf } from '../../src/shared/workflowTracks';

let server: Awaited<ReturnType<typeof createTestServer>>;
beforeAll(async () => { server = await createTestServer(); });
afterAll(() => server.close());

describe('workflow tracks', () => {
  it('resolves the content track and keeps independent roles on an account', () => {
    expect(workflowTrackOf('INTERVIEW', 'episode')).toBe('programmes');
    expect(workflowTrackOf('PROGRAM', 'bulletin')).toBe('news');
    expect(workflowTrackOf('PROGRAM')).toBe('programmes');
    const dual = { role: 'EDITOR', isActive: true, workflowRoles: { news: 'MANAGER', programmes: 'PREPARER' } } as const;
    expect(mayManageWorkflowTrack(dual, 'news')).toBe(true);
    expect(mayManageWorkflowTrack(dual, 'programmes', true)).toBe(false);
    expect(mayReadWorkflowTrack(dual, 'programmes')).toBe(true);
    for (const track of ['news', 'programmes'] as const) {
      const otherTrack = track === 'news' ? 'programmes' : 'news';
      const scoped = { role: 'EDITOR', isActive: true, workflowRoles: { [track]: 'PREPARER' } } as const;
      expect(mayReadWorkflowTrack(scoped, track)).toBe(true);
      expect(mayReadWorkflowTrack(scoped, otherTrack)).toBe(false);
      expect(mayManageWorkflowTrack({ role: 'GENERAL_MANAGER', isActive: true }, track)).toBe(true);
    }
    const legacy = { role: 'EDITOR', isActive: true } as const;
    expect(mayReadWorkflowTrack(legacy, 'news')).toBe(true);
    expect(mayManageWorkflowTrack(legacy, 'programmes', true)).toBe(true);
  });

  it('stops a temporary grant at expiry and checks each action separately', () => {
    const expiresAt = '2026-11-27T15:00:00.000Z';
    const user = {
      role: 'JOURNALIST',
      isActive: true,
      workflowRoles: {},
      workflowDelegations: { news: { expiresAt, permissions: ['skipOptionalSteps' as const] } },
    } as const;
    const before = new Date('2026-11-27T14:59:59.999Z');
    expect(hasWorkflowDelegation(user, 'news', 'skipOptionalSteps', before)).toBe(true);
    expect(hasWorkflowDelegation(user, 'news', 'manageAssignments', before)).toBe(false);
    expect(hasWorkflowDelegation(user, 'programmes', 'skipOptionalSteps', before)).toBe(false);
    expect(mayManageWorkflowTrack(user, 'news')).toBe(false);
    expect(mayReadWorkflowTrack(user, 'news', before)).toBe(true);
    expect(hasWorkflowDelegation(user, 'news', 'skipOptionalSteps', new Date(expiresAt))).toBe(false);
    expect(mayReadWorkflowTrack(user, 'news', new Date(expiresAt))).toBe(false);
  });

  it('allows role managers to set account grants and denies self-escalation', async () => {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const update = async (agent: typeof admin, patch: Record<string, unknown>) => {
      const stored = server.db.getRow('users', 'usr-2')!;
      const response = await agent.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({
        ops: [{ c: 'users', op: 'upsert', id: stored.id, baseV: stored.v, d: { ...stored.d, ...patch } }],
      });
      return response.body.results[0];
    };
    const scope = {
      workflowRoles: { news: 'MANAGER', programmes: 'PREPARER' },
      workflowDelegations: { programmes: { expiresAt: new Date(Date.now() + 60_000).toISOString(), permissions: ['manageAssignments'] } },
    };
    expect(await update(editor, scope)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await update(admin, { workflowRoles: { programmes: 'SUPER_ADMIN' } })).toMatchObject({ ok: false });
    expect(await update(admin, scope)).toMatchObject({ ok: true });
    expect((await editor.get('/api/v1/auth/me')).body.user).toMatchObject(scope);
    expect(server.db.listCollection('auditLogs').map(row => row.d)).toContainEqual(expect.objectContaining({
      actionType: 'WORKFLOW_ACCESS_CHANGE', targetId: 'usr-2', userId: 'usr-1',
      details: expect.stringContaining('مدير إعداد الأخبار'),
    }));
    expect(await update(editor, { fullNameEn: 'Sara', workflowRoles: undefined, workflowDelegations: undefined })).toMatchObject({ ok: true });
    expect(server.db.getRow('users', 'usr-2')!.d).toMatchObject(scope);
    expect(await update(editor, { workflowRoles: null })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await update(editor, { workflowDelegations: {} })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await update(admin, { workflowRoles: null, workflowDelegations: {} })).toMatchObject({ ok: true });
  });
});
