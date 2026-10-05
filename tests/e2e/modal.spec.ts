import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

for (const width of [1440, 390]) {
  test(`shared modal keeps focus and fits a ${width}px viewport`, async ({ browser }) => {
    const { page, close, errors } = await signIn(browser, 'editor@akhbar.tv', {
      viewport: { width, height: 844 },
    });
    await page.locator('main').click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading') });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
    expect(errors).toEqual([]);
    await page.keyboard.press('?');
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: `test-results/modal-${width}.png` });
    await close();
  });
}
