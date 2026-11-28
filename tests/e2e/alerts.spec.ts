import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('each colleague sets their own alerts: channels, watch words, quiet hours', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'journalist@akhbar.tv');
  await page.getByRole('button', { name: /^الإشعارات/ }).click();
  await page.getByRole('button', { name: 'كل الإشعارات وإعدادات التنبيه' }).click();
  await expect(page.getByRole('heading', { name: 'تنبيهاتي' })).toBeVisible();
  await page.getByLabel('المواد العاجلة وكلمات المتابعة — الجهاز').check();
  await page.getByText('نبّهني فور وصول مادة عاجلة').click();
  await page.getByLabel('كلمة متابعة').fill('أوبك');
  await page.getByLabel('كلمة متابعة').press('Enter');
  await page.getByLabel('بداية ساعات الهدوء').fill('23:00');
  await page.getByLabel('نهاية ساعات الهدوء').fill('06:00');
  await page.getByRole('button', { name: 'حفظ الإعدادات' }).click();
  await expect(page.getByText('حُفظت إعدادات تنبيهاتك')).toBeVisible();
  // Saved on the server: still there after signing in again elsewhere.
  const again = await signIn(browser, 'journalist@akhbar.tv');
  await again.page.getByRole('button', { name: /^الإشعارات/ }).click();
  await again.page.getByRole('button', { name: 'كل الإشعارات وإعدادات التنبيه' }).click();
  await expect(again.page.getByRole('button', { name: 'حذف أوبك' })).toBeVisible();
  await expect(again.page.getByLabel('بداية ساعات الهدوء')).toHaveValue('23:00');
  await again.close();
  expect(errors).toEqual([]);
  await close();
});

test('تنبيهاتي shows read, unread and older notifications only to their recipient', async ({ browser }) => {
  const editor = await signIn(browser, 'editor@akhbar.tv');
  const reporter = await signIn(browser, 'reporter@akhbar.tv', { viewport: { width: 390, height: 900 } });
  try {
    const { user } = await (await reporter.page.request.get('/api/v1/auth/me')).json();
    const now = Date.now();
    const notices = Array.from({ length: 26 }, (_, index) => ({
      id: 'alerts-history-' + index,
      userId: user.id,
      title: 'إشعار سجل التنبيهات ' + (index + 1),
      message: 'تنبيه داخل مساحة العمل',
      type: 'SYSTEM',
      category: 'news',
      isRead: false,
      createdAt: new Date(now - index * 1000).toISOString(),
    }));
    const response = await editor.page.request.post('/api/v1/data/sync', {
      headers: { 'X-NRCS-Client': 'web' },
      data: { ops: notices.map(notice => ({ c: 'notifications', op: 'upsert', id: notice.id, d: notice })) },
    });
    expect((await response.json()).results.map((result: { ok: boolean }) => result.ok)).toEqual(notices.map(() => true));

    const page = reporter.page;
    await page.getByRole('button', { name: /^الإشعارات/ }).click();
    await page.getByRole('button', { name: 'كل الإشعارات وإعدادات التنبيه' }).click();
    const history = page.getByRole('region', { name: 'الإشعارات والتنبيهات', exact: true });
    const newest = history.getByText(notices[0].title, { exact: true });
    const oldest = history.getByText(notices[25].title, { exact: true });
    await expect(newest).toBeVisible();
    await expect(oldest).toHaveCount(0);
    await history.getByRole('button', { name: 'عرض المزيد من الإشعارات' }).click();
    await expect(oldest).toBeVisible();
    await history.getByRole('listitem').filter({ has: page.getByText(notices[0].title, { exact: true }) })
      .getByRole('button', { name: 'تحديد كمقروء', exact: true }).click();
    await expect.poll(async () => {
      const { collections } = await (await page.request.get('/api/v1/data')).json();
      return collections.notifications.find((row: { id: string }) => row.id === notices[0].id)?.d.isRead;
    }).toBe(true);
    await history.getByRole('button', { name: 'غير المقروءة', exact: true }).click();
    await expect(newest).toHaveCount(0);
    await history.getByRole('button', { name: 'الكل', exact: true }).click();
    await expect(newest).toBeVisible();

    await editor.page.goto('/alerts');
    const otherHistory = editor.page.getByRole('region', { name: 'الإشعارات والتنبيهات', exact: true });
    await expect(otherHistory).toBeVisible();
    await expect(otherHistory.getByText(notices[0].title, { exact: true })).toHaveCount(0);
  } finally {
    await reporter.close();
    await editor.close();
  }
});
