import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('manual pagination replaces the previously restored anchor', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  const data = await (await page.request.get('/api/v1/data')).json();
  const sample = data.collections.news[0].d;
  const response = await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: Array.from({ length: 15 }, (_, index) => ({ c: 'news', op: 'upsert', id: `anchor-review-${index}`, d: { ...sample, id: `anchor-review-${index}`, title: `Pagination fixture ${index}`, status: 'DRAFT', deletedAt: null } })) } });
  expect((await response.json()).results.every((result: any) => result.ok)).toBe(true);
  await openNav(page, 'الأخبار');
  await page.getByText('تخصيص قائمة الأخبار', { exact: true }).click();
  await page.getByLabel('نتائج الصفحة', { exact: true }).selectOption('10');
  await page.locator('button[title="تحرير الخبر"]').first().click();
  await openNav(page, 'الأخبار');
  await page.getByRole('button', { name: 'التالي', exact: true }).click();
  const firstId = await page.locator('[data-news-id]').first().getAttribute('data-news-id');
  await openNav(page, 'الرئيسية');
  await openNav(page, 'الأخبار');
  await expect(page.locator('[data-news-id]').first()).toHaveAttribute('data-news-id', firstId!);
  await close();
});

test('confirmed filters remain available when navigating offline', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'الأخبار');
  await page.getByRole('searchbox', { name: 'البحث في الأخبار', exact: true }).fill('فلتر أوفلاين');
  await page.getByRole('button', { name: 'حفظ الفلتر الحالي', exact: true }).click();
  await page.getByRole('dialog').getByLabel('اسم الفلتر', { exact: true }).fill('فلتر متاح دون اتصال');
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); dispatchEvent(new Event('offline')); });
  await openNav(page, 'الرئيسية'); await openNav(page, 'الأخبار');
  await expect(page.getByLabel('الفلاتر المحفوظة', { exact: true }).locator('option').filter({ hasText: 'فلتر متاح دون اتصال' })).toHaveCount(1);
  await page.getByLabel('الفلاتر المحفوظة', { exact: true }).selectOption({ label: 'فلتر متاح دون اتصال' });
  await expect(page.getByRole('searchbox', { name: 'البحث في الأخبار', exact: true })).toHaveValue('فلتر أوفلاين');
  await expect(page.getByRole('button', { name: 'حفظ الفلتر الحالي', exact: true })).toBeDisabled();
  await page.evaluate(() => { delete (navigator as any).onLine; dispatchEvent(new Event('online')); });
  await close();
});

test('a stalled filter save can stop waiting without losing its draft', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'الأخبار');
  await page.getByRole('button', { name: 'حفظ الفلتر الحالي', exact: true }).click();
  await page.getByRole('dialog').getByLabel('اسم الفلتر', { exact: true }).fill('طلب لم يصل');
  await page.route('**/api/v1/data/sync', async route => {
    if (!route.request().postDataJSON().ops.some((op: any) => op.c === 'savedNewsFilters')) return route.continue();
    // Deliberately do not answer: the user's escape path must not depend on a response.
  });
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(page.getByRole('button', { name: 'إيقاف الانتظار', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'إيقاف الانتظار', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('اسم الفلتر', { exact: true })).toHaveValue('طلب لم يصل');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'حفظ', exact: true })).toBeEnabled();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const rows = (await (await page.request.get('/api/v1/saved-news-filters')).json()).rows;
  expect(rows.filter((row: any) => row.d.name === 'طلب لم يصل')).toHaveLength(1);
  await close();
});

test('a committed filter with a lost acknowledgement reconciles instead of duplicating', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'الأخبار');
  await page.getByRole('button', { name: 'حفظ الفلتر الحالي', exact: true }).click();
  await page.getByRole('dialog').getByLabel('اسم الفلتر', { exact: true }).fill('تأكيد مفقود');
  await page.route('**/api/v1/data/sync', async route => {
    if (!route.request().postDataJSON().ops.some((op: any) => op.c === 'savedNewsFilters')) return route.continue();
    const committed = await route.fetch();
    expect((await committed.json()).results[0].ok).toBe(true);
    await route.abort('failed');
  });
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const rows = (await (await page.request.get('/api/v1/saved-news-filters')).json()).rows;
  expect(rows.filter((row: any) => row.d.name === 'تأكيد مفقود')).toHaveLength(1);
  await close();
});

test('bulletin work remains usable when session storage is blocked', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  const data = await (await page.request.get('/api/v1/data')).json();
  const timezone = data.collections.settings[0].d.defaultTimezone.split(/[\s(]/)[0];
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, calendar: 'gregory', numberingSystem: 'latn' }).format(new Date());
  for (const op of [
    { c: 'bulletins', op: 'upsert', id: 'blocked-storage-bulletin', d: { title: 'Storage fallback bulletin', date, startTime: '23:00', plannedSeconds: 600, kind: 'MAIN', status: 'DRAFT', anchors: [] } },
    { c: 'bulletinStories', op: 'upsert', id: 'blocked-storage-story', d: { bulletinId: 'blocked-storage-bulletin', slug: 'Storage fallback story', type: 'READER', status: 'DRAFT', rank: 0, script: 'Text', returnNote: 'Review' } },
  ]) {
    const response = await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [op] } });
    expect((await response.json()).results[0].ok).toBe(true);
  }
  await page.reload();
  await page.evaluate(() => Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => { throw new DOMException('Blocked', 'SecurityError'); } }));
  await page.getByTestId('my-bulletins').getByRole('button', { name: /Storage fallback story/ }).click();
  await expect(page).toHaveURL(/\/bulletins\/blocked-storage-bulletin$/);
  await expect(page.getByRole('heading', { name: 'Storage fallback bulletin', exact: true })).toBeVisible();
  await expect(page.getByText('حدث خطأ غير متوقع', { exact: true })).toHaveCount(0);
  await close();
});

test('Escape stops a stalled deletion and a lost delete acknowledgement reconciles safely', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'الأخبار');
  await page.getByRole('button', { name: 'حفظ الفلتر الحالي', exact: true }).click();
  await page.getByRole('dialog').getByLabel('اسم الفلتر', { exact: true }).fill('حذف متعثر آمن');
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'إدارة الفلاتر', exact: true }).click();
  const row = page.getByRole('dialog').getByRole('listitem').filter({ hasText: 'حذف متعثر آمن' });
  const confirmDelete = async () => {
    await row.getByRole('button', { name: 'حذف الفلتر', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'حذف', exact: true }).click();
  };
  await page.route('**/api/v1/data/sync', async route => {
    if (!route.request().postDataJSON().ops.some((op: any) => op.c === 'savedNewsFilters')) return route.continue();
  });
  await confirmDelete();
  await expect(page.getByRole('button', { name: 'إيقاف الانتظار', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'إيقاف الانتظار', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(row.getByRole('button', { name: 'حذف الفلتر', exact: true })).toBeEnabled();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.route('**/api/v1/data/sync', async route => {
    if (!route.request().postDataJSON().ops.some((op: any) => op.c === 'savedNewsFilters')) return route.continue();
    const committed = await route.fetch();
    expect((await committed.json()).results[0].ok).toBe(true);
    await route.abort('failed');
  });
  await confirmDelete();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await confirmDelete();
  await expect(row).toHaveCount(0);
  await close();
});
