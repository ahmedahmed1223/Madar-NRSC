import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { openNav, signIn } from './helpers';

const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
test.use({ actionTimeout: 15_000 });
for (const width of [390, 768, 1440]) {
  test(`story recovery and editorial controls fit at ${width}px`, async ({ browser }) => {
    const { page, close, errors } = await signIn(browser, 'producer@akhbar.tv', { viewport: { width, height: 844 } });
    const data = await (await page.request.get('/api/v1/data')).json();
    const bulletin = data.collections.bulletins.find((r: any) => r.id === 'bul-demo-main');
    const story = data.collections.bulletinStories.find((r: any) => r.d.bulletinId === bulletin.id && !r.d.killed && !r.d.floated);
    await page.goto(`/bulletins/${bulletin.id}`);
    await page.getByRole('button', { name: `فتح ${story.d.slug}`, exact: true }).click();
    const form = page.getByTestId('story-editor');
    const copy = `مسودة محفوظة محلياً ${width} ` + 'نص طويل للاختبار '.repeat(25);
    await form.locator('textarea').first().fill(copy);
    await page.reload();
    await page.getByRole('button', { name: `فتح ${story.d.slug}`, exact: true }).click();
    await expect(form.locator('textarea').first()).toHaveValue(copy);
    await expect(page.getByText(/استُعيدت مسودة محلية/).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await form.getByRole('button', { name: 'حفظ', exact: true }).scrollIntoViewIfNeeded();
    const box = await form.getByRole('button', { name: 'حفظ', exact: true }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `test-results/editorial-story-${width}.png`, fullPage: true });
    // Discard only the local test recovery copy, never the persisted story.
    await page.getByRole('button', { name: 'تجاهل المسودة المحلية', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'تجاهل التغييرات', exact: true }).click();
    await form.getByRole('button', { name: 'إغلاق', exact: true }).click();
    await page.getByRole('button', { name: 'العودة للنشرات', exact: true }).click();
    if (width < 640) await page.getByRole('combobox', { name: 'أقسام النشرات', exact: true }).selectOption('WORK');
    else await page.getByRole('tab', { name: 'مساحة العمل', exact: true }).click();
    await expect(page.getByRole('region', { name: 'مساحة عمل مدير النشرة' })).toBeVisible();
    expect(errors).toEqual([]);
    await close();
  });
}

test('review and assignment surfaces pass axe in light and dark', async ({ browser }) => {
  const context = await browser.newContext({ bypassCSP: true });
  const page = await context.newPage();
  await page.goto('/');
  await page.fill('#login-email', 'producer@akhbar.tv');
  await page.fill('#login-password', 'Madar@Demo2026');
  await page.click('button[type=submit]');
  await expect(page.locator('main')).toBeVisible();
  await page.goto('/bulletins/bul-demo-main');
  await page.getByRole('button', { name: 'تكليف إعداد النشرة', exact: true }).click();
  for (const dark of [false, true]) {
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
    // Contrast is measured after the existing 200ms palette transition settles.
    await page.waitForTimeout(300);
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => (await (window as any).axe.run(document.querySelector('#form-page-root'), { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v: any) => ({ id: v.id, targets: v.nodes.map((n: any) => n.target) })));
    expect(violations).toEqual([]);
  }
  await context.close();
});
