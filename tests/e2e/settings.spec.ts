import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('administrators see what demo data is left and must confirm before removing it', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'admin@akhbar.tv');
  await openNav(page, 'الإعدادات');
  // Settings are grouped in sections; the choice is remembered.
  const sections = page.getByRole('navigation', { name: 'أقسام الإعدادات' });
  await sections.getByRole('button', { name: /الأقسام الصحفية/ }).click();
  await expect(page.getByText('الأقسام الصحفية وألوانها')).toBeVisible();
  await sections.getByRole('button', { name: /البيانات/ }).click();
  const card = page.getByTestId('demo-data-card');
  await expect(card).toContainText('أخبار');
  const remove = card.getByRole('button', { name: /حذف البيانات التجريبية/ });
  await expect(remove).toBeDisabled();
  await card.getByLabel('تأكيد الحذف').fill('حذف');
  await expect(remove).toBeEnabled();
  // Coming back to Settings opens the last section used.
  await openNav(page, 'الرئيسية');
  await openNav(page, 'الإعدادات');
  await expect(page.getByTestId('demo-data-card')).toBeVisible();
  expect(errors).toEqual([]);
  await close();
});
