import { expect, test, type Page } from '@playwright/test';
import { denyLegacyCopy, embed, fitsViewport, headers, pastedText, selectPersonalStatus, sync } from './work-controls-helpers';
import { DEMO_PASSWORD, enterWorkspace } from './helpers';

// Use the configured page/context fixtures: signIn() creates its own context and
// would silently discard this matrix's viewport, locale and device timezone.
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const login = await page.request.post('/api/v1/auth/login', {
    headers, data: { email: 'admin@akhbar.tv', password: DEMO_PASSWORD },
  });
  expect(login.ok()).toBe(true);
  await page.reload();
  await enterWorkspace(page);
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
});

test('Arabic note copy survives a restricted embed; search intersects pinned-only', async ({ page }) => {
  const prefix = `note-${test.info().project.name}`;
  const body = 'ملخّص عربي: متابعة النشرة\nالساعة ٠٩:٣٠ — اتصال بالمراسل';
  await sync(page, [
    { c: 'personalNotes', op: 'upsert', id: `${prefix}-1`, d: { title: `${prefix} مثبتة`, body, pinned: true } },
    { c: 'personalNotes', op: 'upsert', id: `${prefix}-2`, d: { title: `${prefix} أخرى`, body: 'نفس البحث', pinned: false } },
    { c: 'personalNotes', op: 'upsert', id: `${prefix}-3`, d: { title: 'ملاحظة خارج البحث', body: 'محتوى آخر', pinned: true } },
  ]);
  const app = await embed(page, '/personal-notes');
  const search = app.getByRole('searchbox', { name: 'بحث في ملاحظاتي' });
  await search.fill(prefix);
  await app.getByRole('checkbox', { name: 'المثبتة فقط' }).check();
  await expect(app.getByText(`${prefix} أخرى`, { exact: true })).toHaveCount(0);
  await expect(app.getByText('ملاحظة خارج البحث', { exact: true })).toHaveCount(0);
  const copy = app.getByRole('button', { name: `نسخ ${prefix} مثبتة`, exact: true });
  await copy.click();
  await expect(app.getByRole('status').filter({ hasText: 'نُسخ محتوى الملاحظة.' })).toBeVisible();
  await expect(copy).toBeFocused();
  await expect(app.locator('textarea[aria-hidden="true"]')).toHaveCount(0);
  await expect(await pastedText(page)).toHaveValue(`${prefix} مثبتة\n\n${body}`);
  await search.fill('');
  await app.getByRole('checkbox', { name: 'المثبتة فقط' }).uncheck();
  await expect(app.getByText(`${prefix} أخرى`, { exact: true })).toBeVisible();
  await fitsViewport(app);
  await denyLegacyCopy(app);
  await copy.click();
  await expect(app.getByRole('alert')).toContainText('تعذّر النسخ إلى الحافظة.');
  await expect(copy).toBeFocused();
  await expect(app.locator('textarea[aria-hidden="true"]')).toHaveCount(0);
});

