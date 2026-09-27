import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('each colleague sets their own alerts: channels, watch words, quiet hours', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'journalist@akhbar.tv');
  await page.getByRole('button', { name: /^الإشعارات/ }).click();
  await page.getByRole('button', { name: 'ما يصلني على البريد والجوال' }).click();
  await expect(page.getByRole('heading', { name: 'تنبيهاتي' })).toBeVisible();
  await page.getByLabel('البرقيات العاجلة وكلمات المتابعة — الجهاز').check();
  await page.getByText('نبّهني فور وصول برقية عاجلة').click();
  await page.getByLabel('كلمة متابعة').fill('أوبك');
  await page.getByLabel('كلمة متابعة').press('Enter');
  await page.getByLabel('بداية ساعات الهدوء').fill('23:00');
  await page.getByLabel('نهاية ساعات الهدوء').fill('06:00');
  await page.getByRole('button', { name: 'حفظ الإعدادات' }).click();
  await expect(page.getByText('حُفظت إعدادات تنبيهاتك')).toBeVisible();
  // Saved on the server: still there after signing in again elsewhere.
  const again = await signIn(browser, 'journalist@akhbar.tv');
  await again.page.getByRole('button', { name: /^الإشعارات/ }).click();
  await again.page.getByRole('button', { name: 'ما يصلني على البريد والجوال' }).click();
  await expect(again.page.getByRole('button', { name: 'حذف أوبك' })).toBeVisible();
  await expect(again.page.getByLabel('بداية ساعات الهدوء')).toHaveValue('23:00');
  await again.close();
  expect(errors).toEqual([]);
  await close();
});
