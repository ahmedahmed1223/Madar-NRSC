import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('walk-up upload uses a single external link and the wallboard has no controls', async ({ browser }) => {
  test.setTimeout(120_000);
  const staff = await signIn(browser, 'admin@akhbar.tv');
  const contributor = await browser.newContext();
  try {
    const { page } = staff;
    const reply = await page.request.post('/api/v1/external-intake/links', { headers: { 'X-NRCS-Client': 'web' }, data: { kind: 'upload' } });
    expect(reply.ok()).toBe(true);
    const { data } = await reply.json();
    const publicUrl = new URL(data.path, page.url()).href;
    const external = await contributor.newPage();
    await external.goto(publicUrl);
    await expect(external.getByRole('heading', { name: 'رفع مادة إلى مدار' })).toBeVisible();
    await external.getByLabel('ملف الفيديو أو الصوت').setInputFiles({ name: 'contributor-original.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFF0000WAVEfmt ') });
    await external.getByRole('button', { name: 'رفع الملف', exact: true }).click();
    await expect(external.getByText('استلم مدار الملف الأصلي وأودعه في مكتبة الوسائط.')).toBeVisible();
    await external.reload();
    await expect(external.getByRole('alert')).toContainText('الرابط غير صالح');

    await page.goto('/wallboard');
    await expect(page.getByRole('heading', { name: 'شاشة غرفة الأخبار', exact: true })).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(0);
    for (const width of [320, 390, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    expect(staff.errors).toEqual([]);
  } finally {
    await contributor.close();
    await staff.page.goto('/');
    await staff.close();
  }
});
