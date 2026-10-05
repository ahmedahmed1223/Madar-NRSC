import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('global search filters by record type and clears with focus restored', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'editor@akhbar.tv');
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'البحث الموحد' });
  const input = dialog.getByRole('combobox', { name: /بحث في الأخبار/ });
  await input.fill('ا');
  await expect(dialog.getByRole('listbox').getByRole('option').first()).toBeVisible();
  await dialog.getByLabel('نوع نتائج البحث').selectOption('الضيوف');
  await expect(dialog.getByRole('listbox').getByText('الضيوف', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('listbox').getByText('الأخبار', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'مسح البحث' }).click();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
  await close();
});
