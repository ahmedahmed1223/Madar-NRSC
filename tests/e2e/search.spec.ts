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

test('global search filters all matches before pagination and exposes remaining results', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'editor@akhbar.tv');
  await page.route('**/api/v1/data', async route => {
    const response = await route.fetch();
    const data = await response.json();
    const sample = data.collections.news[0];
    data.collections.news = Array.from({ length: 61 }, (_, index) => ({
      ...sample, id: `search-fixture-${index}`, d: { ...sample.d, id: `search-fixture-${index}`, title: `اختباربحث ${index}` },
    }));
    await route.fulfill({ response, json: data });
  });
  await page.reload();
  await expect(page.locator('main')).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'البحث الموحد' });
  await dialog.getByRole('combobox', { name: /بحث في الأخبار/ }).fill('اختباربحث');
  await dialog.getByLabel('نوع نتائج البحث').selectOption('الأخبار');
  await expect(dialog.getByRole('listbox').getByRole('option')).toHaveCount(40);
  await expect(dialog).toContainText('40 من 61 نتيجة');
  await dialog.getByRole('button', { name: /عرض المزيد من النتائج/ }).click();
  await expect(dialog.getByRole('combobox', { name: /بحث في الأخبار/ })).toBeFocused();
  await expect(dialog.getByRole('listbox').getByRole('option')).toHaveCount(61);
  await expect(dialog).toContainText('اختباربحث 60');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
  await close();
});
