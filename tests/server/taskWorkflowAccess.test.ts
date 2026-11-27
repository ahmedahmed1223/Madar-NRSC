import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestServer, DEMO_PASSWORD, loginAgent } from '../helpers';
import { stepTypesOf } from '../../src/shared/productionCards';

type Agent = Awaited<ReturnType<typeof loginAgent>>;
const send = async (agent: Agent, c: string, id: string, d: object, baseV?: number) =>
  (await agent.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [{ c, id, d, baseV, op: 'upsert' }] })).body.results[0];
let server: Awaited<ReturnType<typeof createTestServer>>;
beforeEach(async () => { server = await createTestServer(); });
afterEach(() => server.close());

async function driver() {
  const example = server.db.getRow('users', 'usr-3')!.d;
  const user = { ...example, id: 'usr-driver-test', role: 'SUPPORT_SERVICES', fullName: 'سائق اختبار', email: 'driver@example.test' };
  server.db.writeRow('users', user.id, user, 34, null);
  const credential = server.db.getCredentials(example.id)!;
  server.db.setPassword(user.id, user.email, credential.passwordHash, false);
  return { user, agent: await loginAgent(server.app, user.email, DEMO_PASSWORD) };
}

it('lets support staff view and progress only their named work, and removes it on reassignment', async () => {
  const { user, agent } = await driver();
  const manager = await loginAgent(server.app, 'admin@akhbar.tv');
  const empty = (await agent.get('/api/v1/data')).body;
  expect(empty.collections.tasks).toEqual([]);
  expect(empty.collections.news).toEqual([]);
  expect((await agent.get('/api/v1/chat/history').query({ channel: 'general' })).status).toBe(403);
  expect(empty.collections.users.map(({ id }: { id: string }) => id)).toEqual([user.id]);
  expect((await send(agent, 'notifications', 'driver-notice', { userId: 'usr-3', title: 'تنبيه' })).ok).toBe(false);
  const task = { id: 'drive-task', title: 'استلام فريق التصوير', status: 'TODO', priority: 'NORMAL', assigneeId: user.id };
  const created = await send(manager, 'tasks', task.id, task);
  expect(created.ok).toBe(true);
  const notice = server.db.listCollection('notifications').find(row => row.d.userId === user.id && row.d.linkUrl === '/tasks/drive-task')!;
  expect((await send(agent, 'notifications', notice.id, { ...notice.d, userId: 'usr-3', isRead: true }, notice.v)).ok).toBe(false);
  expect((await send(agent, 'notifications', notice.id, { ...notice.d, isRead: true }, notice.v)).ok).toBe(true);
  const stepType = stepTypesOf(server.db.getRow('settings', 'singleton')?.d)[0].id;
  const card = { id: 'drive-card', title: 'مهمة نقل', kind: 'PROGRAM', priority: 'NORMAL', status: 'OPEN', ownerId: 'usr-1',
    target: { kind: 'episode', id: 'ep-101', title: 'الحلقة' }, steps: [
      { id: 'transport', assigneeId: user.id, status: 'TODO', type: stepType, complexity: 1 },
      { id: 'colleague', assigneeId: 'usr-3', status: 'TODO', type: stepType, complexity: 1 },
    ] };
  server.db.writeRow('productionCards', card.id, card, 0, null);
  expect((await agent.get('/api/v1/data/changes').query({ since: empty.rev, access: empty.access })).body.reset).toBe(true);
  const workspace = (await agent.get('/api/v1/data')).body;
  expect(workspace.collections.tasks.map(({ id }: { id: string }) => id)).toEqual([task.id]);
  expect(workspace.collections.productionCards.map(({ id }: { id: string }) => id)).toEqual([card.id]);
  expect(workspace.collections.episodes).toEqual([]);
  const assigned = workspace.collections.productionCards[0];
  const unrelated = { ...assigned.d, steps: assigned.d.steps.map((step: { id: string }) => step.id === 'colleague' ? { ...step, status: 'IN_PROGRESS' } : step) };
  expect((await send(agent, 'productionCards', card.id, unrelated, assigned.v)).ok).toBe(false);
  const working = { ...assigned.d, steps: assigned.d.steps.map((step: { id: string }) => step.id === 'transport' ? { ...step, status: 'IN_PROGRESS' } : step) };
  const startedStep = await send(agent, 'productionCards', card.id, working, assigned.v);
  expect(startedStep.ok, startedStep.message).toBe(true);
  const started = await send(agent, 'tasks', task.id, { ...created.row.d, status: 'IN_PROGRESS' }, created.row.v);
  expect(started.ok).toBe(true);
  expect(started.row.d.execution.runningSince).toBeTruthy();
  expect((await send(agent, 'tasks', 'self-created', task)).ok).toBe(false);
  expect((await send(manager, 'tasks', task.id, { ...started.row.d, assigneeId: 'usr-3' }, started.row.v)).ok).toBe(true);
  expect((await agent.get('/api/v1/data/changes').query({ since: workspace.rev, access: workspace.access })).body.reset).toBe(true);
  expect((await agent.get('/api/v1/data')).body.collections.tasks).toEqual([]);
});

