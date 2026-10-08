import { expect, test } from '@playwright/test';
import { signIn } from './helpers';
test('local draft survives offline reload and applies only after comparison; journal imports separately', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  try {
    const data = await (await page.request.get('/api/v1/data')).json();
    const setting = data.collections.settings[0];
    const id = `offline-draft-${Date.now()}`, storyId = `${id}-story`;
    const response = await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [
      { c: 'settings', id: setting.id, baseV: setting.v, op: 'upsert', d: { ...setting.d, allowOfflineScriptEdits: true } },
      { c: 'bulletins', id, op: 'upsert', d: { ...data.collections.bulletins[0].d, id, status: 'PLANNING', title: id } },
      { c: 'bulletinStories', id: storyId, op: 'upsert', d: { ...data.collections.bulletinStories[0].d, id: storyId, bulletinId: id, status: 'DRAFT', script: 'نسخة الخادم', newsId: undefined } },
    ] } });
    expect((await response.json()).results.every((row: any) => row.ok)).toBe(true);
    const packet = (await (await page.request.get(`/api/v1/air-offline/packet/${id}`)).json()).packet;
    expect(packet.canEdit).toBe(true);
    await page.evaluate(async packet => {
      const store = await import('/offline-store-test.js' as string);
      await store.ensureOfflineShell(); await store.savePacket(packet, 'device-secret');
    }, packet);
    await page.goto(`/offline-air.html?packet=${packet.packetId}`);
    await page.context().setOffline(true);
    const unlock = async () => { await page.getByLabel('كلمة فتح النسخة', { exact: true }).fill('device-secret'); await page.getByRole('button', { name: 'فتح النسخة', exact: true }).click(); };
    await unlock();
    await page.getByLabel('النص المحلي', { exact: true }).fill('النص المحلي المراجع');
    await page.getByRole('button', { name: 'حفظ محلي', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'حُفظ النص' })).toBeVisible();
    await page.reload(); await unlock();
    await expect(page.getByLabel('النص المحلي', { exact: true })).toHaveValue('النص المحلي المراجع');
    await page.context().setOffline(false);
    await page.getByRole('button', { name: 'مقارنة نسخة الخادم', exact: true }).click();
    await page.getByRole('checkbox', { name: 'أوافق على تطبيق المسودة بعد المقارنة', exact: true }).check();
    await page.getByRole('button', { name: 'تطبيق على الخادم', exact: true }).click();
    await expect.poll(async () => (await (await page.request.get('/api/v1/data')).json()).collections.bulletinStories.find((row: any) => row.id === storyId).d.script).toBe('النص المحلي المراجع');
    const before = (await (await page.request.get('/api/v1/data')).json()).collections.onAir;
    await page.getByRole('button', { name: 'تشغيل محلي', exact: true }).click();
    await page.getByRole('button', { name: 'إنهاء محلي', exact: true }).click();
    await page.getByRole('button', { name: 'فحص الاتصال ومقارنة البث', exact: true }).click();
    await page.getByRole('checkbox', { name: 'أوافق على استيراد تقرير محلي منفصل دون تغيير بث الفريق', exact: true }).check();
    await page.getByRole('button', { name: 'استيراد السجل المحلي', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'استُورد السجل' })).toBeVisible();
    expect((await (await page.request.get('/api/v1/data')).json()).collections.onAir).toEqual(before);
    await page.goto('/');
  } finally { await page.context().setOffline(false); await page.goto('/'); await close(); }
});
