import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

const phone = { width: 320, height: 900 };
const desktop = { width: 1440, height: 900 };

test('media types keep their selection across layouts and legacy PDFs are discoverable', async ({ browser }, testInfo) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { viewport: phone });
  try {
    const id = 'media-responsive-pdf';
    const title = 'وثيقة اختبار من الأرشيف';
    const write = await page.request.post('/api/v1/data/sync', {
      headers: { 'X-NRCS-Client': 'web' },
      data: { ops: [{ c: 'media', op: 'upsert', id, d: {
        id, title, fileName: 'archive-fixture.pdf', mediaType: 'PDF', mimeType: 'application/pdf', url: '/archive-fixture.pdf', tags: [],
      } }] },
    });
    expect((await write.json()).results[0]).toMatchObject({ ok: true });
    await page.goto('/media');
    const mediaType = page.getByRole('combobox', { name: 'نوع الوسائط' });
    await mediaType.selectOption('DOCUMENT');
    const preview = page.getByRole('button', { name: `معاينة المادة: ${title}`, exact: true });
    await expect(preview).toBeVisible();
    expect((await preview.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath('media-mobile.png') });
    await preview.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: `معاينة المادة: ${title}` });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.setViewportSize(desktop);
    const tabs = page.getByRole('tablist', { name: 'نوع الوسائط' });
    await expect(tabs.getByRole('tab', { name: /الوثائق/ })).toHaveAttribute('aria-selected', 'true');
    await tabs.getByRole('tab', { name: /الكل/ }).click();
    await expect(preview).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('media-desktop.png') });
  } finally {
    await close();
  }
});

test('guest contacts and editing remain available after filtering and resizing', async ({ browser }, testInfo) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { viewport: phone });
  try {
    await page.goto('/guests');
    const card = page.getByRole('article').filter({ has: page.getByRole('link', { name: /^اتصال بـ/ }) }).first();
    const name = await card.getByRole('heading').textContent();
    const call = card.getByRole('link', { name: /^اتصال بـ/ });
    await expect(call).toHaveAttribute('href', /^tel:\+?\d+$/);
    expect((await call.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(phone.width);
    await page.screenshot({ path: testInfo.outputPath('guests-mobile.png') });
    const search = page.getByRole('searchbox', { name: 'البحث في دليل الضيوف' });
    await search.fill('تجربة بلا نتائج 82717');
    await expect(page.getByText('لا ضيوف يطابقون البحث أو التخصص.')).toBeVisible();
    await page.getByRole('button', { name: 'مسح الفلاتر' }).click();
    await expect(search).toBeEmpty();
    await page.setViewportSize(desktop);
    await page.screenshot({ path: testInfo.outputPath('guests-desktop.png') });
    await card.getByRole('button', { name: `تعديل بيانات الضيف: ${name}` }).click();
    await expect(page.locator('#guest-fullname-input')).toHaveValue(name!);
  } finally {
    await close();
  }
});

test('coverage diary shows the chosen day on a phone and the whole week on desktop', async ({ browser }, testInfo) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { viewport: phone, timezoneId: 'UTC' });
  try {
    await page.clock.setFixedTime(new Date('2026-11-27T22:30:00Z'));
    await page.goto('/diary');
    const week = page.getByRole('group', { name: 'أحداث الأسبوع' });
    const day = page.getByLabel('اليوم المعروض');
    await expect(week.getByRole('region')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('diary-mobile.png') });
    const date = await day.locator('option').nth(2).getAttribute('value');
    await day.selectOption(date!);
    await page.getByRole('button', { name: 'حدث جديد', exact: true }).click();
    const form = page.locator('#form-page-root');
    await expect(form.getByLabel('اليوم', { exact: true })).toHaveValue(date!);
    await page.keyboard.press('Escape');
    await expect(form.getByLabel('اليوم', { exact: true })).toHaveCount(0);
    // Create the event in the displayed week, independently of the date when demo data was seeded.
    const title = 'مؤتمر اختبار أجندة التغطية';
    await page.getByRole('button', { name: 'حدث جديد', exact: true }).click();
    await form.getByLabel('العنوان', { exact: true }).fill(title);
    await form.getByRole('button', { name: 'حفظ', exact: true }).click();
    await expect(form.getByLabel('اليوم', { exact: true })).toHaveCount(0);
    const search = page.getByRole('searchbox', { name: 'بحث في الأجندة' });
    await search.fill(title);
    await expect(day).toHaveValue('ALL');
    await expect(week.getByRole('button', { name: title })).toBeVisible();
    await search.fill('تجربة بلا نتائج 82717');
    await expect(page.getByText('لا أحداث في هذا الأسبوع تطابق الفلاتر.')).toBeVisible();
    await expect(week.getByRole('region')).toHaveCount(0);
    await search.clear();
    await page.setViewportSize(desktop);
    await expect(week.getByRole('region')).toHaveCount(7);
    const rows = await week.getByRole('region').evaluateAll((days) => new Set(days.map((day) => day.getBoundingClientRect().top)).size);
    expect(rows).toBe(1);
    await page.screenshot({ path: testInfo.outputPath('diary-desktop.png') });
  } finally {
    await close();
  }
});
