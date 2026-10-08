import { expect, test } from '@playwright/test';
import { signIn, openNav } from './helpers';
test.use({ actionTimeout: 10_000 });
test('text-only bulletin airs and follows saved script with configurable screen defaults', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  const id = `text-air-${Date.now()}`;
  const data = await (await page.request.get('/api/v1/data')).json();
  const script = 'نص مذيع فقط دون أي ملف فيديو مرتبط بالنشرة.';
  const send = async (ops: any[]) => {
    const response = await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops } });
    expect((await response.json()).results.every((r: any) => r.ok)).toBe(true);
  };
  try {
    await send([{ c: 'bulletins', op: 'upsert', id, d: { ...data.collections.bulletins[0].d, id, title: id, status: 'PLANNING', approvalSteps: [] } },
      { c: 'bulletinStories', op: 'upsert', id: `${id}-story`, d: { ...data.collections.bulletinStories[0].d, id: `${id}-story`, bulletinId: id, newsId: undefined, type: 'READER', script, slug: 'قصة نصية', status: 'DRAFT', clipMediaId: undefined, clipSeconds: 0 } }]);
    await page.goto(`/bulletins/${id}`);
    await page.getByRole('button', { name: 'فتح قصة نصية', exact: true }).click();
    await page.getByTestId('story-editor').getByRole('button', { name: /حفظ واعتماد للهواء|اعتمادي/ }).click();
    await expect(page.getByTestId('story-editor')).not.toBeVisible();
    await openNav(page, 'الإعدادات');
    await page.getByRole('button', { name: /عرض الهواء/ }).click();
    if (await page.getByLabel('عرض الكنترول الافتراضي', { exact: true }).inputValue() === 'TEXT') {
      await page.getByLabel('عرض الكنترول الافتراضي', { exact: true }).selectOption('OPERATIONAL');
      await page.getByRole('button', { name: 'حفظ إعدادات العرض', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'حُفظت إعدادات العرض' })).toBeVisible();
    }
    await page.getByLabel('عرض الكنترول الافتراضي', { exact: true }).selectOption('TEXT');
    await page.getByRole('button', { name: 'حفظ إعدادات العرض', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'حُفظت إعدادات العرض' })).toBeVisible();
    await openNav(page, 'وضع الهواء');
    await page.getByLabel('الحلقة أو النشرة', { exact: true }).selectOption(id);
    await expect(page.getByRole('radio', { name: 'نص المذيع', exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'بدء البث', exact: true }).click();
    const confirmation = page.getByRole('alertdialog');
    if (await confirmation.isVisible()) await confirmation.getByRole('button', { name: /تأكيد|بث المحتوى السابق/ }).click();
    await expect(page.getByRole('region', { name: 'نص المذيع على الهواء' })).toContainText(script);
    await openNav(page, 'شاشة الاستديو');
    await page.getByLabel('الحلقة', { exact: true }).selectOption(id);
    await expect(page.getByRole('region', { name: 'نص المذيع على الهواء' })).toContainText(script);
  } finally { await close(); }
});
