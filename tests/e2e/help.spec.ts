import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('help exposes comprehensive guides and searches full article contents', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'producer@akhbar.tv');
  await openNav(page, 'المساعدة');
  const nav = page.getByRole('navigation', { name: 'موضوعات المساعدة' });
  await expect(nav.getByRole('button')).toHaveCount(32);
  for (const title of ['دليل الأدوار والصلاحيات', 'حماية المسودات والتحديث العرضي',
    'جدول البث والتقويم', 'العمل الجماعي وتسليم الورديات', 'حل المشكلات والأسئلة الشائعة',
    'أمان الحساب وحماية المحتوى', 'التقارير وسجل التدقيق وحالة النظام']) {
    await nav.getByRole('button').filter({ hasText: title }).click();
    await expect(page.getByRole('article').getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  await page.getByRole('searchbox', { name: 'بحث في المساعدة' }).fill('تحديث عرضي');
  await expect(nav.getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('article')).toContainText('افتح النموذج نفسه بالحساب نفسه');
  await page.getByRole('searchbox', { name: 'بحث في المساعدة' }).fill('لايوجدهذاالموضوع');
  await expect(page.getByText('لا توجد نتائج. جرّب كلمات أخرى.')).toBeVisible();
  expect(errors).toEqual([]);
  await close();
});

test('help keeps recovery guidance readable on a phone and filters by department', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'producer@akhbar.tv', {
    viewport: { width: 390, height: 844 },
  });
  await openNav(page, 'المساعدة');
  await page.getByRole('checkbox', { name: 'ما يخص قسمي فقط' }).check();
  const nav = page.getByRole('navigation', { name: 'موضوعات المساعدة' });
  await expect(nav.getByRole('button').filter({ hasText: 'كتابة خبر وإرساله للمراجعة' })).toHaveCount(0);
  await nav.getByRole('button').filter({ hasText: 'حماية المسودات والتحديث العرضي' }).click();
  await expect(page.getByRole('article')).toContainText('هذه ليست نسخة احتياطية مؤسسية');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/help-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
  await close();
});
