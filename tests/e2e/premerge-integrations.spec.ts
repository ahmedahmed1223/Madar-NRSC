import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('pins a public announcement and follows a news statistic to its source records', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  const messageId = `pin-proof-${Date.now()}`;
  const title = `بلاغ مناوبة ${messageId}`;
  try {
    const response = await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [
      { c: 'messages', op: 'upsert', id: messageId, d: { channel: 'general', text: title } },
    ] } });
    expect((await response.json()).results[0].ok).toBe(true);
    await page.goto('/messages/general');
    const message = page.locator('[data-chat-message]').filter({ hasText: title });
    await message.getByRole('button', { name: 'تثبيت البلاغ' }).click();
    await expect(page.getByText('بلاغ مثبّت', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'إلغاء التثبيت' }).click();
    await expect(page.getByText('بلاغ مثبّت', { exact: true })).toHaveCount(0);

    await page.goto('/reports');
    await page.getByRole('button', { name: 'عرض سجلات الفترة' }).click();
    const records = page.getByRole('region', { name: 'سجلات تقرير الأخبار' });
    await records.getByRole('button', { name: 'المنشورة' }).click();
    await expect(records.getByRole('listitem').first()).toBeVisible();
  } finally { await close(); }
});

test('proposes an alternate deadline and confirms it from the requester session', async ({ browser }) => {
  const requester = await signIn(browser, 'journalist@akhbar.tv');
  const desk = await signIn(browser, 'media@akhbar.tv');
  const id = `deadline-proof-${Date.now()}`;
  const dueAt = new Date(Date.now() + 3600_000).toISOString();
  try {
    const response = await requester.page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [
      { c: 'requests', op: 'upsert', id, d: { title: 'تسليم تقرير المناوبة', type: 'MONTAGE', dueAt } },
    ] } });
    expect((await response.json()).results[0].ok).toBe(true);
    await desk.page.goto(`/requests/${id}`);
    await desk.page.getByRole('button', { name: 'اقتراح موعد بديل' }).click();
    await desk.page.getByLabel('موعد التسليم المقترح').fill('2030-11-21T13:00');
    await desk.page.getByRole('button', { name: 'إرسال الاقتراح' }).click();
    await expect(desk.page.getByRole('status').filter({ hasText: 'أُرسل الموعد البديل' })).toBeVisible();

    await requester.page.goto(`/requests/${id}`);
    await requester.page.getByRole('button', { name: 'اعتماد الموعد' }).click();
    await expect(requester.page.getByRole('status').filter({ hasText: 'اعتُمد الموعد البديل' })).toBeVisible();
    await expect(requester.page.getByRole('button', { name: 'اعتماد الموعد' })).toHaveCount(0);
  } finally { await Promise.all([requester.close(), desk.close()]); }
});
