import { expect, test } from '@playwright/test';
import { departmentsOf } from '../../src/shared/departments';
import { DEMO_PASSWORD, openNav, signIn } from './helpers';
import { build } from 'esbuild';
import { queueFilterKey } from '../../src/shared/workContext';

test('filter state isolates account changes without remounting and waits for loaded options', async ({ page }) => {
  const bundle = await build({ entryPoints: ['tests/e2e/queue-filter-harness.tsx'], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"development"' } });
  await page.route('**/__queue_filter.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
  await page.route('**/__queue_filter', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><div id="notice" role="status"></div><script src="/__queue_filter.js"></script>' }));
  await page.addInitScript(({ key }) => sessionStorage.setItem(key, JSON.stringify({ schemaVersion: 1, value: 'member-a' })), { key: queueFilterKey('a', 'tasks', 'member') });
  await page.goto('/__queue_filter');
  await expect(page.getByLabel('Member')).toHaveText('member-a');
  await page.getByRole('button', { name: 'Load members' }).click();
  await expect(page.getByLabel('Member')).toHaveText('member-a');
  await page.getByLabel('Query').fill('Account A queue');
  await page.getByLabel('Urgent').check();
  await page.getByRole('button', { name: 'Toggle twice' }).click();
  await expect(page.getByLabel('Urgent')).toBeChecked();
  await page.getByRole('button', { name: 'Account B' }).click();
  await expect(page.getByLabel('Query')).toHaveValue('');
  await expect(page.getByLabel('Member')).toHaveText('ALL');
  await expect(page.getByLabel('Urgent')).not.toBeChecked();
  await page.getByLabel('Query').fill('Account B queue');
  await page.getByRole('button', { name: 'Account A' }).click();
  await expect(page.getByLabel('Query')).toHaveValue('Account A queue');
  await page.getByRole('button', { name: 'Navigate' }).click();
  await page.getByRole('button', { name: 'Navigate' }).click();
  await expect(page.getByLabel('Query')).toHaveValue('Account A queue');
  await page.getByRole('button', { name: 'Remove member' }).click();
  await expect(page.getByLabel('Member')).toHaveText('ALL');
  await expect.poll(() => page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!).value, queueFilterKey('a', 'tasks', 'member'))).toBe('ALL');
  await page.getByRole('button', { name: 'Archive department' }).click();
  await expect(page.getByLabel('Department')).toHaveText('new-department');
});

test('a blocked browser store keeps filters usable and reports that they cannot be saved', async ({ page }) => {
  const bundle = await build({ entryPoints: ['tests/e2e/queue-filter-harness.tsx'], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"development"' } });
  await page.route('**/__queue_filter.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
  await page.route('**/__queue_filter', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><div id="notice" role="status"></div><script src="/__queue_filter.js"></script>' }));
  await page.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Browser storage disabled'); } }));
  await page.goto('/__queue_filter');
  await page.getByLabel('Query').fill('Still works');
  await expect(page.getByLabel('Query')).toHaveValue('Still works');
  await expect(page.locator('#notice')).toContainText('تعذر حفظ فلاتر القائمة');
  await page.getByLabel('Urgent').check();
  await expect(page.getByLabel('Urgent')).toBeChecked();
  await page.getByRole('button', { name: 'Account B' }).click();
  await expect(page.getByLabel('Query')).toHaveValue('');
  await expect(page.getByLabel('Urgent')).not.toBeChecked();
});

test('all four queues restore their filters after navigation and keep accounts separate', async ({ browser }) => {
  const { page, errors } = await signIn(browser, 'admin@akhbar.tv');
  const headers = { 'X-NRCS-Client': 'web' };
  const collections = async () => (await (await page.request.get('/api/v1/data')).json()).collections;
  const initial = await collections();
  const me = (await (await page.request.get('/api/v1/auth/me')).json()).user;
  const settings = initial.settings[0];
  const departments = departmentsOf(settings.d);
  const department = departments[0];
  const updateSettings = async (value: object) => {
    const current = (await collections()).settings[0];
    const response = await page.request.post('/api/v1/data/sync', { headers, data: { ops: [
      { c: 'settings', id: current.id, op: 'upsert', baseV: current.v, d: value },
    ] } });
    expect((await response.json()).results.every((result: { ok: boolean }) => result.ok)).toBe(true);
  };
  try {
    await updateSettings({ ...settings.d, departments: departments.map(item => item.id === department.id ? { ...item, headUserId: me.id } : item) });
    await page.reload();
    await openNav(page, 'التكليفات');
    await page.getByRole('tab', { name: /كل التكليفات/ }).click();
    await page.getByLabel('بحث في التكليفات').fill('قائمة التكليفات المحفوظة');
    await page.getByLabel('فترة التكليفات').selectOption('WEEK');
    await page.getByLabel('نوع المادة', { exact: true }).selectOption({ index: 1 });
    const kind = await page.getByLabel('نوع المادة', { exact: true }).inputValue();
    await openNav(page, 'الرئيسية');
    await openNav(page, 'التكليفات');
    await expect(page.getByLabel('بحث في التكليفات')).toHaveValue('قائمة التكليفات المحفوظة');
    await expect(page.getByLabel('فترة التكليفات')).toHaveValue('WEEK');
    await expect(page.getByLabel('نوع المادة', { exact: true })).toHaveValue(kind);

    await page.goto('/tasks');
    await page.getByLabel('بحث في المهام').fill('قائمة المهام المحفوظة');
    await page.getByLabel('الحالة:', { exact: true }).selectOption('BLOCKED');
    await page.getByLabel('الأولوية', { exact: true }).selectOption('HIGH');
    await page.getByLabel('موعد التسليم', { exact: true }).selectOption('MONTH');
    await page.getByLabel('متأخرة فقط', { exact: true }).check();
    const assignees = page.getByLabel('المسؤول', { exact: true });
    await assignees.selectOption({ index: 1 });
    const assignee = await assignees.inputValue();
    // A direct task link must be visible without clearing the saved queue.
    const taskId = initial.tasks.find((row: { d: { deletedAt?: string } }) => !row.d.deletedAt).id;
    await page.goto(`/tasks/${taskId}`);
    await expect(page.locator(`[data-task-id="${taskId}"]`)).toBeVisible();
    await page.goto('/tasks');
    await expect(page.getByLabel('بحث في المهام')).toHaveValue('قائمة المهام المحفوظة');
    await expect(page.getByLabel('الحالة:', { exact: true })).toHaveValue('BLOCKED');
    await expect(page.getByLabel('الأولوية', { exact: true })).toHaveValue('HIGH');
    await expect(assignees).toHaveValue(assignee);
    await expect(page.getByLabel('موعد التسليم', { exact: true })).toHaveValue('MONTH');
    await expect(page.getByLabel('متأخرة فقط', { exact: true })).toBeChecked();

    await page.goto('/requests');
    await page.getByLabel('بحث في الطلبات').fill('قائمة الطلبات المحفوظة');
    await page.getByLabel('القسم', { exact: true }).selectOption(department.id);
    await page.getByLabel('نوع الطلب', { exact: true }).selectOption({ index: 1 });
    const requestType = await page.getByLabel('نوع الطلب', { exact: true }).inputValue();
    await page.getByLabel('العاجلة فقط', { exact: true }).check();
    await page.getByLabel('عرض المنجز والمغلق').check();
    await openNav(page, 'الرئيسية');
    await page.goto('/requests');
    await expect(page.getByLabel('بحث في الطلبات')).toHaveValue('قائمة الطلبات المحفوظة');
    await expect(page.getByLabel('نوع الطلب', { exact: true })).toHaveValue(requestType);
    await expect(page.getByLabel('القسم', { exact: true })).toHaveValue(department.id);
    await expect(page.getByLabel('العاجلة فقط', { exact: true })).toBeChecked();
    await expect(page.getByLabel('عرض المنجز والمغلق')).toBeChecked();

    await page.goto('/workload');
    await expect(page.getByRole('heading', { name: 'أعمال فريقي' })).toBeVisible();
    await page.getByRole('combobox', { name: 'الموظف', exact: true }).selectOption({ index: 1 });
    const member = await page.getByRole('combobox', { name: 'الموظف', exact: true }).inputValue();
    await page.getByRole('combobox', { name: 'فترة التسليم', exact: true }).selectOption('WEEK');
    await page.getByLabel('بحث في أعمال فريقي').fill('قائمة القسم المحفوظة');
    await page.getByLabel('نوع العمل', { exact: true }).selectOption('task');
    await page.getByLabel('المتعطلة فقط').check();
    await openNav(page, 'الرئيسية');
    await page.goto('/workload');
    await expect(page.getByRole('combobox', { name: 'الموظف', exact: true })).toHaveValue(member);
    await expect(page.getByRole('combobox', { name: 'فترة التسليم', exact: true })).toHaveValue('WEEK');
    await expect(page.getByLabel('بحث في أعمال فريقي')).toHaveValue('قائمة القسم المحفوظة');
    await expect(page.getByLabel('نوع العمل', { exact: true })).toHaveValue('task');
    await expect(page.getByLabel('المتعطلة فقط')).toBeChecked();

    // Same tab and storage, but a different signed-in account.
    await page.goto('about:blank');
    await page.request.post('/api/v1/auth/logout', { headers });
    const login = await page.request.post('/api/v1/auth/login', { headers, data: { email: 'editor@akhbar.tv', password: DEMO_PASSWORD } });
    expect(login.ok()).toBe(true);
    await page.goto('/tasks');
    await expect(page.getByLabel('بحث في المهام')).toHaveValue('');
    await expect(page.getByLabel('الأولوية', { exact: true })).toHaveValue('ALL');
    await page.goto('/requests');
    await expect(page.getByLabel('بحث في الطلبات')).toHaveValue('');
    await page.goto('/cards');
    await page.getByRole('tab', { name: /كل التكليفات/ }).click();
    await expect(page.getByLabel('بحث في التكليفات')).toHaveValue('');
    expect(errors).toEqual([]);
  } finally {
    await page.goto('about:blank');
    await page.request.post('/api/v1/auth/logout', { headers });
    await page.request.post('/api/v1/auth/login', { headers, data: { email: 'admin@akhbar.tv', password: DEMO_PASSWORD } });
    await updateSettings(settings.d);
    await page.context().close();
  }
});
