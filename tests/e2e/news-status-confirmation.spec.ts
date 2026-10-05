import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('a rejected editorial transition keeps the editor and reviewer notes open', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  let data = await (await page.request.get('/api/v1/data')).json();
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  const id = `review-confirmation-${Date.now()}`;
  const created = await (await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [{
    c: 'news', op: 'upsert', id,
    d: { ...data.collections.news[0].d, id, status: 'UNDER_REVIEW', authorId: me.user.id,
      title: 'خبر لاختبار تأكيد المراجعة', content: 'هذه مادة اختبارية تحتوي على معلومات كافية لمراجعة الخبر وتأكيد صحة انتقال الحالة داخل النظام',
      deletedAt: undefined, embargoUntil: undefined, isBreaking: false, workflowLogs: [] },
  }] } })).json();
  expect(created.results[0].ok).toBe(true);
  data = await (await page.request.get('/api/v1/data')).json();
  const row = data.collections.news.find((entry: any) => entry.id === id);
  expect(row).toBeTruthy();
  await page.goto(`/news/${row.id}`);
  await page.getByRole('button', { name: 'إعادة للكاتب مع ملاحظات', exact: true }).click();
  await page.locator('#status-transition-comment').fill('راجع الأرقام ومصدر التصريح');
  await page.route('**/api/v1/data/sync', async route => {
    const body = route.request().postDataJSON();
    if (!body.ops.some((op: any) => op.c === 'news')) return route.continue();
    await route.fulfill({ json: {
      rev: data.rev,
      dbId: data.dbId,
      results: body.ops.map(() => ({ ok: false, code: 'CONFLICT', message: 'اختبار رفض التحديث', current: row })),
    } });
  });
  await page.getByRole('button', { name: 'تأكيد ونقل الحالة', exact: true }).click();
  await expect(page.getByRole('button', { name: 'تأكيد ونقل الحالة', exact: true })).toBeEnabled();
  await expect(page.locator('#status-transition-comment')).toHaveValue('راجع الأرقام ومصدر التصريح');
  await expect(page.locator('#news-headline-input')).toBeVisible();
  await page.unroute('**/api/v1/data/sync');
  await page.getByRole('button', { name: 'إلغاء', exact: true }).last().click();
  await openNav(page, 'الرئيسية');
  await close();
});
