import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('connection feedback remains in layout on desktop and mobile without claiming every field is saved', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'producer@akhbar.tv');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    if (width < 768 && await page.locator('aside').getAttribute('aria-hidden') !== 'true') {
      await page.getByTitle('إغلاق القائمة', { exact: true }).click();
      await expect.poll(async () => (await page.locator('aside').boundingBox())?.x ?? width).toBeGreaterThanOrEqual(width);
    }
    await page.context().setOffline(true);
    const status = page.getByRole('status').filter({ hasText: 'الجهاز دون اتصال' });
    await expect(status).toBeVisible();
    await expect(page.getByText('تحقق من حالة حفظ كل محرر قبل مغادرته.')).toBeVisible();
    const rect = await status.boundingBox();
    const header = await page.locator('header').boundingBox();
    expect(header!.y).toBeGreaterThanOrEqual(rect!.y + rect!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/save-feedback-settled-${width}.png`, animations: 'disabled' });
    await page.context().setOffline(false);
    await expect(status).not.toBeVisible();
  }
  await close();
});

test('episode script keeps failed input and retries only the script save', async ({ browser }) => {
  const { page, close, errors } = await signIn(browser, 'producer@akhbar.tv');
  await openNav(page, 'الحلقات');
  await page.getByRole('button', { name: 'فتح مساحة العمل', exact: true }).last().click();
  await page.getByRole('button', { name: 'سكريبت المقدمة والأوتوكيو', exact: true }).click();
  const field = page.locator('#intro-script-textarea');
  const copy = `نص محفوظ بإعادة المحاولة ${Date.now()}`;
  await field.fill(copy);
  await expect(page.getByRole('status', { name: 'حالة حفظ السكريبت' })).toHaveText('تغييرات غير محفوظة');
  const data = await (await page.request.get('/api/v1/data')).json();
  await page.route('**/api/v1/data/sync', async route => {
    const ops = route.request().postDataJSON().ops;
    if (!ops.some((op: any) => op.c === 'episodes')) return route.continue();
    await route.fulfill({ json: { results: ops.map((op: any) => ({ c: op.c, id: op.id, ok: false, code: 'CONFLICT', message: 'اختبار رفض النص', current: data.collections.episodes.find((row: any) => row.id === op.id) })), rev: data.rev } });
  });
  await page.getByRole('button', { name: 'حفظ السكريبت', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'تعذر الحفظ؛ تعديلاتك باقية في المحرر' })).toBeVisible();
  await expect(field).toHaveValue(copy);
  await page.unroute('**/api/v1/data/sync');
  await page.getByRole('button', { name: 'إعادة محاولة حفظ السكريبت', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'تم الحفظ على الخادم' })).toBeVisible();
  await expect(field).toHaveValue(copy);
  expect(errors).toEqual([]);
  await close();
});
