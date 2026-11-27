import type request from 'supertest';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { sendDueWorkReminders } from '../../src/server/workReminders';
import { cardFromTemplate } from '../../src/shared/workflowTemplates';

let fixture: Awaited<ReturnType<typeof createTestServer>>;
beforeEach(async () => { fixture = await createTestServer(); });
afterEach(() => fixture.close());

async function save(agent: request.Agent, collection: string, id: string, data: object, baseV?: number) {
  const { body } = await agent.post('/api/v1/data/sync')
    .set('X-NRCS-Client', 'web')
    .send({ ops: [{ c: collection, id, op: 'upsert', d: data, baseV }] })
    .expect(200);
  return body.results[0];
}

function role(id: string, workflowRoles: Record<string, string>, extra: object = {}) {
  const row = fixture.db.getRow('users', id)!;
  fixture.db.writeRow('users', id, { ...row.d, workflowRoles, ...extra }, row.p, null);
}

const draft = {
  id: 'template-release-test',
  name: 'تغطية عاجلة',
  kind: 'NEWS',
  track: 'news',
  drafting: true,
  priority: 'URGENT',
  steps: [{ id: 'collect', type: 'gather', complexity: 1, rule: { kind: 'ASK' } }],
};

it('keeps separate track permissions, publishes immutable versions and restores an old publication as a new one', async () => {
  role('usr-2', { news: 'MANAGER', programmes: 'PREPARER' });
  const admin = await loginAgent(fixture.app, 'admin@akhbar.tv');
  const editor = await loginAgent(fixture.app, 'editor@akhbar.tv');
  const saved = await save(editor, 'workflowTemplates', draft.id, draft);
  expect(saved.ok).toBe(true);
  expect(saved.row.d.published).toBeUndefined();
  const wrongTrack = { ...draft, id: 'programme-template', kind: 'PROGRAM', track: 'programmes', publishRequested: true };
  expect((await save(editor, 'workflowTemplates', wrongTrack.id, wrongTrack)).ok).toBe(false);
  const shared = { ...draft, id: 'shared-template', track: 'shared', publishRequested: true };
  expect((await save(editor, 'workflowTemplates', shared.id, shared)).ok).toBe(false);
  expect((await save(admin, 'workflowTemplates', shared.id, shared)).ok).toBe(true);

  const invalid = { ...draft, publishRequested: true,
    steps: [{ id: 'approve', type: 'approve', complexity: 1, rule: { kind: 'ASK' } }] };
  expect((await save(editor, 'workflowTemplates', draft.id, invalid, saved.row.v)).message).toContain('جهة مخوّلة');
  const first = await save(editor, 'workflowTemplates', draft.id, { ...draft, publishRequested: true }, saved.row.v);
  expect(first.row.d.published).toMatchObject({ version: 1, name: draft.name, byId: 'usr-2' });
  const assignment = cardFromTemplate(first.row.d, { title: 'عمل قائم', ownerId: 'usr-2' }, [], { cardId: 'versioned-card' });
  expect(assignment.templateVersion).toBe(1);
  const created = await save(editor, 'productionCards', assignment.id, assignment);
  expect(created.ok).toBe(true);

  const second = await save(editor, 'workflowTemplates', draft.id, { ...draft, name: 'الإصدار الثاني', publishRequested: true }, first.row.v);
  expect(second.row.d.published).toMatchObject({ version: 2, name: 'الإصدار الثاني' });
  expect(fixture.db.getRow('productionCards', assignment.id)?.d.templateVersion).toBe(1);
  expect((await save(editor, 'productionCards', 'stale-template-card', { ...assignment, id: 'stale-template-card' })).ok).toBe(false);

  const history = await editor.get(`/api/v1/workflow-templates/${draft.id}/publications`).expect(200);
  expect(history.body.data.map((entry: { version: number }) => entry.version)).toEqual([2, 1]);
  const restored = await save(editor, 'workflowTemplates', draft.id, { ...draft, publishRequested: true }, second.row.v);
  expect(restored.row.d.published).toMatchObject({ version: 3, name: draft.name });
});

