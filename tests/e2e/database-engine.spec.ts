import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('an administrator can schedule a database switch and cancel it before restart', async ({ browser }) => {
  test.skip(!process.env.POSTGRES_URL, 'Requires a configured disposable PostgreSQL connection');
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  try {
    await page.goto('/database');
    const engine = page.getByLabel('المحرك بعد إعادة التشغيل');
    await expect(engine).toHaveValue('sqlite');
    await engine.selectOption('postgresql');
    await page.getByRole('button', { name: 'جدولة التبديل', exact: true }).click();
    const confirmation = page.getByRole('alertdialog', { name: 'الانتقال إلى PostgreSQL' });
    await expect(confirmation).toContainText('جلسات البث');
    await confirmation.getByRole('button', { name: 'أؤكد انتهاء البث وأجدول التبديل' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'مجدول لتشغيل الخادم القادم' })).toBeVisible();
    await page.getByRole('button', { name: 'إلغاء الجدولة' }).click();
    await expect(page.getByRole('button', { name: 'إلغاء الجدولة' })).toHaveCount(0);
    await expect(engine).toHaveValue('sqlite');
  } finally { await close(); }
});
