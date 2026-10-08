import { expect, test } from '@playwright/test';
import { signIn } from './helpers';
import { createRequire } from 'module';
import fs from 'fs';
const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

for (const width of [390, 1440]) test(`prompter controls and keyboard at ${width}px`, async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { bypassCSP: true });
  try {
    await page.setViewportSize({ width, height: 900 });
    const bootstrap = await (await page.request.get('/api/v1/data')).json();
    const bulletin = bootstrap.collections.bulletins.find((row: any) => !row.d.deletedAt).d;
    const id = `prompter-test-${width}-${Date.now()}`;
    const story = bootstrap.collections.bulletinStories[0].d;
    const response = await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [
      { c: 'bulletins', op: 'upsert', id, d: { ...bulletin, id, title: 'اختبار الملقّن', approvalSteps: [], status: 'PLANNING' } },
      ...[0, 1].map(index => ({ c: 'bulletinStories', op: 'upsert', id: `${id}-${index}`, d: { ...story, id: `${id}-${index}`, bulletinId: id, rank: index * 1000, slug: `فقرة اختبار ${index}`, script: 'نص قراءة طويل للتحقق من سلاسة التمرير والتحكم. '.repeat(80), type: 'READER', newsId: undefined, status: 'DRAFT', approvals: [], clipMediaId: undefined } })),
    ] } });
    expect((await response.json()).results.every((result: any) => result.ok)).toBe(true);
    await page.goto(`/bulletins/${id}`);
    for (const index of [0, 1]) {
      await page.getByRole('button', { name: `فتح فقرة اختبار ${index}`, exact: true }).click();
      await page.getByTestId('story-editor').getByRole('button', { name: /حفظ واعتماد للهواء|اعتمادي/ }).click();
      await expect(page.getByTestId('story-editor')).not.toBeVisible();
    }
    await page.getByRole('button', { name: 'الملقن', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'الملقّن', exact: true });
    await expect(modal).toBeVisible();
    const reader = modal.getByRole('region', { name: 'نص الملقّن' });
    await modal.getByRole('button', { name: 'ملء الشاشة (F)', exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute('aria-label'))).toBe('الملقّن');
    await modal.getByRole('button', { name: 'ملء الشاشة (F)', exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await reader.focus();
    await page.keyboard.press('ArrowUp');
    await expect(modal.getByLabel('سرعة التمرير', { exact: true })).toHaveValue('54');
    await page.keyboard.press('+');
    await expect(modal.getByLabel('حجم الخط', { exact: true })).toHaveText('38');
    await modal.getByRole('button', { name: 'لون النص أبيض', exact: true }).click();
    await expect(modal.getByRole('button', { name: 'لون النص أبيض', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const select = modal.getByLabel('الفقرة المعروضة', { exact: true });
    const count = await select.locator('option').count();
    if (count > 1) {
      await reader.focus(); await page.keyboard.press('ArrowLeft');
      await expect(select).toHaveValue('1');
      await select.selectOption('0'); await expect(select).toHaveValue('0');
    }
    await reader.focus(); await page.keyboard.press('Space');
    await expect(modal.getByRole('button', { name: 'إيقاف مؤقت', exact: true })).toBeVisible();
    await modal.getByLabel('سرعة التمرير', { exact: true }).focus();
    await page.keyboard.press('Space');
    await expect(modal.getByRole('button', { name: 'إيقاف مؤقت', exact: true })).toBeVisible();
    await reader.hover(); await page.mouse.wheel(0, 100);
    await expect(modal.getByRole('button', { name: 'بدء التمرير', exact: true })).toBeVisible();
    const bounds = await modal.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => (await (window as any).axe.run('[role="dialog"]', { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v: any) => ({ id: v.id, targets: v.nodes.map((n: any) => n.target) })));
    expect(violations).toEqual([]);
    await page.screenshot({ path: `test-results/prompter-${width}.png` });
    await reader.focus(); await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  } finally { await close(); }
});