it('checks a temporary delegate at every mutation and protects mandatory steps', async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  role('usr-6', { news: 'PREPARER' }, { workflowDelegations: { news: { expiresAt: past, permissions: ['skipOptionalSteps'] } } });
  const editor = await loginAgent(fixture.app, 'editor@akhbar.tv');
  const reporter = await loginAgent(fixture.app, 'reporter@akhbar.tv');
  const card = { id: 'skip-card', title: 'خبر مسند', kind: 'NEWS', priority: 'NORMAL', status: 'OPEN', steps: [
    { id: 'required', type: 'approve', optional: false, status: 'TODO', complexity: 1 },
    { id: 'optional', type: 'translate', optional: true, status: 'TODO', complexity: 1 },
  ] };
  const created = await save(editor, 'productionCards', card.id, card);
  expect(created.ok).toBe(true);
  const skip = (index: number) => ({ ...created.row.d, steps: created.row.d.steps.map((step: object, i: number) =>
    i === index ? { ...step, status: 'SKIPPED', skippedReason: 'تغطية مترجمة جاهزة' } : step) });
  expect((await save(reporter, 'productionCards', card.id, skip(1), created.row.v)).ok).toBe(false);
  role('usr-6', { news: 'PREPARER' }, { workflowDelegations: { news: { expiresAt: new Date(Date.now() + 60_000).toISOString(), permissions: ['skipOptionalSteps'] } } });
  expect((await save(reporter, 'productionCards', card.id, skip(0), created.row.v)).ok).toBe(false);
  const permitted = await save(reporter, 'productionCards', card.id, skip(1), created.row.v);
  expect(permitted.ok).toBe(true);
  expect(permitted.row.d.steps[1]).toMatchObject({ status: 'SKIPPED', skippedById: 'usr-6', skippedReason: 'تغطية مترجمة جاهزة' });
});

it('notifies the decision owner once when a named step is still unacknowledged', async () => {
  const editor = await loginAgent(fixture.app, 'editor@akhbar.tv');
  const card = { id: 'late-receipt', title: 'بانتظار الاستلام', kind: 'NEWS', priority: 'URGENT', status: 'OPEN', ownerId: 'usr-2',
    steps: [{ id: 'report', type: 'gather', status: 'TODO', complexity: 1, assigneeId: 'usr-6', receiptMinutes: 10 }] };
  const written = await save(editor, 'productionCards', card.id, card);
  expect(written.ok).toBe(true);
  const assigned = Date.parse(written.row.d.steps[0].receiptAssignedAt);
  expect(sendDueWorkReminders(fixture.db, new Date(assigned + 9 * 60_000))).toBe(0);
  expect(sendDueWorkReminders(fixture.db, new Date(assigned + 11 * 60_000))).toBe(1);
  expect(sendDueWorkReminders(fixture.db, new Date(assigned + 12 * 60_000))).toBe(0);
  expect(fixture.db.listCollection('notifications').map(row => row.d)).toContainEqual(expect.objectContaining({
    userId: 'usr-2', title: 'انتهت مهلة تأكيد استلام التكليف', linkUrl: '/cards/late-receipt',
  }));
});

