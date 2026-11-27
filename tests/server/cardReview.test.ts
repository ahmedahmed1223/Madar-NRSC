import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';

let server: Awaited<ReturnType<typeof createTestServer>>;
let editor: request.Agent;
let worker: request.Agent;
let reviewer: request.Agent;
const cardId = 'card-review-lifecycle';

beforeAll(async () => {
  server = await createTestServer();
  const account = server.db.getRow('users', 'usr-10')!;
  server.db.writeRow('users', account.id, { ...account.d, role: 'QUALITY', departmentId: 'quality' }, account.p, null);
  editor = await loginAgent(server.app, 'editor@akhbar.tv');
  worker = await loginAgent(server.app, 'journalist@akhbar.tv');
  reviewer = await loginAgent(server.app, 'crew@akhbar.tv');
});
afterAll(() => server.close());

const current = () => server.db.getRow('productionCards', cardId)!;
const save = async (agent: request.Agent, d: any, baseV?: number) => {
  const result = await agent.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({
    ops: [{ c: 'productionCards', op: 'upsert', id: cardId, d, baseV }],
  });
  return result.body.results[0];
};
const edit = async (agent: request.Agent, fn: (d: any) => any) => {
  const row = current();
  return save(agent, fn(row.d), row.v);
};
const step = (card: any, id: string, patch: any) => ({
  ...card,
  steps: card.steps.map((item: any) => item.id === id ? { ...item, ...patch } : item),
});
const delivery = (card: any, id: string, text: string) => ({
  ...step(card, 'copy', { status: 'IN_REVIEW', note: text }),
  log: [...card.log, { id, kind: 'NOTE', stepId: 'copy', delivery: 'FINAL', text, deliveryLinks: card.links }],
});

describe('configured step review', () => {
  it('requires the selected reviewer, preserves every delivery and closes only after required work is accepted', async () => {
    expect(await save(editor, {
      id: cardId, title: 'مراجعة محاور الحلقة', kind: 'PROGRAM', priority: 'NORMAL', status: 'OPEN',
      links: [{ label: 'المحاور الأولى', url: 'https://example.com/first' }],
      steps: [
        { id: 'copy', type: 'edit', status: 'TODO', complexity: 1, assigneeId: 'usr-3', reviewerId: 'usr-10' },
        { id: 'guest', type: 'prep', status: 'DONE', complexity: 1 },
        { id: 'translation', type: 'translate', status: 'TODO', complexity: 1, optional: true },
      ],
    })).toMatchObject({ ok: true });
    expect(await edit(editor, card => ({ ...card, status: 'CLOSED' }))).toMatchObject({ ok: false });
    expect(await edit(worker, card => step(card, 'copy', { status: 'DONE' }))).toMatchObject({ ok: false });
    expect(await edit(worker, card => delivery(card, 'delivery-a', 'المحاور الأولية'))).toMatchObject({ ok: true });
    expect(current().d.steps[0]).toMatchObject({ status: 'IN_REVIEW', reviewerId: 'usr-10' });
    expect(server.db.listCollection('notifications').map(row => row.d)).toContainEqual(expect.objectContaining({
      userId: 'usr-10', linkUrl: `/cards/${cardId}`, title: 'تسليم بانتظار مراجعتك',
    }));
    expect(await edit(editor, card => step(card, 'copy', { status: 'DONE' }))).toMatchObject({ ok: false });
    expect(await edit(reviewer, card => step(card, 'copy', { status: 'IN_PROGRESS', returnedReason: 'أضف سؤال المتابعة' }))).toMatchObject({ ok: false });
    const dueAt = new Date(Date.now() + 86_400_000).toISOString();
    expect(await edit(reviewer, card => step(card, 'copy', { status: 'IN_PROGRESS', returnedReason: 'أضف سؤال المتابعة', dueAt }))).toMatchObject({ ok: true });
    expect(current().d.steps[0]).toMatchObject({ status: 'IN_PROGRESS', dueAt, returnedById: 'usr-10' });
    expect(current().d.steps[1].status).toBe('DONE');
    expect(await edit(worker, card => delivery({ ...card, links: [{ label: 'المحاور المحدّثة', url: 'https://example.com/second' }] }, 'delivery-b', 'المحاور المحدثة'))).toMatchObject({ ok: true });
    expect(await edit(reviewer, card => step(card, 'copy', { status: 'DONE' }))).toMatchObject({ ok: true });
    expect(current().d.steps[0]).toMatchObject({ status: 'DONE', doneById: 'usr-10' });
    expect(current().d.log.filter((entry: any) => entry.delivery === 'FINAL')).toEqual([
      expect.objectContaining({ id: 'delivery-a', text: 'المحاور الأولية', byId: 'usr-3', deliveryLinks: [{ label: 'المحاور الأولى', url: 'https://example.com/first' }] }),
      expect.objectContaining({ id: 'delivery-b', text: 'المحاور المحدثة', byId: 'usr-3', deliveryLinks: [{ label: 'المحاور المحدّثة', url: 'https://example.com/second' }] }),
    ]);
    const nextDueAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    expect(await edit(reviewer, card => step(card, 'copy', { status: 'IN_PROGRESS', returnedReason: 'راجع الأرقام المحدثة', dueAt: nextDueAt }))).toMatchObject({ ok: true });
    expect(current().d.log.filter((entry: any) => entry.delivery === 'FINAL')).toHaveLength(2);
    expect(await edit(editor, card => ({ ...card, status: 'CLOSED' }))).toMatchObject({ ok: false });
    expect(await edit(worker, card => delivery(card, 'delivery-c', 'المحاور النهائية'))).toMatchObject({ ok: true });
    expect(await edit(reviewer, card => step(card, 'copy', { status: 'DONE' }))).toMatchObject({ ok: true });
    expect(await edit(editor, card => ({ ...card, status: 'CLOSED' }))).toMatchObject({ ok: true });
  });
});
