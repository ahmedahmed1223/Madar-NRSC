import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('RSS settings preserve the URL after rejected save and retry with server confirmation', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { viewport: { width: 390, height: 844 } });
  await openNav(page, 'الإعدادات');
  await page.getByRole('navigation', { name: 'أقسام الإعدادات' }).getByRole('button', { name: /الوكالات والمصادر/ }).click();
  await page.getByRole('button', { name: /RSS/ }).first().click();
  const field = page.getByLabel('رابط خلاصة RSS / Atom');
  await field.fill('https://example.org/news.xml');
  const data = await (await page.request.get('/api/v1/data')).json();
  await page.route('**/api/v1/data/sync', async route => {
    const ops = route.request().postDataJSON().ops;
    if (!ops.some((op: any) => op.c === 'sources')) return route.continue();
    await route.fulfill({ json: { results: ops.map((op: any) => ({ c: op.c, id: op.id, ok: false, code: 'CONFLICT', message: 'اختبار رفض حفظ الخلاصة', current: data.collections.sources.find((row: any) => row.id === op.id) })), rev: data.rev } });
  });
  const editor = field.locator('..');
  await editor.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('اختبار رفض حفظ الخلاصة');
  await expect(field).toHaveValue('https://example.org/news.xml');
  await page.unroute('**/api/v1/data/sync');
  await editor.getByRole('button', { name: 'إعادة محاولة الحفظ', exact: true }).click();
  await expect(field).not.toBeVisible();
  await expect.poll(async () => {
    const next = await (await page.request.get('/api/v1/data')).json();
    return next.collections.sources.some((row: any) => row.d.feedUrl === 'https://example.org/news.xml' && row.d.feedEnabled);
  }).toBe(true);
  await close();
});