it('consolidates duplicate outputs transactionally and preserves the cancelled source history', async () => {
  const editor = await loginAgent(fixture.app, 'editor@akhbar.tv');
  const reporter = await loginAgent(fixture.app, 'reporter@akhbar.tv');
  const card = { title: 'تغطية مكررة', kind: 'NEWS', priority: 'NORMAL', status: 'OPEN', steps: [] };
  const original = await save(editor, 'productionCards', 'keep-card', { ...card, id: 'keep-card' });
  const source = await save(editor, 'productionCards', 'cancel-card', { ...card, id: 'cancel-card', script: 'إفادة محفوظة',
    log: [{ id: 'original-log', kind: 'NOTE', text: 'مصدر الإفادة الأول' }] });
  expect(original.ok && source.ok).toBe(true);
  const endpoint = '/api/v1/cards/keep-card/consolidate';
  const request = (agent: request.Agent, version: number) => agent.post(endpoint).set('X-NRCS-Client','web')
    .send({ duplicateId: 'cancel-card', version, duplicateVersion: source.row.v, reason: 'التغطية نفسها' });
  await request(reporter, original.row.v).expect(404);
  await request(editor, original.row.v + 1).expect(409);
  expect(fixture.db.getRow('productionCards', 'cancel-card')?.d.status).toBe('OPEN');
  await request(editor, original.row.v).expect(200);
  expect(fixture.db.getRow('productionCards', 'keep-card')?.d.script).toBe('إفادة محفوظة');
  expect(fixture.db.getRow('productionCards', 'cancel-card')?.d).toMatchObject({
    status: 'CANCELLED', script: 'إفادة محفوظة', log: expect.arrayContaining([expect.objectContaining({ id: 'original-log' })]),
  });
});

it('requires both management roles for a direct cross-track assignment and exposes only the assigned card', async () => {
  role('usr-2', { news: 'MANAGER', programmes: 'PREPARER' });
  role('usr-6', { programmes: 'PREPARER' });
  const editor = await loginAgent(fixture.app, 'editor@akhbar.tv');
  const reporter = await loginAgent(fixture.app, 'reporter@akhbar.tv');
  const data = { id: 'cross-track-card', title: 'مهمة مشتركة بين المسارين', kind: 'NEWS', priority: 'NORMAL',
    status: 'OPEN', ownerId: 'usr-2', steps: [{ id: 'support', type: 'gather', complexity: 1, status: 'TODO',
      executionTrack: 'programmes', assigneeId: 'usr-6' }] };
  const denied = await save(editor, 'productionCards', data.id, data);
  expect(denied.message).toContain('طلب المساندة');
  role('usr-2', { news: 'MANAGER', programmes: 'MANAGER' });
  const assigned = await save(editor, 'productionCards', data.id, data);
  expect(assigned.ok).toBe(true);
  const unrelated = { ...data, id: 'cross-track-unrelated', steps: [] };
  expect((await save(editor, 'productionCards', unrelated.id, unrelated)).ok).toBe(true);
  const visible = (await reporter.get('/api/v1/data').expect(200)).body.collections.productionCards;
  expect(visible.some((row: { id: string }) => row.id === data.id)).toBe(true);
  expect(visible.some((row: { id: string }) => row.id === unrelated.id)).toBe(false);
});

it('merges an independently changed step owner and deadline and preserves the first deadline on conflict', async () => {
  const editor = await loginAgent(fixture.app, 'editor@akhbar.tv');
  const admin = await loginAgent(fixture.app, 'admin@akhbar.tv');
  const id = 'parallel-changes';
  const create = await save(editor, 'productionCards', id, { id, title: 'تكليف متزامن', kind: 'NEWS',
    priority: 'NORMAL', status: 'OPEN', ownerId: 'usr-2',
    steps: [{ id: 'writing', title: 'صياغة', type: 'write', status: 'TODO', complexity: 1 }] });
  expect(create.ok).toBe(true);
  const before = create.row.d;
  const operation = (fields: object) => ({ ...before, steps: [{ ...before.steps[0], ...fields }] });
  const firstDue = new Date(Date.now() + 7_200_000).toISOString();
  expect((await save(editor, 'productionCards', id, operation({ dueAt: firstDue }), create.row.v)).ok).toBe(true);
  const assignment = await save(admin, 'productionCards', id, operation({ assigneeId: 'usr-6' }), create.row.v);
  expect(assignment.ok).toBe(true);
  expect(assignment.row.d.steps[0]).toMatchObject({ assigneeId: 'usr-6', dueAt: firstDue });
  const conflict = await save(admin, 'productionCards', id, operation({ dueAt: new Date(Date.now() + 10_800_000).toISOString() }), create.row.v);
  expect(conflict.ok).toBe(false);
  expect(fixture.db.getRow('productionCards', id)?.d.steps[0].dueAt).toBe(firstDue);
});
