import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('news filters and bulk cancellation keep the workflow predictable', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'الأخبار');
  const search = page.getByRole('searchbox', { name: 'البحث في الأخبار' });
  await search.fill('القمة');
  await page.getByRole('button', { name: 'مسح البحث', exact: true }).click();
  await expect(search).toBeFocused();
  await page.getByRole('checkbox', { name: 'أخباري فقط' }).check();
  await expect(page.getByRole('checkbox', { name: 'أخباري فقط' })).toBeChecked();
  await page.getByRole('button', { name: 'إعادة تعيين الفلاتر' }).click();
  await expect(page.getByRole('checkbox', { name: 'أخباري فقط' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: /^تحديد الخبر:/ }).first().click();
  const before = await (await page.request.get('/api/v1/data')).json();
  await page.getByRole('button', { name: 'حذف المحدد', exact: true }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'إلغاء', exact: true }).click();
  const after = await (await page.request.get('/api/v1/data')).json();
  expect(after.collections.news).toEqual(before.collections.news);
  await page.getByRole('button', { name: 'إلغاء تحديد الأخبار' }).click();
  await expect(page.getByRole('button', { name: 'حذف المحدد', exact: true })).toHaveCount(0);
  await close();
});

test('producer can see and switch all preparation steps on mobile and desktop', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'producer@akhbar.tv', { viewport: { width: 390, height: 844 } });
  await openNav(page, 'الحلقات');
  await page.getByRole('button', { name: /^فتح(?: مساحة العمل)?$/ }).last().click();
  const steps = page.getByRole('navigation', { name: 'خطوات إعداد الحلقة' });
  await expect(steps.getByRole('button')).toHaveCount(6);
  for (const button of await steps.getByRole('button').all()) {
    const rect = await button.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(391);
  }
  await steps.getByRole('button', { name: 'سكريبت المقدمة والأوتوكيو' }).click();
  await expect(steps.getByRole('button', { name: 'سكريبت المقدمة والأوتوكيو' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#intro-script-textarea')).toBeVisible();
  await page.screenshot({ path: 'test-results/producer-workspace-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(steps.getByRole('button', { name: 'سكريبت المقدمة والأوتوكيو' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/producer-workspace-desktop.png', fullPage: true });
  await close();
});

test('capture newsroom list and editor on desktop and mobile', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'الأخبار');
  await page.screenshot({ path: 'test-results/news-list-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('aside')).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(async () => (await page.locator('aside').boundingBox())!.x).toBeGreaterThanOrEqual(390);
  await page.screenshot({ path: 'test-results/news-list-mobile.png' });
  await page.locator('button[title="تحرير الخبر"]').first().click();
  await expect(page.locator('#news-headline-input')).toBeVisible();
  expect((await page.locator('#news-headline-input').boundingBox())!.y).toBeLessThan(600);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const tools = page.locator('details', { hasText: 'أدوات الخبر' });
  await expect(tools).not.toHaveAttribute('open');
  await tools.locator('summary').click();
  await expect(page.getByRole('button', { name: 'المساعد الذكي', exact: true })).toBeVisible();
  await tools.locator('summary').click();
  await page.screenshot({ path: 'test-results/news-editor-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'test-results/news-editor-desktop.png' });
  const review = page.getByRole('button', { name: 'إرسال للمراجعة والتدقيق', exact: true });
  if (await review.count()) {
    await review.click();
    const dialog = page.getByRole('dialog', { name: /نقل الخبر إلى/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('ملاحظات المراجعة (اختيارية)')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(review).toBeFocused();
  }
  await close();
});
