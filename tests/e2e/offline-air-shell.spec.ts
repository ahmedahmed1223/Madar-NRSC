import { expect, test } from '@playwright/test';
import { signIn } from './helpers';
import { createRequire } from 'module';
import fs from 'fs';
const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
test('prepared shell opens offline and restores durable local operation after reload', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { bypassCSP: true });
  try {
    const data = await (await page.request.get('/api/v1/data')).json();
    const id = data.collections.bulletins[0].id;
    const packet = (await (await page.request.get(`/api/v1/air-offline/packet/${id}`)).json()).packet;
    packet.show.segments.push({ ...packet.show.segments[0], id: 'reading-recovery-test', title: 'فقرة اختبار استعادة القراءة' });
    const onAirBefore = data.collections.onAir;
    const shell = await page.evaluate(async packet => {
      const store = await import('/offline-store-test.js' as string);
      const shell = await store.ensureOfflineShell();
      await store.savePacket({ ...packet, shellVersion: shell.version }, 'device-secret');
      return shell;
    }, packet);
    expect(shell.version).toMatch(/^[a-f0-9]{24}$/);
    await page.goto(`/offline-air.html?packet=${packet.packetId}`);
    await page.context().setOffline(true);
    await page.reload();
    await page.getByLabel('كلمة فتح النسخة', { exact: true }).fill('device-secret');
    await page.getByRole('button', { name: 'فتح النسخة', exact: true }).click();
    await expect(page.getByRole('heading', { name: packet.show.title, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'تشغيل محلي', exact: true }).click();
    await expect(page.locator('footer output')).toContainText('RUNNING');
    await page.getByRole('button', { name: 'إيقاف مؤقت', exact: true }).click();
    await expect(page.locator('footer output')).toContainText('PAUSED');
    await page.reload();
    await page.getByLabel('كلمة فتح النسخة', { exact: true }).fill('device-secret');
    await page.getByRole('button', { name: 'فتح النسخة', exact: true }).click();
    await expect(page.locator('footer output')).toContainText('PAUSED');
    for (let index = 0; index < packet.show.segments.length; index++) {
      await page.getByLabel('الفقرة المعروضة', { exact: true }).selectOption(String(index));
      await expect(page.getByRole('heading', { level: 2, name: packet.show.segments[index].title, exact: true })).toBeVisible();
    }
    await page.reload();
    await page.getByLabel('كلمة فتح النسخة', { exact: true }).fill('device-secret');
    await page.getByRole('button', { name: 'فتح النسخة', exact: true }).click();
    await expect(page.getByLabel('الفقرة المعروضة', { exact: true })).toHaveValue(String(packet.show.segments.length - 1));
    await page.getByRole('article', { name: 'نص الحلقة المحلي' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByLabel('الفقرة المعروضة', { exact: true })).toHaveValue(String(packet.show.segments.length - 2));
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByLabel('الفقرة المعروضة', { exact: true })).toHaveValue(String(packet.show.segments.length - 1));
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'تصدير النسخة المشفرة', exact: true }).click();
    expect((await download).suggestedFilename()).toBe(`offline-air-${packet.packetId}.json`);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.addScriptTag({ content: axeSource });
      expect(await page.evaluate(async () => (await (window as any).axe.run('main', { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v: any) => v.id))).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/offline-air-${width}.png` });
    }
    await page.getByRole('button', { name: 'قفل النسخة' }).click();
    await page.evaluate(() => {
      const original = crypto.subtle.deriveKey.bind(crypto.subtle);
      crypto.subtle.deriveKey = async (...args: Parameters<typeof original>) => {
        (window as any).derivationStarted = true;
        await new Promise<void>(resolve => { (window as any).releaseDerivation = resolve; });
        return original(...args);
      };
    });
    await page.getByLabel('كلمة فتح النسخة', { exact: true }).fill('device-secret');
    await page.getByRole('button', { name: 'فتح النسخة', exact: true }).click();
    await expect.poll(() => page.evaluate(() => !!(window as any).derivationStarted)).toBe(true);
    await page.evaluate(async userId => {
      const channel = new BroadcastChannel('madar-offline-air');
      channel.postMessage({ type: 'logout', userId });
      await new Promise(resolve => setTimeout(resolve, 100));
      channel.close();
      (window as any).releaseDerivation();
    }, packet.userId);
    await expect(page.getByRole('button', { name: 'فتح النسخة', exact: true })).toBeEnabled();
    await expect(page.getByRole('heading', { name: packet.show.title, exact: true })).not.toBeVisible();
    await page.context().setOffline(false);
    const after = await (await page.request.get('/api/v1/data')).json();
    expect(after.collections.onAir).toEqual(onAirBefore);
  } finally { await page.context().setOffline(false); await page.goto('/'); await close(); }
});
