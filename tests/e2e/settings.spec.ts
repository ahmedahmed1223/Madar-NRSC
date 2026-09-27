import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('administrators see what demo data is left and must confirm before removing it', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'admin@akhbar.tv');
  await openNav(page, 'الإعدادات');
  const card = page.getByTestId('demo-data-card');
  await expect(card).toContainText('أخبار');
  const remove = card.getByRole('button', { name: /حذف البيانات التجريبية/ });
  await expect(remove).toBeDisabled();
  await card.getByLabel('تأكيد الحذف').fill('حذف');
  await expect(remove).toBeEnabled();
  expect(errors).toEqual([]);
  await close();
});
