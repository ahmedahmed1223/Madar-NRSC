import { expect, test } from '@playwright/test';
import { signIn, openNav } from './helpers';
test.use({ actionTimeout: 10_000 });

test('settings manages independent people and studios and preserves failed form input', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  const name = `مذيع مستقل ${Date.now()}`;
  try {
    await openNav(page, 'الإعدادات');
    await page.getByRole('button', { name: /قوائم الإنتاج/ }).click();
    await page.getByRole('button', { name: 'إضافة اسم', exact: true }).click();
    const form = page.getByRole('form', { name: 'بيانات اسم الإنتاج' });
    await form.getByLabel('الاسم', { exact: true }).fill(name);
    await form.getByLabel('مخرج', { exact: true }).check();
    await form.getByRole('button', { name: 'حفظ', exact: true }).click();
    await expect(form).not.toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: `تعديل ${name}`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: `تعديل ${name}`, exact: true }).click();
    await page.getByLabel('نشط', { exact: true }).uncheck();
    await page.getByRole('form', { name: 'بيانات اسم الإنتاج' }).getByRole('button', { name: 'حفظ', exact: true }).click();
    await expect(page.getByRole('form', { name: 'بيانات اسم الإنتاج' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: `تعديل ${name}`, exact: true })).toHaveCount(0);
    await page.getByLabel('عرض الأسماء المعطلة', { exact: true }).check();
    await expect(page.getByRole('button', { name: `تعديل ${name}`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'إضافة اسم', exact: true }).click();
    await form.getByLabel('الاسم', { exact: true }).fill(name);
    await form.getByRole('button', { name: 'حفظ', exact: true }).click();
    await expect(form.getByRole('alert')).toContainText('الاسم موجود');
    await expect(form.getByLabel('الاسم', { exact: true })).toHaveValue(name);
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'الاستديوهات', exact: true }).click();
    await page.getByRole('button', { name: 'إضافة استديو', exact: true }).click();
    const studio = page.getByRole('form', { name: 'بيانات الاستديو' });
    await studio.getByLabel('الاسم', { exact: true }).fill(`استديو جديد ${Date.now()}`);
    await studio.getByLabel('الموقع', { exact: true }).fill('الطابق الثاني');
    await studio.getByRole('button', { name: 'حفظ', exact: true }).click();
    await expect(studio).not.toBeVisible();
  } finally { await close(); }
});
