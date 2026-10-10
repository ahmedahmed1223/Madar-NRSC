import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

for (const width of [390, 1440]) {
test(`stores a bounded item anchor and restores its list without selection (${width}px)`, async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv', { viewport: { width, height: 900 } });
  await openNav(page, 'الأخبار');
  const data = await (await page.request.get('/api/v1/data')).json();
  const editor = data.collections.users.find((row: any) => row.d.email === 'editor@akhbar.tv').id;
  await page.getByRole('checkbox', { name: /^تحديد الخبر:/ }).first().check();
  const row = page.locator('tr').filter({ has: page.locator('button[title="تحرير الخبر"]') }).first();
  await row.locator('button[title="تحرير الخبر"]').click();
  const context = await page.evaluate(user => JSON.parse(sessionStorage.getItem(`nrcs_news_context:${user}:ALL`) || '{}'), editor);
  expect(context.schemaVersion).toBe(1);
  expect(context.anchorId).toBeTruthy();
  expect(context).not.toHaveProperty('selectedIds');
  expect(context).not.toHaveProperty('body');
  await openNav(page, 'الأخبار');
  await expect(page.getByRole('checkbox', { name: /^تحديد الخبر:/ }).first()).not.toBeChecked();
  await close();
});

test(`missing references remain visible without broadening results (${width}px)`, async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv', { viewport: { width, height: 900 } });
  const data = await (await page.request.get('/api/v1/data')).json();
  const editor = data.collections.users.find((row: any) => row.d.email === 'editor@akhbar.tv').id;
  await page.evaluate(user => sessionStorage.setItem(`nrcs_news_context:${user}:ALL`, JSON.stringify({ schemaVersion: 1, definition: { selectedCategory: 'missing-category', authorId: 'missing-author' }, page: 99999, anchorId: 'deleted-anchor' })), editor);
  await openNav(page, 'الأخبار');
  await expect(page.getByRole('button', { name: 'إزالة القسم غير المتاح' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'إزالة الكاتب غير المتاح' })).toBeVisible();
  await expect(page.getByText('لا توجد أخبار مطابقة للتصنيف أو معايير البحث المحددة.')).toBeVisible();
  await page.getByRole('button', { name: 'إزالة القسم غير المتاح' }).click();
  await expect(page.getByRole('button', { name: 'إزالة الكاتب غير المتاح' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await close();
});
}
