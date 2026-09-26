import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';
import { seedDatabase } from '../../src/server/seed';
import { rosterEntryId } from '../../src/shared/roster';

let server: Awaited<ReturnType<typeof createTestServer>>;
const H = { 'X-NRCS-Client': 'web' };
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(() => server.close());

const sync = (agent: request.Agent, ops: any[]) => agent.post('/api/v1/data/sync').set(H).send({ ops });
const rosterOp = (userId: string, extra: Record<string, any> = {}) => {
  const base = { date: '2026-10-03', departmentId: 'control', shift: 'EVENING', userId, ...extra };
  const id = rosterEntryId(base as any);
  return { c: 'roster', op: 'upsert', id, d: { ...base, id, userName: 'اسم مزور' } };
};

describe('duty roster on the server', () => {
  it('only roster managers can assign shifts, and names come from the server', async () => {
    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const denied = await sync(journalist, [rosterOp('usr-3')]);
    expect(denied.body.results[0].code).toBe('FORBIDDEN');

    const ok = await sync(editor, [rosterOp('usr-3')]);
    expect(ok.body.results[0].ok).toBe(true);
    const row = server.db.getRow('roster', ok.body.results[0].row.id)!;
    expect(row.d.userName).not.toBe('اسم مزور');
    expect(row.d.createdBy).toBe('usr-2');

    const badDept = await sync(editor, [rosterOp('usr-3', { departmentId: 'marketing' })]);
    expect(badDept.body.results[0].ok).toBe(false);
    const ghost = await sync(editor, [rosterOp('usr-nobody')]);
    expect(ghost.body.results[0].ok).toBe(false);
  });
});

describe('departments migration', () => {
  it('converts legacy users and retires evaluations', async () => {
    const { db } = server;
    const u = db.getRow('users', 'usr-5')!;
    db.writeRow('users', 'usr-5', { ...u.d, departmentId: undefined, department: 'المذيعين والتقديم', securityClearance: 'TOP_SECRET', shift: 'EVENING', customPermissions: ['episodes.evaluate'] }, u.p, null);
    db.writeRow('guests', 'gst-old', { id: 'gst-old', fullName: 'ضيف قديم', rating: 4 }, 0, null);
    (db as any).db.prepare(`INSERT INTO entities (collection, id, data, position, version, rev, deleted, created_at, updated_at) VALUES ('programEvaluations', 'eval-x', '{}', 0, 1, 0, 0, '', '')`).run();
    const role = db.listCollection('roles').find((r) => r.d.roleCode === 'EDITOR')!;
    db.writeRow('roles', role.id, { ...role.d, permissions: [...role.d.permissions.filter((p: string) => p !== 'roster.manage'), 'episodes.evaluate'] }, role.p, null);
    db.setMeta('departments_migration', '0');
    db.setMeta('perm_grant:roster.manage', '0');

    await seedDatabase(db, server.config);

    const user = db.getRow('users', 'usr-5')!.d;
    expect(user.departmentId).toBe('presenters');
    expect(user.department).toBe('المذيعون');
    expect(user.securityClearance).toBeUndefined();
    expect(user.shift).toBeUndefined();
    expect(user.customPermissions).toEqual([]);
    expect(db.getRow('guests', 'gst-old')!.d.rating).toBeUndefined();
    expect((db as any).db.prepare(`SELECT COUNT(*) AS n FROM entities WHERE collection = 'programEvaluations'`).get().n).toBe(0);
    const editorRole = db.getRow('roles', role.id)!.d;
    expect(editorRole.permissions).not.toContain('episodes.evaluate');
    expect(editorRole.permissions).toContain('roster.manage');
  });
});
