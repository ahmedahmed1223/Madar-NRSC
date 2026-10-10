import { expect, test } from '@playwright/test';
import { signIn, openNav } from './helpers';
test('guest follow-up keeps values on rejection and confirms retry on mobile', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'producer@akhbar.tv', { viewport: { width: 390, height: 844 } });
  const initial = await (await page.request.get('/api/v1/data')).json();
  const episode = initial.collections.episodes.find((r: any) => r.d.guests?.length);
  await page.goto(`/episodes/${episode.id}`);
  await page.getByRole('button', { name: /^الضيوف والحجز/ }).click();
  const section = page.getByRole('region', { name: /^متابعة / }).first();
  await section.getByLabel('نتيجة الاختبار الفني').selectOption('PENDING');
  await section.getByLabel('ملاحظة الاختبار الفني').fill('قيمة باقية عند الفشل');
  const data = await (await page.request.get('/api/v1/data')).json();
  await page.route('**/api/v1/data/sync', async route => {
    const ops = route.request().postDataJSON().ops;
    if (!ops.some((op: any) => op.c === 'episodes')) return route.continue();
    await route.fulfill({ json: { results: ops.map((op: any) => ({ ok: false, code: 'CONFLICT', message: 'اختبار رفض المتابعة', current: data.collections.episodes.find((r: any) => r.id === op.id) })), rev: data.rev } });
  });
  await section.getByRole('button', { name: 'حفظ متابعة الضيف' }).click();
  await expect(section.getByRole('alert')).toBeVisible();
  await expect(section.getByLabel('ملاحظة الاختبار الفني')).toHaveValue('قيمة باقية عند الفشل');
  await page.unroute('**/api/v1/data/sync');
  await section.getByRole('button', { name: 'إعادة محاولة حفظ المتابعة' }).click();
  await expect(section.getByRole('status')).toHaveText('تم حفظ متابعة الضيف على الخادم');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await close();
});
