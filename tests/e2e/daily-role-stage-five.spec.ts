import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('grouped bell actions snooze and restore only the nonurgent notice on a phone', async ({ browser }) => {
  const editor = await signIn(browser, 'editor@akhbar.tv');
  const reporter = await signIn(browser, 'reporter@akhbar.tv', { viewport: { width: 390, height: 900 } });
  const suffix = Date.now();
  const normalTitle = 'مادة للمراجعة في صندوق الإشعارات';
  const urgentTitle = 'استثناء تشغيلي في صندوق الإشعارات';
  try {
    const { user } = await (await reporter.page.request.get('/api/v1/auth/me')).json();
    const notices = [
      { id: `daily-role-inbox-normal-${suffix}`, title: normalTitle, category: 'news', urgent: false },
      { id: `daily-role-inbox-urgent-${suffix}`, title: urgentTitle, category: 'system', urgent: true },
    ];
    const response = await editor.page.request.post('/api/v1/data/sync', {
      headers: { 'X-NRCS-Client': 'web' },
      data: { ops: notices.map((notice) => ({ c: 'notifications', op: 'upsert', id: notice.id, d: {
        ...notice, userId: user.id, message: '', linkUrl: '/news/nws-1', type: 'SYSTEM', isRead: false, createdAt: new Date().toISOString(),
      } })) },
    });
    expect((await response.json()).results.map((result: { ok: boolean }) => result.ok)).toEqual([true, true]);

    const page = reporter.page;
    const bell = page.getByRole('button', { name: /^الإشعارات/ });
    const inbox = page.locator('#notification-inbox');
    await page.reload();
    const badge = bell.getByTestId('notification-unread-count');
    await expect(badge).toBeVisible();
    const initialUnread = Number(await badge.textContent());
    expect(initialUnread).toBeGreaterThanOrEqual(2);
    await bell.click();
    await expect(inbox.getByRole('heading', { level: 3 }).first()).toHaveText('إشعارات عاجلة');
    await expect(inbox.getByRole('heading', { name: 'سير عمل الأخبار' })).toBeVisible();
    await expect(inbox.getByRole('listitem').filter({ hasText: urgentTitle }).getByRole('button', { name: 'تأجيل لساعة' })).toHaveCount(0);
    await inbox.getByRole('listitem').filter({ hasText: normalTitle }).getByRole('button', { name: 'تأجيل لساعة' }).click();
    await expect(badge).toHaveText(String(initialUnread - 1));
    await expect(inbox.getByRole('button', { name: normalTitle })).toHaveCount(0);
    await expect(inbox.getByRole('button', { name: urgentTitle })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(inbox).toHaveCount(0);
    await expect(bell).toBeFocused();

    await page.reload();
    await bell.click();
    await inbox.getByText(/^المؤجلة/).click();
    await inbox.getByRole('button', { name: `إلغاء التأجيل: ${normalTitle}` }).click();
    await expect(badge).toHaveText(String(initialUnread));
    const stored = await (await page.request.get('/api/v1/data')).json();
    const row = stored.collections.notifications.find((item: { id: string }) => item.id === notices[0].id);
    expect(row.d.isRead).toBe(false);
    await inbox.getByRole('button', { name: normalTitle }).click();
    await expect(page).toHaveURL(/\/news\/nws-1$/);
    expect(reporter.errors).toEqual([]);
  } finally {
    await reporter.close();
    await editor.close();
  }
});

test('the dashboard shows each summary only to the appropriate permissions', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv', { viewport: { width: 1440, height: 900 } });
  const reader = await signIn(browser, 'trainee@akhbar.tv', { viewport: { width: 390, height: 900 } });
  try {
    const adminPanel = admin.page.locator('#admin-exception-summary');
    const viewerPanel = reader.page.locator('#approved-material-summary');
    await expect(adminPanel.getByText('أخطاء النظام')).toBeVisible();
    await expect(admin.page.locator('#approved-material-summary')).toHaveCount(0);
    await expect(reader.page.locator('#admin-exception-summary')).toHaveCount(0);
    await expect(viewerPanel.getByRole('heading', { name: 'المواد المعتمدة والمنشورة' })).toBeVisible();
    const { collections } = await (await reader.page.request.get('/api/v1/data')).json();
    const draft = collections.news.find((item: { d: { status: string } }) => item.d.status === 'DRAFT');
    expect(draft).toBeDefined();
    await expect(viewerPanel.getByText(draft.d.title, { exact: true })).toHaveCount(0);
    await viewerPanel.getByRole('button', { name: /^انطلاق أعمال القمة الاقتصادية العربية/ }).click();
    await expect(reader.page).toHaveURL(/\/news\/nws-1$/);
    await adminPanel.getByRole('button', { name: 'فتح مراقبة النظام' }).click();
    await expect(admin.page).toHaveURL(/\/settings\/monitor$/);
    await expect(admin.page.getByRole('region', { name: 'مراقبة النظام' })).toBeVisible();
    expect([...admin.errors, ...reader.errors]).toEqual([]);
  } finally {
    await reader.close();
    await admin.close();
  }
});
