import { expect, test } from '@playwright/test';
import { signIn, openNav } from './helpers';

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
    await preparation.getByLabel('كلمة فتح النسخة', { exact: true }).fill('device-secret');
    await preparation.getByRole('checkbox').check();
    await preparation.getByRole('button', { name: 'تجهيز النسخة', exact: true }).click();
    await expect(preparation.getByRole('status')).toContainText('تحقق حفظ النسخة');
    const popup = page.waitForEvent('popup');
    await preparation.getByRole('link', { name: 'فتح النسخة المحلية', exact: true }).click();
    viewer = await popup;
    await viewer.getByLabel('كلمة فتح النسخة', { exact: true }).fill('device-secret');
    await viewer.getByRole('button', { name: 'فتح النسخة', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'قفل النسخة', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^حساب/ }).click();
    await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click();
    const confirmation = page.getByRole('alertdialog');
    await confirmation.getByRole('button', { name: 'البقاء', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'قفل النسخة', exact: true })).toBeVisible();
    if (!await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).isVisible()) await page.getByRole('button', { name: /^حساب/ }).click();
    await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click();
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
