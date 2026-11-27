import { expect, test } from '@playwright/test';
import { openNav, openSettingsSection, signIn } from './helpers';
import fs from 'fs';
import { createRequire } from 'module';
const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
for (const width of [390, 1440]) test(`dictionary confirmed saving, duplicates and focus at ${width}`, async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { viewport: { width, height: 900 }, bypassCSP: true });
  try {
    await openNav(page, 'الإعدادات');
    await openSettingsSection(page, 'الأخبار والتحرير');
    const section = page.getByRole('region', { name: 'قاموس النطق' });
    const name = `أحمد اختبار ${width}`;
    await section.getByRole('button', { name: 'إضافة اسم للنطق' }).click();
    await expect(section.getByLabel('الاسم', { exact: true })).toBeFocused();
    await section.getByLabel('الاسم', { exact: true }).fill(name);
    await section.getByLabel('النطق المكتوب').fill('أَحْمَد');
    await section.getByRole('button', { name: 'حفظ النطق' }).click();
    await expect(section.locator('form')).toHaveCount(0);
    await expect(section.getByRole('button', { name: 'إضافة اسم للنطق' })).toBeFocused();
    await section.getByRole('button', { name: 'إضافة اسم للنطق' }).click();
    await section.getByLabel('الاسم', { exact: true }).fill(name.replace('أ', 'ا'));
    await section.getByLabel('النطق المكتوب').fill('نطق ثان');
    await section.getByRole('button', { name: 'حفظ النطق' }).click();
    await expect(section.getByRole('alert')).toBeVisible();
    await expect(section.getByLabel('النطق المكتوب')).toHaveValue('نطق ثان');
    await section.getByRole('button', { name: 'إلغاء', exact: true }).click();
    await section.getByRole('searchbox').fill(name);
    await expect(section.getByRole('button', { name: `تعديل نطق ${name}`, exact: true })).toBeVisible();
    await section.getByRole('button', { name: `تعديل نطق ${name}`, exact: true }).click();
    await section.getByLabel('النطق المكتوب').fill('مسودة قديمة');
    const before = await (await page.request.get('/api/v1/data')).json();
    const row = before.collections.pronunciationTerms.find((r: any) => r.d.term === name);
    const changed = await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [{ c: 'pronunciationTerms', op: 'upsert', id: row.id, baseV: row.v, d: { ...row.d, note: 'ملاحظة الزميل' } }] } });
    expect((await changed.json()).results[0].ok).toBe(true);
    await expect(section.locator('li')).toContainText('ملاحظة الزميل');
    await section.getByRole('button', { name: 'حفظ النطق' }).click();
    await expect(section.getByRole('alert')).toContainText('تغير');
    await expect(section.getByLabel('النطق المكتوب')).toHaveValue('مسودة قديمة');
    await section.getByRole('button', { name: 'إلغاء', exact: true }).click();
    await section.getByRole('button', { name: `تعديل نطق ${name}`, exact: true }).click();
    await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [{ c: 'pronunciationTerms', op: 'delete', id: row.id }] } });
    await expect(section.getByRole('button', { name: `تعديل نطق ${name}`, exact: true })).toHaveCount(0);
    await section.getByRole('button', { name: 'حفظ النطق' }).click();
    await expect(section.getByRole('alert')).toContainText('حذف');
    await section.getByRole('button', { name: 'إلغاء', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/pronunciation-${width}.png` });
    await page.addScriptTag({ content: axeSource });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      expect(await page.evaluate(async () => (await (window as any).axe.run('[aria-label="قاموس النطق"]', { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v: any) => v.id))).toEqual([]);
      await page.screenshot({ path: `test-results/pronunciation-${width}-${theme}.png` });
    }
  } finally { await close(); }
});
