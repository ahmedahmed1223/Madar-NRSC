import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { DEMO_PASSWORD } from './helpers';

const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
test('new settings sections are accessible on desktop and mobile in both themes', async ({ browser }) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ bypassCSP: true });
  const page = await context.newPage();
  await page.goto('/');
  await page.fill('#login-email', 'admin@akhbar.tv');
  await page.fill('#login-password', DEMO_PASSWORD);
  await page.click('button[type=submit]');
  await expect(page.locator('main')).toBeVisible();
  await page.goto('/settings');
  await page.addScriptTag({ content: axeSource });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['light', 'dark']) {
      await page.getByRole('navigation', { name: 'أقسام الإعدادات' }).getByRole('button', { name: /تفضيلات هذا الجهاز/ }).click();
      await page.getByLabel('المظهر', { exact: true }).selectOption(theme);
      for (const section of ['المؤسسة والفريق', 'الأخبار والتحرير', 'تفضيلات هذا الجهاز', 'حالة النظام']) {
        await page.getByRole('navigation', { name: 'أقسام الإعدادات' }).getByRole('button', { name: new RegExp(section) }).click();
        await page.waitForTimeout(300);
        const violations = await page.evaluate(async () => {
          const result = await (window as any).axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] });
          return result.violations.map((item: any) => `${item.id}: ${item.nodes.map((node: any) => node.target.join(' ')).join(' | ')}`);
        });
        expect(violations, `${width}/${theme}/${section}`).toEqual([]);
      }
    }
  }
  await context.close();
});
