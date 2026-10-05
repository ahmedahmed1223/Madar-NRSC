import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

for (const width of [1440, 768, 390]) {
  test(`main workflows fit ${width}px without page overflow`, async ({ browser }) => {
    const { page, close, errors } = await signIn(browser, 'admin@akhbar.tv', { viewport: { width, height: 900 } });
    for (const route of ['', 'news', 'tasks', 'programs', 'settings']) {
      await page.goto(`/${route}`);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('main h1').first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/ui-${route || 'dashboard'}-${width}.png`, fullPage: true });
    }
    expect(errors).toEqual([]);
    await close();
  });
}
