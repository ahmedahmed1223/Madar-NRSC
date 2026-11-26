import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';
import { seedDatabase } from '../../src/server/seed';
import { rosterEntryId } from '../../src/shared/roster';
import { departmentsOf, type Department } from '../../src/shared/departments';

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

it('persists parallel desks and routes a new card only to the selected station and department id', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const row = () => server.db.getRow('settings', 'singleton')!;
  const write = async (departments: Department[]) => {
    const current = row();
    return (await sync(admin, [{ c: 'settings', id: 'singleton', op: 'upsert', baseV: current.v, d: { ...current.d, departments } }])).body.results[0];
  };
  const departments = [
    ...departmentsOf(row().d),
    { id: 'desk-hq', name: 'التنسيق', stationIds: ['gaza'], headUserId: 'usr-2' },
    { id: 'desk-branch', name: 'التنسيق', stationIds: ['beirut'], headUserId: 'usr-3' },
  ];
  expect(await write(departments)).toMatchObject({ ok: true });
  const card = async (id: string, stationId: string) => (await sync(admin, [{
    c: 'productionCards', id, op: 'upsert', d: { id, title: 'مهمة التنسيق', kind: 'REPORT', log: [], status: 'OPEN', priority: 'NORMAL',
      steps: [{ id: 'step', type: 'edit', status: 'TODO', complexity: 1, departmentId: 'desk-branch', stationId }] },
  }])).body.results[0];
  expect(await card('wrong-station', 'gaza')).toMatchObject({ ok: false });
  expect(await card('branch-card', 'beirut')).toMatchObject({ ok: true });
  expect(server.db.getRow('productionCards', 'branch-card')!.d.steps[0].departmentId).toBe('desk-branch');
  expect(await write(departments.filter(d => d.id !== 'desk-branch'))).toMatchObject({ ok: false });
  expect(await write(departments.map(d => d.id === 'desk-branch' ? { ...d, archived: true } : d))).toMatchObject({ ok: true });
});

it('reassigns a removed station without turning its local department into a global department', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const row = server.db.getRow('settings', 'singleton')!;
  const desks = [
    { id: 'east', stationIds: ['beirut'], name: 'المكتب المحلي' },
    { id: 'west', stationIds: ['gaza'], name: 'المكتب المحلي' },
  ];
  const current = { ...row.d, departments: [...departmentsOf(row.d), ...desks] };
  server.db.writeRow('settings', row.id, current, row.p, null);
  const remove = (replacementId: string) => admin.post('/api/v1/admin/stations/beirut/remove').set(H).send({ replacementId });
  await remove('gaza').expect(409);
  expect(server.db.getRow('settings', row.id)!.d.departments).toEqual(current.departments);
  await remove('istanbul').expect(200);
  expect(server.db.getRow('settings', row.id)!.d.departments.find((d: Department) => d.id === 'east').stationIds).toEqual(['istanbul']);
});
