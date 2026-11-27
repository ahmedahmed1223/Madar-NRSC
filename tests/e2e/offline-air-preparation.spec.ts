import { expect, test } from '@playwright/test';
import { signIn, openNav } from './helpers';

test.use({ actionTimeout: 15_000, navigationTimeout: 15_000 });

test('prepares through UI and cancels logout before purging local work', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  let viewer: import('@playwright/test').Page | null = null;
  try {
    const data = await (await page.request.get('/api/v1/data')).json();
    const id = `offline-preparation-${Date.now()}`;
    const response = await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [
      { c: 'bulletins', op: 'upsert', id, d: { ...data.collections.bulletins[0].d, id, title: id, status: 'PLANNING' } },
      { c: 'bulletinStories', op: 'upsert', id: `${id}-story`, d: { ...data.collections.bulletinStories[0].d, id: `${id}-story`, bulletinId: id, status: 'DRAFT', newsId: undefined } },
    ] } });
    expect((await response.json()).results.every((row: any) => row.ok)).toBe(true);
    await page.goto('/on-air');
    const selector = page.getByLabel('الحلقة أو النشرة', { exact: true });
    await expect(selector.locator(`option[value="${id}"]`)).toHaveCount(1);
    await selector.selectOption(id);
    const preparation = page.getByRole('region', { name: 'تجهيز الهواء دون اتصال' });
    const copySummary = preparation.locator('summary').filter({ hasText: 'نسخة الهواء المحلية' });
    await copySummary.click();
    await preparation.getByLabel('كلمة فتح النسخة', { exact: true }).fill('device-secret');
    await preparation.getByRole('checkbox').check();
    await preparation.getByRole('button', { name: 'تجهيز النسخة', exact: true }).click();
    // During the final render, progress and confirmation can both be announced.
    await expect(preparation.getByRole('status').filter({ hasText: 'تحقق حفظ النسخة' })).toBeVisible();
    await expect(copySummary).toContainText('تطابق آخر بيانات متزامنة');
    const saved = (await (await page.request.get('/api/v1/data')).json()).collections.bulletinStories.find((row: any) => row.id === `${id}-story`);
    const updated = await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [
      { c: 'bulletinStories', op: 'upsert', id: saved.id, baseV: saved.v, d: { ...saved.d, slug: 'فقرة محدثة بعد تجهيز النسخة' } },
    ] } });
    expect((await updated.json()).results[0].ok).toBe(true);
    await expect(copySummary).toContainText('تختلف عن آخر بيانات متزامنة');
    const localCopyLink = preparation.getByRole('link', { name: 'فتح النسخة المحلية', exact: true });
    await expect(localCopyLink).toHaveAttribute('target', '_blank');
    await expect(localCopyLink).toHaveAttribute('href', /^\/offline-air\.html\?packet=.+/);
    [viewer] = await Promise.all([page.waitForEvent('popup', { timeout: 15_000 }), localCopyLink.click()]);
    await viewer.getByLabel('كلمة فتح النسخة', { exact: true }).fill('device-secret');
    await viewer.getByRole('button', { name: 'فتح النسخة', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'قفل النسخة', exact: true })).toBeVisible();
    await expect(viewer.getByText('جُهزت هذه النسخة في', { exact: false })).toBeVisible();
    await viewer.getByLabel('لون النص').selectOption('cyan');
    await viewer.getByRole('button', { name: 'المرآة', exact: true }).click();
    await viewer.getByRole('button', { name: 'قفل النسخة', exact: true }).click();
    await viewer.getByLabel('كلمة فتح النسخة', { exact: true }).fill('device-secret');
    await viewer.getByRole('button', { name: 'فتح النسخة', exact: true }).click();
    await expect(viewer.getByLabel('لون النص')).toHaveValue('cyan');
    await expect(viewer.getByRole('button', { name: 'المرآة', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const account = page.getByRole('button', { name: /^الحساب / });
    await account.click();
    await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click();
    const confirmation = page.getByRole('alertdialog');
    await confirmation.getByRole('button', { name: 'البقاء', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'قفل النسخة', exact: true })).toBeVisible();
    await page.route('**/api/v1/auth/logout', route => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'temporarily unavailable' }),
    }));
    if (!await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).isVisible()) await account.click();
    await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click();
    await confirmation.getByRole('button', { name: 'حذف النسخ وتسجيل الخروج', exact: true }).click();
    const failure = page.getByRole('alert').filter({ hasText: 'تعذر إكمال تسجيل الخروج' });
    await expect(failure).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'قفل النسخة', exact: true })).toBeVisible();
    await page.unroute('**/api/v1/auth/logout');
    await failure.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click();
    await confirmation.getByRole('button', { name: 'حذف النسخ وتسجيل الخروج', exact: true }).click();
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'قفل النسخة', exact: true })).not.toBeVisible();
    const records = await viewer.evaluate(async () => {
      const store = await import('/offline-store-test.js' as string);
      return store.listPacketMetadata();
    });
    expect(records).toEqual([]);
    await page.fill('#login-email', 'admin@akhbar.tv');
    await page.fill('#login-password', 'Madar@Demo2026');
    await page.click('button[type=submit]');
    await expect(page.locator('main')).toBeVisible();
  } finally { await viewer?.close(); await close(); }
});
