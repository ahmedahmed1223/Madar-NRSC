import { expect, test } from '@playwright/test';
import { stepTypesOf } from '../../src/shared/productionCards';
import { openNav, signIn } from './helpers';

test('support staff see and progress their assigned work across periods on a phone', async ({ browser }) => {
  const staff = await signIn(browser, 'reporter@akhbar.tv', { viewport: { width: 390, height: 844 } });
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const { user } = await (await staff.page.request.get('/api/v1/auth/me')).json();
  const adminData = async () => (await (await admin.page.request.get('/api/v1/data')).json()).collections;
  const collections = await adminData();
  const original = collections.users.find((row: { id: string }) => row.id === user.id);
  const put = async (ops: object[]) => (await (await admin.page.request.post('/api/v1/data/sync', {
    headers: { 'X-NRCS-Client': 'web' }, data: { ops },
  })).json()).results;
  const stamp = Date.now();
  const ownTitle = `مهمة السائق ${stamp}`;
  const anotherTitle = `مهمة زميل ${stamp}`;
  const ownCardTitle = `تكليف السائق ${stamp}`;
  const anotherCardTitle = `تكليف زميل ${stamp}`;
  const dueDate = new Date(stamp).toISOString();
  const type = stepTypesOf(collections.settings[0]?.d)[0].id;
  const card = (title: string, assigneeId: string) => ({
    title, kind: 'OTHER', status: 'OPEN', priority: 'NORMAL', ownerId: 'usr-1', dueAt: dueDate,
    steps: [{ id: 'transport', type, title: 'نقل فريق التصوير', status: 'TODO', assigneeId, complexity: 1, dueAt: dueDate }],
  });

  try {
    const results = await put([
      { c: 'users', id: user.id, op: 'upsert', baseV: original.v, d: { ...original.d, role: 'SUPPORT_SERVICES', customRoleId: undefined, customPermissions: [] } },
      { c: 'tasks', id: `support-own-${stamp}`, op: 'upsert', d: { title: ownTitle, status: 'TODO', priority: 'NORMAL', assigneeId: user.id, dueDate } },
      { c: 'tasks', id: `support-other-${stamp}`, op: 'upsert', d: { title: anotherTitle, status: 'TODO', priority: 'NORMAL', assigneeId: 'usr-3', dueDate } },
      { c: 'productionCards', id: `support-card-${stamp}`, op: 'upsert', d: card(ownCardTitle, user.id) },
      { c: 'productionCards', id: `support-other-card-${stamp}`, op: 'upsert', d: card(anotherCardTitle, 'usr-3') },
    ]);
    expect(results, JSON.stringify(results.filter(({ ok }: { ok: boolean }) => !ok))).toEqual(Array.from({ length: 5 }, () => expect.objectContaining({ ok: true })));
    await staff.page.reload();
    await openNav(staff.page, 'المهام');
    await expect(staff.page.getByText(ownTitle, { exact: true })).toBeVisible();
    await expect(staff.page.getByText(anotherTitle, { exact: true })).toHaveCount(0);
    await expect(staff.page.getByRole('button', { name: /المحادثة الداخلية/ })).toHaveCount(0);
    const period = staff.page.getByRole('combobox', { name: 'موعد التسليم', exact: true });
    for (const value of ['TODAY', 'WEEK', 'MONTH']) {
      await period.selectOption(value);
      await expect(staff.page.getByText(ownTitle, { exact: true })).toBeVisible();
    }
    await expect(staff.page.getByRole('button', { name: /مهمة جديدة|تكليف جديد/ })).toHaveCount(0);

    await openNav(staff.page, 'التكليفات');
    const cardPeriod = staff.page.getByRole('combobox', { name: 'فترة التكليفات', exact: true });
    const assigned = staff.page.getByRole('button', { name: new RegExp(ownCardTitle) });
    for (const value of ['TODAY', 'WEEK', 'MONTH']) {
      await cardPeriod.selectOption(value);
      await expect(assigned).toBeVisible();
    }
    await expect(staff.page.getByText(anotherCardTitle, { exact: true })).toHaveCount(0);
    await assigned.click();
    await staff.page.getByRole('button', { name: 'بدء العمل', exact: true }).click();
    await expect.poll(async () => (await adminData()).productionCards.find((row: { id: string }) => row.id === `support-card-${stamp}`)?.d.steps[0].status).toBe('IN_PROGRESS');
  } finally {
    const updated = (await adminData()).users.find((row: { id: string }) => row.id === user.id);
    if (updated) await put([{ c: 'users', id: user.id, op: 'upsert', baseV: updated.v, d: original.d }]);
    await staff.close();
    await admin.close();
  }
});
