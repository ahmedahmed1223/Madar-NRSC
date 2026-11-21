import { afterEach, beforeEach, expect, it } from 'vitest';
import { sendDuePersonalTaskReminders } from '../../src/server/personalTaskReminders';
import { createTestServer, loginAgent } from '../helpers';

type Agent = Awaited<ReturnType<typeof loginAgent>>;
const collection = 'personalTasks';
const soon = '2030-06-12T07:00:00.000Z';
const later = '2030-06-12T10:00:00.000Z';
const draft = { title: 'متابعة موعد خاص', notes: 'ملاحظات الحساب الخاصة', dueAt: later, reminderAt: soon, completed: false };
let server: Awaited<ReturnType<typeof createTestServer>>;

beforeEach(async () => { server = await createTestServer(); });
afterEach(() => server.close());

async function change(agent: Agent, op: object) {
  const response = await agent.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [{ c: collection, ...op }] });
  expect(response.status).toBe(200);
  return response.body.results[0];
}

it('keeps personal tasks and their deletions within the owner account, including support staff', async () => {
  const admin = await loginAgent(server.app, 'admin@akhbar.tv');
  const crew = await loginAgent(server.app, 'crew@akhbar.tv');
  const crewUser = (await crew.get('/api/v1/auth/me')).body.user;
  const crewRow = server.db.getRow('users', crewUser.id)!;
  server.db.writeRow('users', crewUser.id, { ...crewRow.d, role: 'SUPPORT_SERVICES' }, crewRow.p, null);
  const owner = await loginAgent(server.app, 'crew@akhbar.tv');
  const input = { id: 'private-task', op: 'upsert', d: { ...draft, ownerId: 'another-user', reminderSentFor: soon } };
  expect(await change(owner, { ...input, d: { ...draft, reminderAt: 'tomorrow' } })).toMatchObject({ ok: false, code: 'INVALID' });
  const saved = await change(owner, input);
  expect(saved).toMatchObject({ ok: true, row: { d: { ...draft, ownerId: crewUser.id, reminderSentFor: null } } });

  const sameAccount = await loginAgent(server.app, 'crew@akhbar.tv');
  const ownerView = (await sameAccount.get('/api/v1/data')).body;
  const adminView = (await admin.get('/api/v1/data')).body;
  expect(ownerView.collections.personalTasks.map(({ id }: { id: string }) => id)).toEqual([input.id]);
  expect(adminView.collections.personalTasks).toEqual([]);
  const edit = await change(admin, { ...input, baseV: saved.row.v });
  const remove = await change(admin, { id: input.id, op: 'delete', baseV: saved.row.v });
  expect(edit).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(remove).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(edit.current).toBeUndefined();
  expect(remove.current).toBeUndefined();
  expect(await change(owner, { id: input.id, op: 'delete', baseV: saved.row.v })).toMatchObject({ ok: true });
  expect((await sameAccount.get('/api/v1/data/changes').query({ since: ownerView.rev, access: ownerView.access })).body.changes)
    .toEqual([{ c: collection, id: input.id, v: saved.row.v + 1, p: saved.row.p, deleted: true }]);
  expect((await admin.get('/api/v1/data/changes').query({ since: adminView.rev, access: adminView.access })).body.changes).toEqual([]);
});

it('delivers one reminder per scheduled time, skips completed and deleted tasks, and catches up', async () => {
  const owner = await loginAgent(server.app, 'reporter@akhbar.tv');
  const ownerId = (await owner.get('/api/v1/auth/me')).body.user.id;
  const add = async (id: string, input = draft) => {
    const saved = await change(owner, { id, op: 'upsert', d: input });
    expect(saved.ok).toBe(true);
    return saved.row;
  };
  await add('remind-me');
  await add('completed', { ...draft, completed: true });
  const deleted = await add('deleted');
  expect((await change(owner, { id: 'deleted', op: 'delete', baseV: deleted.v })).ok).toBe(true);

  const tick = (time: string) => sendDuePersonalTaskReminders(server.db, new Date(time));
  expect(tick('2030-06-12T06:59:59.999Z')).toBe(0);
  expect(tick(soon)).toBe(1);
  expect(tick(soon)).toBe(0);
  const notified = server.db.getRow(collection, 'remind-me')!;
  const edit = await change(owner, { id: notified.id, op: 'upsert', baseV: notified.v, d: { ...draft, title: 'عنوان محدث' } });
  expect(edit.row.d.reminderSentFor).toBe(soon);
  expect(tick(soon)).toBe(0);
  const schedule = await change(owner, { id: notified.id, op: 'upsert', baseV: edit.row.v, d: { ...draft, reminderAt: later } });
  expect(schedule.row.d.reminderSentFor).toBeNull();
  expect(tick(soon)).toBe(0);
  expect(tick('2030-06-12T12:00:00.000Z')).toBe(1);
  expect(tick('2030-06-12T12:01:00.000Z')).toBe(0);
  const reminders = server.db.listCollection('notifications').filter(row => row.d.category === 'personal-task');
  expect(reminders).toHaveLength(2);
  for (const row of reminders) {
    expect(row.d).toMatchObject({ userId: ownerId, linkUrl: '/personal-tasks/remind-me' });
    expect(row.d.message).not.toContain(draft.notes);
  }
});
