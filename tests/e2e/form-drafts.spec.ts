import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

const forms = [
  { screen: 'الضيوف', button: 'إضافة ضيف جديد', field: '#guest-fullname-input', collection: 'guests' },
  { screen: 'البرامج', button: 'إضافة برنامج جديد', field: '#program-name-input', collection: 'programs' },
  { screen: 'التغطيات', button: 'إنشاء تغطية / قصة جديدة', field: '#stories-view-field-1', collection: 'stories' },
  { screen: 'الحلقات', button: 'إعداد حلقة جديدة', field: '#episode-title-input', collection: 'episodes' },
];

for (const form of forms) {
  test(`${form.collection}: unsaved fields survive Back and reload without creating a server record`, async ({ browser }) => {
    const { page, errors, close } = await signIn(browser, 'producer@akhbar.tv');
    await openNav(page, form.screen);
    const marker = `مسودة اختبار ${form.collection}`;
    const before = await (await page.request.get('/api/v1/data')).json();
    const ids = before.collections[form.collection].map((row: any) => row.id).sort();
    await page.getByRole('button', { name: form.button, exact: true }).click();
    await page.locator(form.field).fill(marker);
    await page.goBack();
    await page.getByRole('button', { name: form.button, exact: true }).click();
    await expect(page.locator(form.field)).toHaveValue(marker);
    await page.reload();
    await page.getByRole('button', { name: form.button, exact: true }).click();
    await expect(page.locator(form.field)).toHaveValue(marker);
    const after = await (await page.request.get('/api/v1/data')).json();
    expect(after.collections[form.collection].map((row: any) => row.id).sort()).toEqual(ids);
    expect(errors).toEqual([]);
    await close();
  });
}

test('failed local recovery storage warns before leaving and can keep the draft open', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'المهام');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('madar-form-draft:')) throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'تكليف بمهمة', exact: true }).click();
  await page.locator('#task-title-input').fill('تغييرات يجب حمايتها عند تعذر التخزين');
  await expect(page.getByRole('alert').filter({ hasText: 'تعذر حفظ نسخة الاستعادة' })).toBeVisible();
  await page.locator('#form-page-root').getByRole('button', { name: 'رجوع', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'تغييرات غير محفوظة' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'البقاء', exact: true }).click();
  await expect(page.locator('#task-title-input')).toHaveValue('تغييرات يجب حمايتها عند تعذر التخزين');
  await page.locator('#form-page-root').getByRole('button', { name: 'رجوع', exact: true }).click();
  await dialog.getByRole('button', { name: 'مغادرة دون حفظ', exact: true }).click();
  await expect(page.locator('#task-title-input')).toHaveCount(0);
  expect(errors).toEqual([]);
  await close();
});
