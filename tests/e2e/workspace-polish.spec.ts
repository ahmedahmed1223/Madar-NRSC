import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD, enterWorkspace } from './helpers';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  const response = await page.request.post('/api/v1/auth/login', {
    headers: { 'X-NRCS-Client': 'web' },
    data: { email: 'admin@akhbar.tv', password: DEMO_PASSWORD },
  });
  expect(response.ok()).toBe(true);
  await page.goto('/');
  await enterWorkspace(page);
});

for (const width of [320, 1440]) {
  test(`export documents and close the notification inbox at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/episodes');
    const bell = page.getByRole('button', { name: /^الإشعارات/ });
    await bell.click();
    const inbox = page.locator('#notification-inbox');
    const box = await inbox.boundingBox();
    expect(box!.width).toBeGreaterThan(250);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await inbox.getByRole('button', { name: 'إغلاق الإشعارات' }).click();
    await expect(bell).toBeFocused();

    const trigger = page.getByRole('button', { name: 'تصدير وطباعة' });
    await trigger.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'تصدير وطباعة' });
    await expect(dialog.getByRole('button', { name: /— طباعة$/ })).toBeFocused();
    await dialog.getByRole('button', { name: /— PDF$/ }).click();
    const preview = page.getByRole('dialog', { name: 'معاينة الطباعة' });
    const frame = preview.locator('iframe');
    await expect(frame.contentFrame().getByRole('heading', { level: 1 })).toBeVisible();
    await expect(frame.contentFrame().locator('html')).toHaveAttribute('dir', 'rtl');
    await page.screenshot({ path: info.outputPath(`preview-${width}.png`) });
    if (width === 1440) {
      const printed = await page.context().newPage();
      try {
        await printed.setContent((await frame.getAttribute('srcdoc'))!);
        const pdf = await printed.pdf({ path: info.outputPath('episode-schedule.pdf'), preferCSSPageSize: true });
        const size = /\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf.toString('latin1'));
        expect(size).toBeTruthy();
        const sides = [Number(size![1]), Number(size![2])].sort((a, b) => a - b);
        expect(Math.abs(sides[0] - 595)).toBeLessThan(2);
        expect(Math.abs(sides[1] - 842)).toBeLessThan(2);
      } finally {
        await printed.close();
      }
    }
    await frame.evaluate((element: HTMLIFrameElement) => {
      element.contentWindow!.print = () => { element.dataset.prints = String(Number(element.dataset.prints || 0) + 1); };
    });
    await preview.getByRole('button', { name: 'متابعة إلى حفظ PDF' }).click();
    await expect(frame).toHaveAttribute('data-prints', '1');
    await page.keyboard.press('Control+p');
    await expect(frame).toHaveAttribute('data-prints', '2');
    await preview.getByRole('button', { name: 'إغلاق', exact: true }).click();
    await expect(dialog.getByRole('button', { name: /— PDF$/ })).toBeFocused();
    const file = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /— Word$/ }).click();
    expect((await file).suggestedFilename()).toMatch(/\.docx$/);
    await expect(dialog.getByRole('status')).toContainText('بدأ تنزيل');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });
}

test('empty program layouts and episode filters return focus to search', async ({ page }) => {
  await page.goto('/programs');
  for (const name of ['البطاقات', 'القائمة']) {
    await page.getByRole('group', { name: 'عرض البرامج' }).getByRole('button', { name }).click();
    const search = page.getByRole('searchbox', { name: 'بحث عن برنامج' });
    await search.fill('no-such-program-8714');
    await expect(page.getByText('لا توجد برامج مطابقة للبحث.')).toBeVisible();
    await page.getByRole('button', { name: 'مسح الفلاتر' }).press('Enter');
    await expect(search).toBeFocused();
    await expect(search).toBeEmpty();
  }
  await page.goto('/episodes');
  const search = page.getByRole('searchbox', { name: 'البحث في الحلقات' });
  await page.locator('#episodes-status-filter').selectOption({ index: 1 });
  await search.fill('no-such-episode-8714');
  await page.getByRole('button', { name: 'مسح الفلاتر' }).click();
  await expect(page.locator('#episodes-status-filter')).toHaveValue('ALL');
  await expect(search).toBeFocused();
  await expect(search).toBeEmpty();
});

test('report and guide previews include printable content with working styles', async ({ page }) => {
  for (const [route, button, heading] of [
    ['/reports', 'طباعة التقرير', 'التقارير'],
    ['/guide', 'طباعة الدليل كاملاً', 'دليل الاستخدام'],
  ]) {
    await page.goto(route);
    await page.getByRole('button', { name: button, exact: true }).click();
    const preview = page.getByRole('dialog', { name: 'معاينة الطباعة' });
    const paper = preview.locator('iframe').contentFrame();
    await expect(paper.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
    await expect(paper.getByRole('button', { name: button, exact: true })).toHaveCount(0);
    if (route === '/reports') await expect(paper.locator('.print-only').first()).toBeVisible();
    await preview.getByRole('button', { name: 'إغلاق', exact: true }).click();
  }
});

test('guest directory search can retry the same query after a failed request', async ({ page }) => {
  await page.goto('/guests');
  await page.route('**/collections/guests?**', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }), { times: 1 });
  const search = page.getByRole('searchbox', { name: 'البحث في دليل الضيوف' });
  await search.fill('no-such-guest-8714');
  await expect(page.getByText(/تعذّر البحث في الدليل الكامل/)).toBeVisible();
  await page.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click();
  await expect(search).toHaveValue('no-such-guest-8714');
  await expect(page.getByText('لا ضيوف يطابقون البحث أو التخصص.')).toBeVisible();
});
