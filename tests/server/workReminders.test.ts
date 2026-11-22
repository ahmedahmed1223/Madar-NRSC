import { afterEach, beforeEach, expect, it } from 'vitest';
import { sendDueWorkReminders } from '../../src/server/workReminders';
import { createTestServer, loginAgent } from '../helpers';

type Agent = Awaited<ReturnType<typeof loginAgent>>;
const dueDate = '2030-06-12T10:00:00.000Z';
const task = { title: 'متابعة تسليم التقرير', priority: 'NORMAL', status: 'TODO', assigneeId: 'usr-6', dueDate };
const card = { title: 'تكليف تقرير ميداني', kind: 'NEWS', priority: 'NORMAL', status: 'OPEN', ownerId: 'usr-2',
  steps: [{ id: 'step-1', type: 'gather', status: 'TODO', complexity: 1, assigneeId: 'usr-6', dueAt: dueDate }] };
let fixture: Awaited<ReturnType<typeof createTestServer>>;

beforeEach(async () => { fixture = await createTestServer(); });
afterEach(() => fixture.close());

async function upsert(agent: Agent, c: string, id: string, d: object, baseV?: number) {
  const response = await agent.post('/api/v1/data/sync').set('X-NRCS-Client', 'web')
    .send({ ops: [{ c, id, op: 'upsert', d, baseV }] });
  expect(response.status).toBe(200);
  return response.body.results[0];
}

it('enforces hierarchy for task owners, card owners and card steps on the server', async () => {
  const editor = await loginAgent(fixture.app, 'editor@akhbar.tv');
  const admin = await loginAgent(fixture.app, 'admin@akhbar.tv');
  const denied = { ok: false, code: 'FORBIDDEN', message: expect.stringContaining('مستوى إداري أعلى') };
  expect(await upsert(editor, 'tasks', 'upward-task', { ...task, assigneeId: 'usr-1' })).toMatchObject(denied);
  expect(await upsert(editor, 'tasks', 'legacy-upward-task', { ...task, assigneeId: undefined, assignedToId: 'usr-1' })).toMatchObject(denied);
  expect(await upsert(editor, 'productionCards', 'upward-owner', { ...card, ownerId: 'usr-1' })).toMatchObject(denied);
  expect(await upsert(editor, 'productionCards', 'upward-step', { ...card, steps: [{ ...card.steps[0], assigneeId: 'usr-1' }] })).toMatchObject(denied);
  const saved = await upsert(editor, 'tasks', 'valid-task', task);
  expect(saved.ok).toBe(true);
  expect(await upsert(editor, 'tasks', 'valid-task', { ...saved.row.d, assigneeId: 'usr-1' }, saved.row.v)).toMatchObject(denied);
  expect((await upsert(admin, 'tasks', 'valid-admin-task', { ...task, assigneeId: 'usr-2' })).ok).toBe(true);
  const savedCard = await upsert(editor, 'productionCards', 'valid-card', card);
  expect(savedCard.ok).toBe(true);
  expect(await upsert(editor, 'productionCards', 'valid-card', { ...savedCard.row.d, ownerId: 'usr-1', deletedAt: dueDate }, savedCard.row.v)).toMatchObject(denied);
  const trashed = await upsert(editor, 'productionCards', 'valid-card', { ...savedCard.row.d, deletedAt: dueDate }, savedCard.row.v);
  expect(trashed.ok).toBe(true);
  expect(await upsert(editor, 'productionCards', 'valid-card', { ...trashed.row.d, ownerId: 'usr-1', deletedAt: null }, trashed.row.v)).toMatchObject(denied);
  expect((await upsert(editor, 'productionCards', 'valid-card', { ...trashed.row.d, deletedAt: null }, trashed.row.v)).ok).toBe(true);
});

