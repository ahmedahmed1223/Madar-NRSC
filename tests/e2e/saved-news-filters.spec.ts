import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';
import { createRequire } from 'module';
import fs from 'fs';

const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

for (const width of [390, 1440]) test(`saved filters have a confirmed private lifecycle at ${width}`, async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv', { bypassCSP: true, viewport: { width, height: 900 } });
  await openNav(page, 'الأخبار');
  await page.getByRole('searchbox', { name: 'البحث في الأخبار', exact: true }).fill('اختبار فلتر');
  await page.getByRole('button', { name: 'حفظ الفلتر الحالي', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('اسم الفلتر', { exact: true })).toHaveAttribute('maxlength', '80');
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const colors = await dialog.getByRole('button', { name: 'حفظ', exact: true }).evaluate(button => {
      const style = getComputedStyle(button);
      return { foreground: style.color, background: style.backgroundColor };
    });
    expect(colors.foreground).not.toBe(colors.background);
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => (await (window as any).axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v: any) => `${v.id}: ${v.nodes.map((n: any) => n.target.join(' ')).join(', ')}`));
    expect(violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/saved-filters-${width}-${scheme}.png` });
  }
  await dialog.getByLabel('اسم الفلتر', { exact: true }).fill(`فلتر خاص ${width}`);
  await dialog.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.getByLabel('الفلاتر المحفوظة', { exact: true }).selectOption({ label: `فلتر خاص ${width}` });
  await expect(page.getByRole('searchbox', { name: 'البحث في الأخبار', exact: true })).toHaveValue('اختبار فلتر');
  await page.getByRole('searchbox', { name: 'البحث في الأخبار', exact: true }).fill('تعريف محدّث');
  await page.getByRole('button', { name: 'إدارة الفلاتر', exact: true }).click();
  const row = page.getByRole('dialog').getByRole('listitem').filter({ hasText: `فلتر خاص ${width}` });
  await row.getByRole('button', { name: 'تعديل الفلتر', exact: true }).click();
  await dialog.getByLabel('اسم الفلتر', { exact: true }).fill(`فلتر معدّل ${width}`);
  await dialog.getByLabel('تثبيت الفلتر', { exact: true }).check();
  await dialog.getByRole('button', { name: 'استخدام الفلاتر الحالية', exact: true }).click();
  await dialog.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(page.getByLabel('الفلاتر المحفوظة', { exact: true }).locator('option').filter({ hasText: `فلتر معدّل ${width}` })).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'البحث في الأخبار', exact: true }).fill('');
  await page.getByLabel('الفلاتر المحفوظة', { exact: true }).selectOption('');
  await page.getByLabel('الفلاتر المحفوظة', { exact: true }).selectOption({ label: `فلتر معدّل ${width}` });
  await expect(page.getByRole('searchbox', { name: 'البحث في الأخبار', exact: true })).toHaveValue('تعريف محدّث');
  const colleague = await signIn(browser, 'reporter@akhbar.tv');
  await openNav(colleague.page, 'الأخبار');
  await expect(colleague.page.getByLabel('الفلاتر المحفوظة', { exact: true }).locator('option').filter({ hasText: `فلتر معدّل ${width}` })).toHaveCount(0);
  await colleague.close();
  await page.getByRole('button', { name: 'إدارة الفلاتر', exact: true }).click();
  await dialog.getByRole('listitem').filter({ hasText: `فلتر معدّل ${width}` }).getByRole('button', { name: 'حذف الفلتر', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'حذف', exact: true }).click();
  await expect(dialog.getByText(`فلتر معدّل ${width}`, { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'إدارة الفلاتر', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await close();
});

test('stale filter edits cannot overwrite another session and missing references stay restrictive', async ({ browser }) => {
  const first = await signIn(browser, 'editor@akhbar.tv');
  const second = await signIn(browser, 'editor@akhbar.tv');
  const response = await first.page.request.post('/api/v1/data/sync', {
    headers: { 'X-NRCS-Client': 'web' },
    data: { ops: [{ c: 'savedNewsFilters', op: 'upsert', id: 'filter-conflict-test', d: { id: 'filter-conflict-test', schemaVersion: 1, name: 'نسخة قبل التعارض', pinned: false, definition: { activeTab: 'ALL', searchQuery: '', selectedCategory: 'قسم غير متاح', selectedPriority: 'ALL', onlyMine: false, authorId: 'ALL', fromDate: '', toDate: '' } } }] },
  });
  expect((await response.json()).results[0].ok).toBe(true);
  await first.page.goto('/news');
  await first.page.getByLabel('الفلاتر المحفوظة', { exact: true }).selectOption({ label: 'نسخة قبل التعارض' });
  await expect(first.page.getByRole('button', { name: 'إزالة القسم غير المتاح', exact: true })).toBeVisible();
  await first.page.getByRole('button', { name: 'إدارة الفلاتر', exact: true }).click();
  await first.page.getByRole('dialog').getByRole('listitem').filter({ hasText: 'نسخة قبل التعارض' }).getByRole('button', { name: 'تعديل الفلتر', exact: true }).click();
  await first.page.getByRole('dialog').getByLabel('اسم الفلتر', { exact: true }).fill('تعديل قديم لا ينشر');
  const rows = (await (await second.page.request.get('/api/v1/saved-news-filters')).json()).rows;
  const row = rows.find((r: any) => r.id === 'filter-conflict-test');
  const update = await second.page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [{ c: 'savedNewsFilters', op: 'upsert', id: row.id, baseV: row.v, d: { id: row.id, schemaVersion: 1, name: 'نسخة الزميل الحالية', pinned: true, definition: row.d.definition } }] } });
  expect((await update.json()).results[0].ok).toBe(true);
  await first.page.getByRole('dialog').getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(first.page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await expect(first.page.getByRole('dialog').getByLabel('اسم الفلتر', { exact: true })).toHaveValue('تعديل قديم لا ينشر');
  const latest = (await (await first.page.request.get('/api/v1/saved-news-filters')).json()).rows.find((r: any) => r.id === row.id);
  expect(latest.d.name).toBe('نسخة الزميل الحالية');
  await first.page.keyboard.press('Escape');
  await first.close(); await second.close();
});

test('a failed filter save keeps its draft and offline mutations are disabled', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'الأخبار');
  await page.getByRole('button', { name: 'حفظ الفلتر الحالي', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const name = 'محاولة حفظ آمنة';
  await dialog.getByLabel('اسم الفلتر', { exact: true }).fill('   ');
  await dialog.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('اسم الفلتر مطلوب');
  await dialog.getByLabel('اسم الفلتر', { exact: true }).fill('ف'.repeat(80));
  await expect(dialog.getByLabel('اسم الفلتر', { exact: true })).toHaveValue('ف'.repeat(80));
  await dialog.getByLabel('اسم الفلتر', { exact: true }).fill(name);
  await page.route('**/api/v1/data/sync', async route => {
    const { ops } = route.request().postDataJSON();
    if (!ops.some((op: any) => op.c === 'savedNewsFilters')) return route.continue();
    await route.fulfill({ status: 503, json: { error: 'تعذر الحفظ الاختباري' } });
  });
  await dialog.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('اسم الفلتر', { exact: true })).toHaveValue(name);
  await page.unroute('**/api/v1/data/sync');
  await dialog.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  await expect(page.getByRole('button', { name: 'حفظ الفلتر الحالي', exact: true })).toBeDisabled();
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await close();
});