it('validates the task workflow on the server, and rejects client-written timing or completion by the assignee', async () => {
  const { user, agent } = await driver();
  const manager = await loginAgent(server.app, 'admin@akhbar.tv');
  const settings = server.db.getRow('settings', 'singleton')!;
  expect((await send(manager, 'settings', settings.id, { ...settings.d,
    taskWorkflow: { requireReview: true, requireBlockedReason: true, reopenManagersOnly: true },
  }, settings.v)).ok).toBe(true);
  const task = { id: 'review-task', title: 'تسليم الكاميرا', status: 'TODO', priority: 'NORMAL', assigneeId: user.id };
  const initial = (await send(manager, 'tasks', task.id, task)).row;
  const started = await send(agent, 'tasks', task.id, { ...initial.d, status: 'IN_PROGRESS', execution: { activeSeconds: 12000 }, statusHistory: [] }, initial.v);
  expect(started.ok).toBe(true);
  expect(started.row.d.execution.activeSeconds).toBe(0);
  expect(started.row.d.statusHistory.map((event: { status: string }) => event.status)).toEqual(['TODO', 'IN_PROGRESS']);
  expect((await send(agent, 'tasks', task.id, { ...started.row.d, status: 'BLOCKED' }, started.row.v)).ok).toBe(false);
  const blocked = (await send(agent, 'tasks', task.id, { ...started.row.d, status: 'BLOCKED', blockedReason: 'لم يصل الطاقم' }, started.row.v)).row;
  expect(blocked.d.execution.runningSince).toBeUndefined();
  expect(blocked.d.statusHistory.at(-1).reason).toBe('لم يصل الطاقم');
  expect((await send(manager, 'tasks', task.id, { ...blocked.d, status: 'COMPLETED' }, blocked.v)).ok).toBe(false);
  const review = (await send(agent, 'tasks', task.id, { ...blocked.d, status: 'IN_REVIEW' }, blocked.v)).row;
  expect((await send(agent, 'tasks', task.id, { ...review.d, status: 'COMPLETED' }, review.v)).ok).toBe(false);
  const completed = (await send(manager, 'tasks', task.id, { ...review.d, status: 'COMPLETED' }, review.v)).row;
  expect(completed.d.execution.endedAt).toBeTruthy();
  expect((await send(agent, 'tasks', task.id, { ...completed.d, status: 'IN_PROGRESS' }, completed.v)).ok).toBe(false);
  expect((await send(manager, 'tasks', task.id, { ...completed.d, status: 'IN_PROGRESS' }, completed.v)).ok).toBe(true);
});

it('canonicalizes DONE to COMPLETED and strips legacy assignedToId/assignedToName on server write', async () => {
  const { user } = await driver();
  const manager = await loginAgent(server.app, 'admin@akhbar.tv');
  const created = await send(manager, 'tasks', 'legacy-write-task', {
    id: 'legacy-write-task',
    title: 'مهمة قديمة',
    status: 'DONE',
    priority: 'NORMAL',
    assignedToId: user.id,
    assignedToName: 'اسم قديم',
  });
  expect(created.ok).toBe(true);
  expect(created.row.d.status).toBe('COMPLETED');
  expect(created.row.d.assigneeId).toBe(user.id);
  expect(created.row.d.assigneeName).toBe(user.fullName);
  expect(created.row.d.assignedToId).toBeUndefined();
  expect(created.row.d.assignedToName).toBeUndefined();
  const stored = server.db.getRow('tasks', 'legacy-write-task')!.d;
  expect(stored.status).toBe('COMPLETED');
  expect(stored.assignedToId).toBeUndefined();
  expect(stored.assignedToName).toBeUndefined();
});