it('delivers one alert per deadline, reschedules and skips completed or cancelled work', async () => {
  const editor = await loginAgent(fixture.app, 'editor@akhbar.tv');
  const reporter = await loginAgent(fixture.app, 'reporter@akhbar.tv');
  const options = { leadMinutes: 60, overdue: true };
  const saved = await upsert(editor, 'tasks', 'scheduled-task', { ...task, reminderOptions: options });
  expect(saved.ok).toBe(true);
  expect((await upsert(reporter, 'tasks', 'scheduled-task', { ...saved.row.d, reminderOptions: { leadMinutes: 0 } }, saved.row.v)).ok).toBe(false);
  const closed = await upsert(editor, 'tasks', 'closed-task', { ...task, reminderOptions: options, status: 'CANCELLED' });
  expect(closed.ok).toBe(true);
  const invalid = await upsert(editor, 'tasks', 'invalid-task', { ...task, reminderOptions: { leadMinutes: 5 } });
  expect(invalid.ok).toBe(false);
  const savedCard = await upsert(editor, 'productionCards', 'scheduled-card', { ...card, dueAt: dueDate, reminderOptions: options });
  expect(savedCard.ok).toBe(true);

  const tick = (time: string) => sendDueWorkReminders(fixture.db, new Date(time));
  expect(tick('2030-06-12T08:59:59.999Z')).toBe(0);
  expect(tick('2030-06-12T09:00:00.000Z')).toBe(3);
  expect(tick('2030-06-12T09:00:00.001Z')).toBe(0);
  const finishedCard = await upsert(editor, 'productionCards', 'scheduled-card', { ...savedCard.row.d, status: 'CLOSED' }, savedCard.row.v);
  expect(finishedCard.ok).toBe(true);
  const moved = await upsert(editor, 'tasks', 'scheduled-task', { ...saved.row.d, dueDate: '2030-06-12T12:00:00.000Z' }, saved.row.v);
  expect(moved.ok).toBe(true);
  expect(tick('2030-06-12T10:15:00.000Z')).toBe(0);
  expect(tick('2030-06-12T11:00:00.000Z')).toBe(1);
  expect(tick('2030-06-12T12:15:00.000Z')).toBe(1);
  expect(tick('2030-06-12T12:16:00.000Z')).toBe(0);
  const notices = fixture.db.listCollection('notifications').map(row => row.d).filter(notice => notice.category === 'assignment-reminder');
  expect(notices.filter(notice => notice.linkUrl === '/cards/scheduled-card').map(notice => notice.userId).sort()).toEqual(['usr-2', 'usr-6']);
  expect(notices.filter(notice => notice.linkUrl === '/tasks/scheduled-task' && notice.userId === 'usr-6')).toHaveLength(3);
  expect(notices.filter(notice => notice.title === 'تأخر موعد التسليم')).toHaveLength(1);
});

it('uses the configured station scope even for colleagues of lower rank', async () => {
  const { db } = fixture;
  const settings = db.getRow('settings', 'singleton')!;
  const stations = [{ id: 'gaza', name: 'غزة', linkedIds: [] }, { id: 'beirut', name: 'بيروت', linkedIds: [] }];
  db.writeRow('settings', 'singleton', { ...settings.d, stations }, settings.p, null);
  const editorRow = db.getRow('users', 'usr-2')!;
  const reporterRow = db.getRow('users', 'usr-6')!;
  db.writeRow('users', editorRow.id, { ...editorRow.d, stationId: 'gaza' }, editorRow.p, null);
  db.writeRow('users', reporterRow.id, { ...reporterRow.d, stationId: 'beirut' }, reporterRow.p, null);
  const editor = await loginAgent(fixture.app, 'editor@akhbar.tv');
  expect(await upsert(editor, 'tasks', 'across-stations', task)).toMatchObject({
    ok: false, code: 'FORBIDDEN', message: expect.stringContaining('خارج نطاق المحطات'),
  });
  const stationTask = { ...card, steps: [{ ...card.steps[0], assigneeId: undefined, stationId: 'beirut' }] };
  expect(await upsert(editor, 'productionCards', 'across-station-queue', stationTask)).toMatchObject({ ok: false, code: 'FORBIDDEN' });

  const current = db.getRow('settings', 'singleton')!;
  db.writeRow('settings', 'singleton', { ...current.d, stations: [{ ...stations[0], linkedIds: ['beirut'] }, stations[1]] }, current.p, null);
  expect((await upsert(editor, 'tasks', 'linked-station-task', task)).ok).toBe(true);
  expect((await upsert(editor, 'productionCards', 'linked-station-queue', stationTask)).ok).toBe(true);
});
