import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('shows eligible recipients and saves task and production deadline reminders', async ({ browser }) => {
  test.setTimeout(90_000);
  const { page, errors, close } = await signIn(browser, 'editor@akhbar.tv');
  try {
    await openNav(page, 'المهام');
    await page.getByRole('button', { name: 'تكليف بمهمة', exact: true }).click();
    const task = page.getByRole('region', { name: 'إسناد وتكليف بمهمة صحفية' });
    const assignee = task.locator('#task-assignee-input');
    await expect(assignee.locator('option[value="usr-1"]')).toHaveCount(0);
    await assignee.selectOption('usr-6');
    await task.locator('#task-title-input').fill('إسناد تقرير بمواعيد تذكير');
    await task.locator('#task-due-date-input').fill('2030-06-12T10:00');
    await task.getByRole('combobox', { name: 'التذكير بالموعد' }).selectOption('60');
    await task.getByRole('checkbox', { name: 'تنبيه بعد تأخر الموعد بـ15 دقيقة' }).check();
    await task.getByRole('button', { name: 'حفظ المهمة', exact: true }).click();
    await expect(task).toHaveCount(0);

    await openNav(page, 'التكليفات');
    await page.getByRole('button', { name: 'تكليف حر', exact: true }).click();
    const card = page.getByRole('region', { name: 'تكليف حر جديد' });
    await expect(card.locator('#card-owner option[value="usr-1"]')).toHaveCount(0);
    await card.locator('#card-title').fill('تكليف إنتاج بمواعيد تذكير');
    await card.locator('#card-due').fill('2030-06-13T10:00');
    await card.getByRole('combobox', { name: 'التذكير بالموعد' }).selectOption('15');
    await card.getByRole('button', { name: 'إنشاء التكليف', exact: true }).click();
    await expect(card).toHaveCount(0);

    const { collections } = await (await page.request.get('/api/v1/data')).json();
    const dataOf = (collection: string, title: string) => collections[collection].find((row: { d: { title: string } }) => row.d.title === title)?.d;
    expect(dataOf('tasks', 'إسناد تقرير بمواعيد تذكير')).toMatchObject({ assigneeId: 'usr-6', reminderOptions: { leadMinutes: 60, overdue: true } });
    expect(dataOf('productionCards', 'تكليف إنتاج بمواعيد تذكير')).toMatchObject({ reminderOptions: { leadMinutes: 15 } });
    expect(errors).toEqual([]);
  } finally {
    await close();
  }
});
