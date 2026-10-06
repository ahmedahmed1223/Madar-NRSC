import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('unsaved station settings recover after reload and can be discarded', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  await openNav(page, 'الإعدادات');
  await page.getByRole('button', { name: /المؤسسة والفريق/ }).click();
  const before = await page.locator('#station-name-input').inputValue();
  await page.locator('#station-name-input').fill('مسودة إعدادات غير محفوظة');
  page.removeAllListeners('dialog');
  page.on('dialog', dialog => void dialog.accept());
  await page.reload();
  await expect(page.locator('#station-name-input')).toHaveValue('مسودة إعدادات غير محفوظة');
  await page.getByRole('button', { name: 'إلغاء التغييرات', exact: true }).click();
  await expect(page.locator('#station-name-input')).toHaveValue(before);
  await close();
});

test('settings sections fit desktop and mobile and device preferences apply', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  await openNav(page, 'الإعدادات');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const section of ['المؤسسة والفريق', 'الأخبار والتحرير', 'تفضيلات هذا الجهاز', 'حالة النظام']) {
      await page.getByRole('navigation', { name: 'أقسام الإعدادات' }).getByRole('button', { name: new RegExp(section) }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await expect(page.getByText('جارٍ قراءة الحالة...')).not.toBeVisible();
    await expect(page.getByText('قاعدة البيانات', { exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: 'أقسام الإعدادات' }).getByRole('button', { name: /المؤسسة والفريق/ }).click();
    await page.screenshot({ path: `test-results/settings-${width}.png`, fullPage: true });
  }
  await page.getByRole('navigation', { name: 'أقسام الإعدادات' }).getByRole('button', { name: /تفضيلات هذا الجهاز/ }).click();
  await page.getByLabel('المظهر', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByLabel('تقليل الحركة', { exact: true }).check();
  await page.getByLabel('المظهر', { exact: true }).selectOption('light');
  await close();
});

test('station timezone changes the clock and entered dates, and persists after reload', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  await openNav(page, 'الإعدادات');
  await page.getByRole('button', { name: /المؤسسة والفريق/ }).click();
  const timezone = page.getByLabel('المنطقة الزمنية', { exact: true });
  await expect(timezone).toHaveJSProperty('tagName', 'SELECT');
  await expect(timezone.locator('option[value="Europe/Istanbul"]')).toHaveCount(1);
  await expect(timezone.locator('option')).not.toHaveCount(0);
  await timezone.selectOption('Asia/Tokyo');
  await page.getByLabel('اعتماد توقيت المحطة لجميع الزملاء').check();
  await page.getByRole('button', { name: 'حفظ الإعدادات العامة', exact: true }).click();
  await page.getByRole('button', { name: 'اعتماد التوقيت', exact: true }).click();
  await expect(page.getByText('تم حفظ إعدادات النظام وتطبيقها بنجاح على غرفة الأخبار ولوحة التحكم.', { exact: true })).toBeVisible();
  await expect(page.locator('header')).toContainText('بتوقيت المحطة');
  const hour = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tokyo', hour: '2-digit', hourCycle: 'h23' }).format(new Date());
  await expect(page.locator('header')).toContainText(`${hour}:`);
  await page.reload();
  await expect(page.locator('#station-timezone-input')).toHaveValue('Asia/Tokyo');
  await page.setViewportSize({ width: 390, height: 844 });
  const closeMenu = page.getByTitle('إغلاق القائمة', { exact: true });
  if (await page.locator('aside').getAttribute('aria-hidden') !== 'true') await closeMenu.click();
  await expect(page.locator('aside')).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(async () => (await page.locator('aside').boundingBox())?.x ?? 390).toBeGreaterThanOrEqual(390);
  await timezone.scrollIntoViewIfNeeded();
  await timezone.selectOption('Europe/Istanbul');
  await expect(timezone).toHaveValue('Europe/Istanbul');
  await timezone.selectOption('Asia/Tokyo');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/timezone-mobile.png' });
  await page.goto('/news/new');
  await expect(page.locator('#news-event-date-input')).toHaveValue(new RegExp(`T${hour}:`));
  await close();
});

test('settings search opens editorial defaults and defaults reach new stories', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  await openNav(page, 'الإعدادات');
  await page.getByRole('searchbox', { name: 'البحث في الإعدادات' }).fill('العاجل');
  await page.getByRole('button', { name: /الأخبار والتحرير/ }).last().click();
  await page.getByLabel('أولوية الخبر الافتراضية').selectOption('HIGH');
  await page.getByLabel('مدة العاجل الافتراضية (ساعة)').fill('4');
  await page.getByRole('button', { name: 'حفظ الإعدادات العامة', exact: true }).click();
  await expect(page.getByText('تم حفظ إعدادات النظام وتطبيقها بنجاح على غرفة الأخبار ولوحة التحكم.', { exact: true })).toBeVisible();
  await page.goto('/news/new');
  await expect(page.locator('#news-priority-select')).toHaveValue('HIGH');
  await close();
});

test('rejected settings save keeps entered values and does not announce success', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { viewport: { width: 390, height: 844 } });
  await openNav(page, 'الإعدادات');
  await page.getByRole('button', { name: /المؤسسة والفريق/ }).click();
  await page.locator('#station-name-input').fill('اسم لم يؤكد حفظه');
  const data = await (await page.request.get('/api/v1/data')).json();
  const row = data.collections.settings[0];
  await page.route('**/api/v1/data/sync', async route => {
    const ops = route.request().postDataJSON().ops;
    if (!ops.some((op: any) => op.c === 'settings')) return route.continue();
    await route.fulfill({ json: { results: ops.map((op: any) => ({ c: op.c, id: op.id, ok: false, code: 'CONFLICT', message: 'اختبار رفض الإعدادات', current: row })), rev: data.rev } });
  });
  await page.getByRole('button', { name: 'حفظ الإعدادات العامة', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'لم يؤكد الخادم' })).toBeVisible();
  await expect(page.locator('#station-name-input')).toHaveValue('اسم لم يؤكد حفظه');
  await expect(page.getByText('تم حفظ إعدادات النظام وتطبيقها بنجاح على غرفة الأخبار ولوحة التحكم.', { exact: true })).not.toBeVisible();
  await page.unroute('**/api/v1/data/sync');
  await close();
});
