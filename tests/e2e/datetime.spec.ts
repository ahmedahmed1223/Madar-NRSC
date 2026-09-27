import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('the sign-in screen shows the station clock and date', async ({ page }) => {
  await page.goto('/');
  const clock = page.getByRole('timer').first();
  await expect(clock).toBeVisible();
  await expect(clock).toContainText(/\d{2}:\d{2}/);
  await expect(clock).toContainText(/20\d\d/);
});

test('date and time are set once for the whole station and apply to everyone', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  await openNav(admin.page, 'الإعدادات');
  await admin.page.getByRole('navigation', { name: 'أقسام الإعدادات' }).getByRole('button', { name: /التاريخ والوقت/ }).click();
  await admin.page.getByRole('radio', { name: /توقيت المحطة الموحد/ }).click();
  await admin.page.getByRole('radio', { name: /12 ساعة/ }).click();
  await admin.page.getByRole('button', { name: 'حفظ للجميع' }).click();
  await expect(admin.page.getByText('حُفظت إعدادات التاريخ والوقت').first()).toBeVisible();
  await expect(admin.page.locator('header')).toContainText('بتوقيت المحطة');

  // Another colleague, another browser: the same conventions without doing anything.
  const editor = await signIn(browser, 'editor@akhbar.tv');
  await expect(editor.page.locator('header')).toContainText('بتوقيت المحطة');
  await expect(editor.page.locator('header')).toContainText(/[صم]/);

  // Back to the defaults so other tests see device time and a 24-hour clock.
  await admin.page.getByRole('button', { name: /الافتراضي/ }).click();
  await admin.page.getByRole('button', { name: 'حفظ للجميع' }).click();
  await expect(admin.page.locator('header')).not.toContainText('بتوقيت المحطة');
  expect([...admin.errors, ...editor.errors]).toEqual([]);
  await admin.close();
  await editor.close();
});
