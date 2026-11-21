import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD, openNav, signIn } from './helpers';

test('a private mobile task syncs and its reminder opens the task from a new session', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const title = 'مراجعة الموعد الشخصي قبل المناوبة';
  const notes = 'ملاحظات خاصة بحساب صاحب المهمة';
  const first = await signIn(browser, 'reporter@akhbar.tv', { viewport: { width: 375, height: 812 } });
  const { page } = first;
  await openNav(page, 'مهامي الشخصية');
  await expect(page).toHaveURL(/\/personal-tasks$/);
  await page.getByRole('button', { name: 'مهمة شخصية جديدة' }).click();
  const form = page.getByRole('region', { name: 'مهمة شخصية جديدة' });
  await form.getByLabel('عنوان المهمة').fill(title);
  await form.getByLabel('ملاحظات').fill(notes);
  await form.getByRole('textbox', { name: 'موعد المهمة', exact: true }).fill('2030-06-12T10:00');
  await form.getByRole('combobox', { name: 'التذكير', exact: true }).selectOption('custom');
  await form.getByRole('textbox', { name: 'موعد التذكير', exact: true }).fill('2020-06-12T09:00');
  await form.getByRole('button', { name: 'حفظ المهمة' }).click();
  await expect(page.getByText('حُفظت المهمة الشخصية.')).toBeVisible();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
  const data = await (await page.request.get('/api/v1/data')).json();
  const task = data.collections.personalTasks.find((row: { d: { title: string } }) => row.d.title === title);
  expect(task).toBeDefined();
  expect(first.errors).toEqual([]);
  await first.close();

  // Wait for the server's reminder job with the user's browser closed.
  const login = await request.post('/api/v1/auth/login', {
    headers: { 'X-NRCS-Client': 'web' },
    data: { email: 'reporter@akhbar.tv', password: DEMO_PASSWORD },
  });
  expect(login.ok()).toBe(true);
  await expect.poll(async () => {
    const response = await request.get('/api/v1/data');
    const synced = await response.json();
    return synced.collections.notifications.filter((row: { d: { linkUrl: string } }) => row.d.linkUrl === `/personal-tasks/${task.id}`).length;
  }, { timeout: 45_000 }).toBe(1);

  const second = await signIn(browser, 'reporter@akhbar.tv');
  try {
    await second.page.getByRole('button', { name: /^الإشعارات/ }).click();
    await second.page.getByRole('button', { name: 'تذكير بمهمة شخصية', exact: true }).click();
    await expect(second.page).toHaveURL(new RegExp(`/personal-tasks/${task.id}$`));
    await expect(second.page.getByText(notes)).toBeVisible();
    await second.page.getByRole('button', { name: 'عرض كل مهامي' }).click();
    await second.page.getByRole('button', { name: 'إكمال', exact: true }).click();
    await second.page.getByRole('tab', { name: 'مكتملة' }).click();
    await expect(second.page.getByRole('button', { name: title, exact: true })).toBeVisible();
    await second.page.getByRole('button', { name: 'إعادة فتح' }).click();
    await second.page.getByRole('tab', { name: 'مفتوحة' }).click();
    await expect(second.page.getByRole('button', { name: title, exact: true })).toBeVisible();
    expect(second.errors).toEqual([]);
  } finally {
    await second.close();
  }

  const other = await signIn(browser, 'admin@akhbar.tv');
  try {
    await other.page.goto(`/personal-tasks/${task.id}`);
    await expect(other.page.getByText('هذه المهمة غير متاحة في حسابك.')).toBeVisible();
    await expect(other.page.getByText(notes)).toHaveCount(0);
    expect(other.errors).toEqual([]);
  } finally {
    await other.close();
  }
});