test('personal task copy and combined open/overdue/search filters in a restricted embed', async ({ page }) => {
  const prefix = `personal-${test.info().project.name}`;
  await sync(page, [
    { c: 'personalTasks', op: 'upsert', id: `${prefix}-1`, d: { title: `${prefix} متأخرة`, notes: 'نص عربي متعدد\nالأسطر ١٢٣', completed: false, dueAt: '2020-01-01T06:00:00.000Z', reminderAt: null } },
    { c: 'personalTasks', op: 'upsert', id: `${prefix}-2`, d: { title: `${prefix} لاحقة`, notes: '', completed: false, dueAt: '2099-01-01T06:00:00.000Z', reminderAt: null } },
    { c: 'personalTasks', op: 'upsert', id: `${prefix}-3`, d: { title: `${prefix} مكتملة`, notes: '', completed: true, dueAt: '2020-01-01T06:00:00.000Z', reminderAt: null } },
  ]);
  const app = await embed(page, '/personal-tasks');
  await app.getByRole('searchbox', { name: 'بحث في المهام الشخصية' }).fill(prefix);
  await app.getByRole('checkbox', { name: 'متأخرة فقط' }).check();
  const list = app.getByRole('list', { name: 'قائمة المهام الشخصية' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  const copy = app.getByRole('button', { name: `نسخ ${prefix} متأخرة`, exact: true });
  await copy.click();
  await expect(app.getByRole('status').filter({ hasText: 'نُسخت المهمة إلى الحافظة.' })).toBeVisible();
  await expect(copy).toBeFocused();
  const pasted = await pastedText(page);
  await expect(pasted).toHaveValue(new RegExp(`^${prefix} متأخرة\\nنص عربي متعدد\\nالأسطر ١٢٣\\nالموعد: .+`));
  await selectPersonalStatus(app, 'DONE', 'مكتملة');
  await expect(list).toHaveCount(0);
  await app.getByRole('checkbox', { name: 'متأخرة فقط' }).uncheck();
  await expect(app.getByRole('button', { name: `${prefix} مكتملة`, exact: true })).toBeVisible();
  await selectPersonalStatus(app, 'ALL', 'الكل');
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await app.getByRole('searchbox', { name: 'بحث في المهام الشخصية' }).fill('');
  await fitsViewport(app);
  await denyLegacyCopy(app);
  await copy.click();
  await expect(app.getByRole('alert')).toContainText('تعذّر النسخ إلى الحافظة.');
});

test('team tasks intersect every filter and reset restores excluded records', async ({ page }) => {
  const data = (await (await page.request.get('/api/v1/data')).json()).collections;
  const me = data.users.find((row: any) => row.d.email === 'admin@akhbar.tv').id;
  const other = data.users.find((row: any) => row.d.email === 'editor@akhbar.tv').id;
  const prefix = `team-${test.info().project.name}`;
  const sample = data.tasks[0].d;
  await sync(page, [
    ['match', { assigneeId: me }],
    ['priority', { assigneeId: me, priority: 'LOW' }],
    ['status', { assigneeId: me, status: 'COMPLETED' }],
    ['assignee', { assigneeId: other }],
    ['future', { assigneeId: me, dueDate: '2099-01-01T06:00:00.000Z' }],
    ['query', { assigneeId: me, title: 'مهمة خارج البحث', description: '' }],
  ].map(([id, overrides]) => ({
    c: 'tasks', op: 'upsert', id: `${prefix}-${id}`,
    d: { ...sample, id: `${prefix}-${id}`, title: `${prefix} ${id}`, status: 'TODO', priority: 'HIGH',
      dueDate: '2020-01-01T06:00:00.000Z', creatorId: me, ...overrides as object },
  })));
  await page.goto('/tasks');
  await page.getByRole('searchbox', { name: 'بحث في المهام', exact: true }).fill(prefix);
  await page.locator('#tasks-status-filter').selectOption('TODO');
  await page.getByRole('combobox', { name: 'الأولوية', exact: true }).selectOption('HIGH');
  await page.getByRole('combobox', { name: 'المسؤول', exact: true }).selectOption(me);
  await page.getByRole('checkbox', { name: 'متأخرة فقط' }).check();
  await page.locator('#tasks-period').selectOption('TODAY');
  await page.getByRole('checkbox', { name: 'مهامي فقط', exact: true }).check();
  await expect(page.getByRole('button', { name: `تعديل المهمة: ${prefix} match`, exact: true })).toBeVisible();
  for (const id of ['priority', 'status', 'assignee', 'future']) {
    await expect(page.getByRole('button', { name: `تعديل المهمة: ${prefix} ${id}`, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: 'تعديل المهمة: مهمة خارج البحث', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'إعادة ضبط الفلاتر', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'بحث في المهام', exact: true })).toHaveValue('');
  for (const id of ['tasks-status-filter', 'tasks-priority-filter', 'tasks-assignee-filter', 'tasks-period']) {
    await expect(page.locator(`#${id}`)).toHaveValue('ALL');
  }
  await expect(page.getByRole('checkbox', { name: 'متأخرة فقط' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'مهامي فقط', exact: true })).not.toBeChecked();
  for (const id of ['priority', 'assignee', 'future']) {
    await expect(page.getByRole('button', { name: `تعديل المهمة: ${prefix} ${id}`, exact: true })).toBeVisible();
  }
  await fitsViewport(page);
});

test('handover copy contains only the selected department in a restricted embed', async ({ page }) => {
  const prefix = `handover-${test.info().project.name}`;
  const me = (await (await page.request.get('/api/v1/auth/me')).json()).user;
  const roster = (await (await page.request.get('/api/v1/data')).json()).collections.roster;
  await sync(page, ['newsroom', 'production'].map(departmentId => ({
    c: 'roster', op: 'upsert', id: `2026-10-11:${departmentId}:MORNING:${me.id}`,
    baseV: roster.find((row: any) => row.id === `2026-10-11:${departmentId}:MORNING:${me.id}`)?.v,
    d: { departmentId, date: '2026-10-11', shift: 'MORNING', userId: me.id, userName: me.fullName },
  })));
  for (const [departmentId, suffix] of [['newsroom', 'الأخبار'], ['production', 'الإنتاج']]) {
    const response = await page.request.post('/api/v1/shift-handovers', { headers, data: {
      id: `${prefix}-${departmentId}`, schemaVersion: 1, departmentId,
      sourceDate: '2026-10-11', sourceShift: 'MORNING', recipientDate: '2026-10-12',
      recipientShift: 'EVENING', title: `${prefix} ${suffix}`, note: `متابعة قسم ${suffix}\nالتأكد من النص العربي`, references: [],
    } });
    expect(response.ok(), await response.text()).toBe(true);
  }
  const app = await embed(page, '/roster/handover');
  await app.getByRole('combobox', { name: 'تصفية تسليم الوردية بالقسم' }).selectOption('newsroom');
  await expect(app.getByRole('button', { name: `${prefix} الأخبار`, exact: true })).toBeVisible();
  await expect(app.getByRole('button', { name: `${prefix} الإنتاج`, exact: true })).toHaveCount(0);
  const copy = app.getByRole('button', { name: 'نسخ الملخص', exact: true });
  await copy.click();
  await expect(app.getByRole('status').filter({ hasText: 'نُسخ ملخص التسليم.' })).toBeVisible();
  await expect(copy).toBeFocused();
  const pasted = await pastedText(page);
  await expect(pasted).toHaveValue(new RegExp(`${prefix} الأخبار\\n.+\\n2026-10-12 · .+\\nمتابعة قسم الأخبار\\nالتأكد من النص العربي`));
  expect(await pasted.inputValue()).not.toContain(`${prefix} الإنتاج`);
  await app.getByRole('combobox', { name: 'تصفية تسليم الوردية بالقسم' }).selectOption('ALL');
  await expect(app.getByRole('button', { name: `${prefix} الإنتاج`, exact: true })).toBeVisible();
  await fitsViewport(app);
  // The detail action must copy just the selected handover, not the whole list.
  await app.getByRole('button', { name: `${prefix} الإنتاج`, exact: true }).click();
  const detailCopy = app.getByRole('button', { name: 'نسخ ملخص التسليم', exact: true });
  await detailCopy.click();
  await expect(app.getByRole('status').filter({ hasText: 'نُسخ ملخص التسليم.' })).toBeVisible();
  expect(await (await pastedText(page)).inputValue()).not.toContain(`${prefix} الأخبار`);
  await expect(await pastedText(page)).toHaveValue(new RegExp(`${prefix} الإنتاج\\n`));
  await denyLegacyCopy(app);
  await detailCopy.click();
  await expect(app.getByRole('status').filter({ hasText: 'تعذّر نسخ ملخص التسليم.' })).toBeVisible();
});

for (const scenario of [
  { name: 'station ahead of device at midnight', basis: 'station', zone: 'Asia/Riyadh', now: '2030-06-12T22:30:00Z', input: '2030-06-14T09:00', saved: '2030-06-14T06:00:00.000Z' },
  { name: 'device day differs from station', basis: 'device', zone: 'Asia/Riyadh', now: '2030-06-12T22:30:00Z', input: '2030-06-13T09:00', saved: '2030-06-13T16:00:00.000Z' },
  { name: 'station crosses daylight saving', basis: 'station', zone: 'America/New_York', now: '2030-03-09T23:30:00Z', input: '2030-03-10T09:00', saved: '2030-03-10T13:00:00.000Z' },
]) test(`tomorrow 09:00 round-trips through the rendered form: ${scenario.name}`, async ({ page }) => {
  const settings = (await (await page.request.get('/api/v1/data')).json()).collections.settings[0];
  try {
    await sync(page, [{ c: 'settings', op: 'upsert', id: settings.id, baseV: settings.v,
      d: { ...settings.d, defaultTimezone: scenario.zone, dateTime: { ...settings.d.dateTime, timeBasis: scenario.basis } } }]);
    await page.clock.setFixedTime(new Date(scenario.now));
    await page.goto('/personal-tasks');
    await page.getByRole('button', { name: 'مهمة شخصية جديدة', exact: true }).click();
    const form = page.getByRole('region', { name: 'مهمة شخصية جديدة' });
    const title = `غداً-${test.info().project.name}-${scenario.basis}-${scenario.zone}`;
    await form.getByLabel('عنوان المهمة').fill(title);
    await form.getByRole('button', { name: 'غداً 9:00', exact: true }).click();
    await expect(form.locator('input[type="datetime-local"]')).toHaveValue(scenario.input);
    await form.getByRole('combobox', { name: 'التذكير', exact: true }).selectOption('due');
    await fitsViewport(page);
    await form.getByRole('button', { name: 'حفظ المهمة', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'حُفظت المهمة الشخصية.' })).toBeVisible();
    const rows = (await (await page.request.get('/api/v1/data')).json()).collections.personalTasks;
    const saved = rows.find((row: any) => row.d.title === title);
    expect(saved.d).toMatchObject({ dueAt: scenario.saved, reminderAt: scenario.saved });
    const row = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: title, exact: true }) });
    await expect(row.locator('time')).toHaveCount(2);
    await expect(row.locator('time').first()).toHaveAttribute('datetime', scenario.saved);
    await expect(row.locator('time').first()).toContainText('09:00');
    await page.reload();
    await page.getByRole('button', { name: title, exact: true }).click();
    await expect(page.locator('#form-page-root input[type="datetime-local"]')).toHaveValue(scenario.input);
  } finally {
    const current = (await (await page.request.get('/api/v1/data')).json()).collections.settings[0];
    await sync(page, [{ c: 'settings', op: 'upsert', id: current.id, baseV: current.v, d: settings.d }]);
  }
});
