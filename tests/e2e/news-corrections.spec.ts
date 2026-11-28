import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';
import fs from 'fs';
import { createRequire } from 'module';
const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
for (const width of [390, 1440]) test(`correction conflict retains input and requires review at ${width}`, async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv', { viewport: { width, height: 900 }, bypassCSP: true });
  try {
    await openNav(page, 'الأخبار'); await page.locator('button[title="تحرير الخبر"]').first().click();
    const section = page.getByRole('region', { name: 'سجل التصحيحات' });
    await expect(section.getByRole('button', { name: 'تسجيل التصحيح' })).toBeEnabled();
    await section.getByLabel('سبب التصحيح').fill('تصحيح تجريبي'); await section.getByLabel('ملخص التصحيح').fill(`مراجعة الاسم ${width}`);
    await page.route('**/api/v1/news/*/corrections', route => route.request().method() === 'POST' ? route.fulfill({ status: 409, json: { error: 'تغيرت نسخة الخبر' } }) : route.continue());
    await section.getByRole('button', { name: 'تسجيل التصحيح' }).click();
    await expect(section.getByRole('alert')).toContainText('تغيرت');
    await expect(section.getByLabel('سبب التصحيح')).toHaveValue('تصحيح تجريبي');
    await expect(section.getByRole('button', { name: 'تسجيل التصحيح' })).toBeDisabled();
    await page.unroute('**/api/v1/news/*/corrections');
    await section.getByRole('button', { name: /مراجعة النسخة الحالية/ }).click();
    await expect(section.getByRole('button', { name: 'تسجيل التصحيح' })).toBeEnabled();
    await section.getByRole('button', { name: 'تسجيل التصحيح' }).click();
    await expect(section.locator('ol')).toContainText(`مراجعة الاسم ${width}`);
    await expect(section.getByLabel('سبب التصحيح')).toHaveValue('');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/corrections-${width}.png` });
    await page.addScriptTag({ content: axeSource });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const theme of ['light', 'dark']) {
      const fieldTransitions = await page.evaluate(theme => {
        const root = document.documentElement;
        root.classList.add('theme-transition');
        root.classList.toggle('dark', theme === 'dark');
        const panel = document.querySelector('[aria-label="سجل التصحيحات"]')!;
        return Array.from(panel.querySelectorAll('select, textarea'), field => getComputedStyle(field).transitionProperty);
      }, theme);
      expect(fieldTransitions).toEqual(['none', 'none', 'none']);
      await page.evaluate(async () => {
        document.documentElement.classList.remove('theme-transition');
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      expect(await page.evaluate(async () => (await (window as any).axe.run('[aria-label="سجل التصحيحات"]', { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v: any) => v.id))).toEqual([]);
      await page.screenshot({ path: `test-results/corrections-${width}-${theme}.png` });
    }
  } finally { await close(); }
});
