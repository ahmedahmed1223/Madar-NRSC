import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import { emptyDigitalPackage } from '../../src/shared/digitalPublishing';

let server: Awaited<ReturnType<typeof createTestServer>>;
let admin: Awaited<ReturnType<typeof loginAgent>>;
let journalist: Awaited<ReturnType<typeof loginAgent>>;

beforeAll(async () => {
  server = await createTestServer();
  admin = await loginAgent(server.app, 'admin@akhbar.tv');
  journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
});
afterAll(() => server.close());

async function save(agent: typeof admin, op: { c: string; id: string; d: unknown; baseV?: number }) {
  const response = await agent.post('/api/v1/data/sync').set('X-NRCS-Client', 'web').send({ ops: [{ op: 'upsert', ...op }] });
  expect(response.status).toBe(200);
  return response.body.results[0];
}

it('rejects premature approvals, replaces forged stamps, and invalidates approved packages on source edits', async () => {
  const copy = { ...emptyDigitalPackage(), x: 'نص مخصص للنشر' };
  const news = (agent: typeof admin, d: unknown, baseV?: number) => save(agent, { c: 'news', id: 'digital-test-story', d, baseV });
  const draft = {
    id: 'digital-test-story', title: 'قصة الاختبار', authorId: 'usr-3', status: 'DRAFT',
    content: '<p>نص خبري كامل يتضمن ما يلزم من تفاصيل لمرور الخبر إلى مسار المراجعة المعتمد.</p>',
    digitalPackage: { ...copy, approval: { by: 'forged', at: '2000-01-01' } },
  };
  const created = await news(journalist, draft);
  expect(created).toMatchObject({ ok: true, row: { d: { digitalPackage: copy } } });
  expect(created.row.d.digitalPackage.approval).toBeUndefined();
  const prematurelyRequested = await news(journalist, { ...created.row.d, digitalPackage: { ...copy, requestApproval: true } }, created.row.v);
  expect(prematurelyRequested.ok).toBe(false);

  const stored = server.db.getRow('news', 'digital-test-story')!;
  const accepted = server.db.writeRow('news', stored.id, { ...stored.d, status: 'APPROVED' }, stored.p, null);
  const approved = await news(admin, { ...accepted.d, digitalPackage: { ...copy, requestApproval: true, approval: draft.digitalPackage.approval } }, accepted.v);
  expect(approved).toMatchObject({ ok: true, row: { d: { digitalPackage: { ...copy, approval: { by: 'usr-1' } } } } });
  expect(approved.row.d.digitalPackage.approval.at).not.toBe('2000-01-01');
  expect(approved.row.d.digitalPackage.requestApproval).toBeUndefined();

  const edited = await news(admin, { ...approved.row.d, title: 'تعديل القصة بعد اعتماد الحزمة' }, approved.row.v);
  expect(edited.ok).toBe(true);
  expect(edited.row.d.digitalPackage.approval).toBeUndefined();
});

it('uses existing system settings permissions and validates stylebook formats', async () => {
  const settings = server.db.getRow('settings', 'singleton')!;
  const editorialPublishing = {
    preferredTags: ['#غرفة_الأخبار'],
    stylebook: { terms: [{ term: 'إثر', replacement: 'بعد' }], numbers: 'latn', dates: 'dmy', currencies: 'code-after' },
  };
  const operation = { c: 'settings', id: 'singleton', d: { ...settings.d, editorialPublishing }, baseV: settings.v };
  expect((await save(journalist, operation)).ok).toBe(false);
  const invalid = { ...editorialPublishing, preferredTags: ['#وسم خاطئ'] };
  expect((await save(admin, { ...operation, d: { ...settings.d, editorialPublishing: invalid } })).ok).toBe(false);
  expect((await save(admin, operation)).row.d.editorialPublishing).toEqual(editorialPublishing);
});
