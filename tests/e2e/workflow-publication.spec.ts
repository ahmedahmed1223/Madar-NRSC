import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('publishes a workflow draft and restores an earlier version as a new release', async ({ browser }) => {
  const { page, close, errors } = await signIn(browser, 'admin@akhbar.tv');
  const name = 'قالب النشرة للعمل المتوازي';
  try {
    await page.goto('/cards');
    await page.getByText('القوالب', { exact: true }).first().click();
    const templates = page.getByRole('region', { name: 'قوالب سير العمل' });
    const row = templates.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await templates.getByRole('button', { name: 'قالب جديد' }).click();
    await page.locator('#tpl-name').fill(name);
    await page.getByRole('button', { name: 'إضافة مهمة' }).click();
    const diagram = page.getByRole('region', { name: 'مخطط سير العمل' });
    await expect(diagram.getByRole('button', { name: /^قدّم/ })).toHaveCount(2);
    await diagram.getByRole('button', { name: /^قدّم/ }).last().click();
    await page.getByRole('button', { name: 'حفظ المسودة', exact: true }).click();
    await expect(row.getByText('مسودة غير منشورة')).toBeVisible();
    await expect(row.getByRole('button', { name: 'إنشاء تكليف' })).toHaveCount(0);
    const publishAndCheck = async (version: number) => {
      await page.getByRole('button', { name: 'نشر إصدار القالب' }).click();
      await expect(row.getByText(new RegExp('الإصدار المنشور ' + version))).toBeVisible();
      await expect(row.getByRole('button', { name: 'إنشاء تكليف' })).toBeVisible();
    };
    await row.getByRole('button', { name: 'تعديل' }).click();
    await publishAndCheck(1);
    await row.getByRole('button', { name: 'تعديل' }).click();
    await page.getByRole('button', { name: 'إضافة مهمة' }).click();
    await publishAndCheck(2);
    await row.getByRole('button', { name: 'تعديل' }).click();
    await page.getByRole('region', { name: 'سجل إصدارات القالب' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'تحميل الإصدار 1 إلى المسودة' }).click();
    await expect(diagram.getByRole('button', { name: /^قدّم/ })).toHaveCount(2);
    await publishAndCheck(3);
    expect(errors).toEqual([]);
  } finally {
    await close();
  }
});
