import { expect, test } from '@playwright/test';
import { departmentsOf } from '../../src/shared/departments';
import { stepTypesOf } from '../../src/shared/productionCards';
import { openNav, signIn } from './helpers';

test('a department head can follow staff tasks and card steps on a phone', async ({ browser }) => {
  const head = await signIn(browser, 'journalist@akhbar.tv', { viewport: { width: 390, height: 844 } });
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const data = async () => (await (await admin.page.request.get('/api/v1/data')).json()).collections;
  const write = async (ops: object[]) => (await (await admin.page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops } })).json()).results;
  const { settings: [settings], users } = await data();
  const { user } = await (await head.page.request.get('/api/v1/auth/me')).json();
  const driver = users.find((row: { d: { email: string } }) => row.d.email === 'reporter@akhbar.tv');
  const other = users.find((row: { d: { email: string } }) => row.d.email === 'producer@akhbar.tv');
  const id = Date.now();
  const departmentId = `transport-${id}`;
  const dueAt = new Date(id).toISOString();
  const taskTitle = `مهمة نقل الموظفين ${id}`;
  const cardTitle = `تكليف سيارة التصوير ${id}`;
  const otherTitle = `تكليف قسم آخر ${id}`;
  const type = stepTypesOf(settings.d)[0].id;

  try {
    const results = await write([
      { c: 'settings', id: settings.id, op: 'upsert', baseV: settings.v,
        d: { ...settings.d, departments: [...departmentsOf(settings.d), { id: departmentId, name: `فريق النقل ${id}`, headUserId: user.id }] } },
      { c: 'users', id: driver.id, op: 'upsert', baseV: driver.v, d: { ...driver.d, departmentId, role: 'SUPPORT_SERVICES' } },
      { c: 'tasks', id: `department-task-${id}`, op: 'upsert', d: { title: taskTitle, assigneeId: driver.id, dueDate: dueAt, status: 'TODO', priority: 'NORMAL' } },
      { c: 'tasks', id: `other-department-task-${id}`, op: 'upsert', d: { title: otherTitle, assigneeId: other.id, dueDate: dueAt, status: 'TODO', priority: 'NORMAL' } },
      { c: 'productionCards', id: `department-card-${id}`, op: 'upsert', d: { title: cardTitle, kind: 'OTHER', status: 'OPEN', priority: 'NORMAL', ownerId: other.id, steps: [
        { id: 'transport', title: 'تسليم المركبة', type, status: 'TODO', assigneeId: driver.id, dueAt, complexity: 1 },
        { id: 'external', title: 'خطوة القسم الآخر', type, status: 'TODO', assigneeId: other.id, dueAt, complexity: 1 },
      ] } },
    ]);
    expect(results.filter((result: { ok: boolean }) => !result.ok)).toEqual([]);

    await head.page.reload();
    await openNav(head.page, 'متابعة الفرق والتكاليف');
    await expect(head.page.getByRole('heading', { name: 'أعمال فريقي' })).toBeVisible();
    await head.page.getByRole('combobox', { name: 'الموظف' }).selectOption(driver.id);
    await head.page.getByRole('combobox', { name: 'فترة التسليم' }).selectOption('WEEK');
    await expect(head.page.getByText(taskTitle, { exact: true })).toBeVisible();
    await expect(head.page.getByText(cardTitle, { exact: true })).toBeVisible();
    await expect(head.page.getByText(otherTitle, { exact: true })).toHaveCount(0);
    await expect(head.page.getByText('خطوة القسم الآخر', { exact: true })).toHaveCount(0);
  } finally {
    const updated = await data();
    await write([
      { c: 'users', id: driver.id, op: 'upsert', baseV: updated.users.find((row: { id: string }) => row.id === driver.id).v, d: driver.d },
      { c: 'settings', id: settings.id, op: 'upsert', baseV: updated.settings[0].v, d: { ...settings.d, departments: [...departmentsOf(settings.d), { id: departmentId, name: `فريق النقل ${id}`, archived: true }] } },
    ]);
    await head.close();
    await admin.close();
  }
});
