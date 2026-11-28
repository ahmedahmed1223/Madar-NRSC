import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestServer, DEMO_PASSWORD, loginAgent } from '../helpers';
import type { Department } from '../../src/shared/departments';

let server: Awaited<ReturnType<typeof createTestServer>>;
beforeEach(async () => { server = await createTestServer(); });
afterEach(() => server.close());

it('shares only the configured department team’s work summaries and revokes them when the head changes', async () => {
  const { db, app } = server;
  const people = db.listCollection('users');
  const lead = people.find(row => row.d.email === 'journalist@akhbar.tv')!;
  const childLead = people.find(row => row.d.email === 'editor@akhbar.tv')!;
  const driver = people.find(row => row.d.email === 'reporter@akhbar.tv')!;
  const outside = people.find(row => row.d.email === 'producer@akhbar.tv')!;
  const stationId = 'gaza';
  const parent: Department = { id: 'operations', name: 'الخدمات', headUserId: lead.id, stationIds: [stationId] };
  const departments = [parent,
    { id: 'transport', name: 'النقل', parentId: parent.id },
    { id: 'studio', name: 'الاستديو', parentId: parent.id, headUserId: childLead.id },
  ];
  const settings = db.getRow('settings', 'singleton')!;
  db.writeRow('settings', settings.id, { ...settings.d, departments }, settings.p, null);
  db.writeRow('users', driver.id, { ...driver.d, role: 'SUPPORT_SERVICES', departmentId: 'transport', stationId }, driver.p, null);
  db.writeRow('users', outside.id, { ...outside.d, departmentId: 'studio', stationId }, outside.p, null);
  const task = { title: 'نقل الفريق', status: 'TODO', priority: 'NORMAL', assignedToId: driver.id };
  db.writeRow('tasks', 'transport-task', task, 0, null);
  db.writeRow('tasks', 'studio-task', { ...task, title: 'عمل الاستديو', assignedToId: outside.id }, 1, null);
  const step = { type: 'editing', title: 'استلام الفريق', status: 'BLOCKED', blockedReason: 'المركبة لم تصل', complexity: 1 };
  db.writeRow('productionCards', 'team-card', { title: 'نقل لتصوير الحلقة', kind: 'OTHER', status: 'OPEN', priority: 'NORMAL',
    ownerId: outside.id, brief: 'محتوى داخلي غير لازم للمتابعة', steps: [
      { ...step, id: 'transport-step', assigneeId: driver.id },
      { ...step, id: 'studio-step', title: 'عمل داخلي للاستديو', assigneeId: outside.id },
    ] }, 0, null);

  const head = await loginAgent(app, lead.d.email, DEMO_PASSWORD);
  const worker = await loginAgent(app, driver.d.email, DEMO_PASSWORD);
  const child = await loginAgent(app, childLead.d.email, DEMO_PASSWORD);
  const writeTask = async (id: string, patch: object) => {
    const current = db.getRow('tasks', id)!;
    return (await head.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [{ c: 'tasks', id, op: 'upsert', baseV: current.v, d: { ...current.d, ...patch } }] })).body.results[0];
  };
  expect((await head.get('/api/v1/data')).body.collections.tasks.some((row: { id: string }) => row.id === 'studio-task')).toBe(false);
  expect((await writeTask('studio-task', { status: 'IN_PROGRESS' })).ok).toBe(false);
  expect((await writeTask('transport-task', { assigneeId: outside.id })).ok).toBe(false);
  expect((await writeTask('transport-task', { status: 'IN_PROGRESS' })).ok).toBe(true);
  expect((await writeTask('transport-task', { dueDate: '2030-11-21T10:00:00.000Z' })).ok).toBe(true);
  expect(db.listCollection('notifications').some(row => row.d.userId === driver.id && row.d.linkUrl === '/tasks/transport-task')).toBe(true);
  const data = await head.get('/api/v1/work/department').expect(200);
  expect(data.headers['cache-control']).toBe('no-store');
  expect(data.body.data.members.map(({ id }: { id: string }) => id)).toEqual([driver.id]);
  expect(data.body.data.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ entityId: 'transport-task', kind: 'task', assigneeId: driver.id }),
    expect.objectContaining({ entityId: 'team-card', kind: 'step', blockedReason: 'المركبة لم تصل', assigneeId: driver.id }),
  ]));
  expect(new Set(data.body.data.items.map(({ assigneeId }: { assigneeId: string }) => assigneeId))).toEqual(new Set([driver.id]));
  expect(JSON.stringify(data.body.data)).not.toMatch(/عمل داخلي للاستديو|محتوى داخلي غير لازم/);

  const removeTask = async (agent: typeof head, id: string) => {
    const current = db.getRow('tasks', id)!;
    const result = await agent.post('/api/v1/data/sync').set('X-NRCS-Client', 'web')
      .send({ ops: [{ c: 'tasks', id, op: 'delete', baseV: current.v }] }).expect(200);
    expect(result.body.results[0]).toMatchObject({ ok: true, row: { id, deleted: true } });
    return result.body.results[0].row.v;
  };
  const restoreTask = (agent: typeof head, id: string, baseV: number) => agent
    .post('/api/v1/trash/tasks/' + id + '/restore').set('X-NRCS-Client', 'web').send({ baseV });
  const transportVersion = await removeTask(head, 'transport-task');
  const studioVersion = await removeTask(child, 'studio-task');
  const trashIds = async (agent: typeof head) => {
    const response = await agent.get('/api/v1/trash?section=tasks').expect(200);
    return response.body.data.items.map((item: { id: string }) => item.id);
  };
  expect(await trashIds(head)).toEqual(['transport-task']);
  expect(await trashIds(child)).toEqual(['studio-task']);
  expect(await trashIds(worker)).toEqual([]);
  await restoreTask(head, 'studio-task', studioVersion).expect(404);
  await restoreTask(child, 'transport-task', transportVersion).expect(404);
  await restoreTask(head, 'transport-task', transportVersion).expect(200);
  await restoreTask(child, 'studio-task', studioVersion).expect(200);

  const childData = await child.get('/api/v1/work/department').expect(200);
  expect(childData.body.data.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ entityId: 'studio-task', assigneeId: outside.id }),
    expect.objectContaining({ entityId: 'team-card', detail: 'عمل داخلي للاستديو', assigneeId: outside.id }),
  ]));
  expect(childData.body.data.items.some(({ assigneeId }: { assigneeId: string }) => assigneeId === driver.id)).toBe(false);
  await worker.get('/api/v1/work/department').expect(403);

  db.writeRow('users', driver.id, { ...driver.d, role: 'SUPPORT_SERVICES', departmentId: 'transport', stationId: 'istanbul' }, driver.p, null);
  expect((await head.get('/api/v1/work/department')).body.data.items).toEqual([]);
  db.writeRow('settings', settings.id, { ...settings.d, departments: [{ ...parent, headUserId: childLead.id }, ...departments.slice(1)] }, settings.p, null);
  await head.get('/api/v1/work/department').expect(403);
});
