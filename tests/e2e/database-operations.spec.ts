import { expect, test } from '@playwright/test';
import { signIn } from './helpers';
import { createRequire } from 'module';
import fs from 'fs';
const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
test('database manager creates, verifies and downloads a selected snapshot and safe diagnostics', async ({ browser }) => {
  test.setTimeout(120000);
  const { page, errors, close } = await signIn(browser, 'admin@akhbar.tv', { bypassCSP: true });
  try {
    await page.goto('/database');
    await expect(page.getByRole('button', { name: 'إنشاء نسخة احتياطية الآن', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'إنشاء نسخة احتياطية الآن', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'تم إنشاء النسخة الاحتياطية' })).toBeVisible();
    await page.route('**/api/v1/db/backups', route => route.request().method() === 'POST'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'test failure' }) }) : route.continue());
    await page.getByRole('button', { name: 'إنشاء نسخة احتياطية الآن', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'فشل إنشاء النسخة الاحتياطية' })).toBeVisible();
    await page.unroute('**/api/v1/db/backups');
    let requests = 0;
    await page.route('**/api/v1/db/backups', async route => {
      if (route.request().method() === 'POST') { requests++; await new Promise(resolve => setTimeout(resolve, 200)); }
      await route.continue();
    });
    await page.getByRole('button', { name: 'إنشاء نسخة احتياطية الآن', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect(page.getByRole('status').filter({ hasText: 'تم إنشاء النسخة الاحتياطية' })).toBeVisible();
    expect(requests).toBe(1);
    await page.unroute('**/api/v1/db/backups');
    const tabs = page.getByRole('tablist', { name: 'أدوات قاعدة البيانات' });
    await tabs.getByRole('tab', { name: /النسخ الاحتياطي/ }).click();
    const row = page.locator('tr').filter({ has: page.getByRole('button', { name: 'فحص سلامة النسخة' }) }).first();
    await row.getByRole('button', { name: 'فحص سلامة النسخة' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'النسخة سليمة' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'تجربة الاستعادة' })).toBeVisible();
    await row.getByRole('button', { name: 'تجربة الاستعادة' }).click();
    await expect(page.getByRole('heading', { name: 'نتيجة تجربة الاستعادة' })).toBeVisible();
    await expect(page.getByText('لم تتغير قاعدة البيانات الحالية')).toBeVisible();
    const restore = row.getByRole('button', { name: 'استعادة هذه النسخة' });
    await restore.click();
    let dialog = page.getByRole('dialog', { name: 'تأكيد استعادة قاعدة البيانات' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(restore).toBeFocused();
    await restore.click();
    await dialog.getByLabel('كلمة المرور الحالية').fill('wrong');
    await dialog.getByLabel('أكدت انتهاء جميع جلسات الهواء، بما فيها الجلسات المحلية غير المتصلة').check();
    await dialog.getByRole('button', { name: 'تأكيد وتنفيذ الاستعادة' }).click();
    await expect(dialog.getByRole('alert')).toContainText('تعذر تأكيد الهوية');
    await expect(dialog.getByLabel('كلمة المرور الحالية')).toHaveValue('');
    await expect(dialog.getByLabel('كلمة المرور الحالية')).toBeFocused();
    await page.route('**/api/v1/db/backups/restore', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'توجد جلسة بث نشطة', code: 'AIR_ACTIVE' }) }));
    await dialog.getByLabel('كلمة المرور الحالية').fill('Madar@Demo2026');
    await dialog.getByRole('button', { name: 'تأكيد وتنفيذ الاستعادة' }).click();
    await expect(dialog.getByRole('alert')).toContainText('جلسة بث نشطة');
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.addScriptTag({ content: axeSource });
      expect(await page.evaluate(async () => (await (window as any).axe.run('[role="dialog"]', { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v: any) => v.id))).toEqual([]);
      expect(await page.evaluate(() => document.elementFromPoint(Math.floor(innerWidth / 2), innerHeight - 10)?.closest('button') === null)).toBe(true);
      await page.screenshot({ path: `test-results/database-confirmation-${width}.png` });
    }
    await page.unroute('**/api/v1/db/backups/restore');
    await page.route('**/api/v1/db/backups/restore', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'انتهى التأكيد؛ أعد تأكيد هويتك', code: 'CONFIRMATION_INVALID' }) }));
    await dialog.getByLabel('كلمة المرور الحالية').fill('Madar@Demo2026');
    await dialog.getByRole('button', { name: 'تأكيد وتنفيذ الاستعادة' }).click();
    await expect(dialog.getByRole('alert')).toContainText('انتهى التأكيد');
    await expect(dialog.getByLabel('كلمة المرور الحالية')).toHaveValue('');
    await page.unroute('**/api/v1/db/backups/restore');
    const stats = (await (await page.request.get('/api/v1/db/stats')).json()).data;
    let restorationRequests = 0;
    await page.route('**/api/v1/db/backups/restore', async route => {
      restorationRequests++; await new Promise(resolve => setTimeout(resolve, 150));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: stats }) });
    });
    await dialog.getByLabel('كلمة المرور الحالية').fill('Madar@Demo2026');
    await dialog.getByRole('button', { name: 'تأكيد وتنفيذ الاستعادة' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect(dialog).not.toBeVisible();
    expect(restorationRequests).toBe(1);
    await expect(restore).toBeFocused();
    await page.unroute('**/api/v1/db/backups/restore');
    await page.route('**/api/v1/db/stats', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ...stats, confirmationTotpRequired: true } }) }));
    await restore.click();
    await expect(dialog.getByLabel('رمز المصادقة الثنائية')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.unroute('**/api/v1/db/stats');
    const snapshotDownload = page.waitForEvent('download');
    await row.getByRole('link', { name: 'تحميل النسخة' }).click();
    expect((await snapshotDownload).suggestedFilename()).toMatch(/^newsroom_backup_.*\.sqlite$/);
    await tabs.getByRole('tab', { name: 'آخر أخطاء الخادم' }).click();
    await expect(page.getByRole('heading', { name: 'آخر أخطاء الخادم' })).toBeVisible();
    await tabs.getByRole('tab', { name: 'آخر أخطاء الخادم' }).focus();
    await page.keyboard.press('Home');
    await expect(tabs.getByRole('tab', { name: 'استعلامات SQL' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(tabs.getByRole('tab', { name: 'آخر أخطاء الخادم' })).toHaveAttribute('aria-selected', 'true');
    await page.getByLabel('بحث سجل الأخطاء').fill('unmatched-test');
    await expect(page.getByText('لا توجد أخطاء مطابقة للبحث')).toBeVisible();
    await page.getByLabel('بحث سجل الأخطاء').fill('');
    await page.route('**/api/v1/db/errors', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'تعذر تحميل السجل للاختبار' }) }));
    await page.getByRole('button', { name: 'تحديث سجل الأخطاء' }).click();
    await expect(page.getByRole('alert')).toContainText('تعذر تحميل السجل');
    await page.unroute('**/api/v1/db/errors');
    await page.getByRole('button', { name: 'تحديث سجل الأخطاء' }).click();
    const reportDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'تنزيل تقرير التشخيص' }).click();
    expect((await reportDownload).suggestedFilename()).toMatch(/^madar-diagnostics-.*\.json$/);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['نهاري', 'ليلي']) {
      await page.getByRole('button', { name: /^المظهر/ }).click();
      await page.getByRole('menuitemradio', { name: new RegExp(theme) }).click();
      await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined))));
      await page.addScriptTag({ content: axeSource });
      expect(await page.evaluate(async () => (await (window as any).axe.run('main', { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v: any) => ({ id: v.id, nodes: v.nodes.map((n: any) => ({ html: n.html, summary: n.failureSummary })) })))).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/database-operations-${width}-${theme === 'ليلي' ? 'dark' : 'light'}.png` });
      }
    }
    expect(errors).toEqual([]);
  } finally {
    const dialog = page.getByRole('dialog');
    if (await dialog.count()) await dialog.getByRole('button', { name: 'إغلاق', exact: true }).click();
    await close();
  }
});
