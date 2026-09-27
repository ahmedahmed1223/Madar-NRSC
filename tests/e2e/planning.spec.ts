import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('planning diary: the desk plans, the reporter is assigned and writes the story', async ({ browser }) => {
  const editor = await signIn(browser, 'editor@akhbar.tv');
  await openNav(editor.page, 'أجندة التغطية');
  await expect(editor.page.getByRole('heading', { name: 'أجندة التغطية' })).toBeVisible();
  await expect(editor.page.getByText('مؤتمر صحفي لوزير الطاقة').first()).toBeVisible();

  // A new event, assigned to the reporter.
  await editor.page.getByRole('button', { name: 'حدث جديد' }).click();
  const form = editor.page.locator('#form-page-root');
  await form.getByLabel('العنوان').fill('زيارة رئيس الوزراء لمحطة التحلية');
  await form.getByLabel('من (اختياري)').fill('10:30');
  await form.getByLabel('قرار التغطية').selectOption('COVER');
  await form.getByLabel('إضافة مكلف').selectOption('usr-6');
  await form.getByRole('button', { name: 'حفظ' }).click();
  await expect(editor.page.getByText('زيارة رئيس الوزراء لمحطة التحلية')).toBeVisible();

  const reporter = await signIn(browser, 'reporter@akhbar.tv');
  // My Work shows the coverage assignment, the bell has the notification.
  await expect(reporter.page.getByTestId('my-plan')).toContainText('زيارة رئيس الوزراء');
  await reporter.page.getByRole('button', { name: /الإشعارات|التنبيهات/ }).first().click();
  await expect(reporter.page.getByText(/تكليف بتغطية: زيارة رئيس الوزراء/)).toBeVisible();
  await reporter.page.getByText(/تكليف بتغطية: زيارة رئيس الوزراء/).click();
  // The link opens the entry; the reporter writes a story from it.
  const entry = reporter.page.locator('#form-page-root');
  await expect(entry.getByLabel('العنوان')).toHaveValue('زيارة رئيس الوزراء لمحطة التحلية');
  await expect(entry.getByLabel('العنوان')).toBeDisabled();
  await entry.getByRole('button', { name: 'كتابة خبر من الحدث' }).click();
  await expect(reporter.page.locator('input[value="زيارة رئيس الوزراء لمحطة التحلية"]').first()).toBeVisible();
  expect([...editor.errors, ...reporter.errors]).toEqual([]);
  await editor.close();
  await reporter.close();
});

test('resource booking: clashes are shown and refused, a free alternative is offered', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'journalist@akhbar.tv');
  await openNav(page, 'حجز الموارد');
  await expect(page.getByRole('heading', { name: 'حجز الموارد' })).toBeVisible();
  await expect(page.getByText('كاميرا ميدانية A').first()).toBeVisible();

  await page.getByRole('button', { name: 'حجز جديد' }).click();
  const form = page.locator('#form-page-root');
  await form.getByLabel('المورد').selectOption({ label: 'كاميرا ميدانية A' });
  await form.getByLabel('الغرض').fill('تصوير تقرير الأسواق');
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  // The demo booking holds camera A from 10:30 to 13:00.
  await form.getByLabel('من', { exact: true }).fill(`${today}T11:00`);
  await form.getByLabel('إلى', { exact: true }).fill(`${today}T12:00`);
  await expect(form.getByRole('alert')).toContainText('محجوز');
  await expect(form.getByRole('button', { name: 'احجز' })).toBeDisabled();
  await form.getByRole('button', { name: 'كاميرا ميدانية B' }).click();
  await expect(form.getByText(/متاح في هذا الوقت/)).toBeVisible();
  await form.getByRole('button', { name: 'احجز' }).click();
  await expect(page.getByText('تصوير تقرير الأسواق').first()).toBeVisible();
  expect(errors).toEqual([]);
  await close();
});
