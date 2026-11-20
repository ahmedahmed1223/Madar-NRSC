import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

const phone = { width: 320, height: 844 };
const desktop = { width: 1440, height: 900 };

test('resource booking uses the selected resource and day in both layouts', async ({ browser }, testInfo) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { viewport: phone });
  try {
    await page.goto('/bookings');
    const controls = page.getByRole('group', { name: 'تاريخ الحجوزات وإجراءاتها' });
    const date = controls.getByLabel('اليوم', { exact: true });
    const initialDay = await date.inputValue();
    await controls.getByRole('button', { name: 'اليوم التالي' }).click();
    await expect(date).not.toHaveValue(initialDay);
    const selectedDay = await date.inputValue();
    const schedule = page.getByRole('region', { name: 'جدول الموارد' });
    const camera = schedule.getByRole('button', { name: 'حجز كاميرا ميدانية A', exact: true });
    await expect(camera).toBeVisible();
    expect(await schedule.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('bookings-mobile.png') });
    for (const viewport of [phone, desktop]) {
      await page.setViewportSize(viewport);
      await camera.click();
      const form = page.locator('#form-page-root');
      await expect(form.getByLabel('المورد').locator('option:checked')).toHaveText('كاميرا ميدانية A');
      await expect(form.getByLabel('من', { exact: true })).toHaveValue(new RegExp(`^${selectedDay}T`));
      await page.keyboard.press('Escape');
      await expect(form.getByLabel('من', { exact: true })).toHaveCount(0);
    }
    await expect(camera.locator('..')).toHaveCSS('position', 'sticky');
    await page.locator('.app-scroll').evaluate((node) => { node.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath('bookings-desktop.png') });
    await page.setViewportSize({ width: 1100, height: 900 });
    const xBefore = (await camera.boundingBox())!.x;
    const scrollLeft = await schedule.evaluate((node) => {
      node.scrollLeft = -(node.scrollWidth - node.clientWidth);
      return node.scrollLeft;
    });
    expect(scrollLeft).toBeLessThan(0);
    await expect.poll(async () => (await camera.boundingBox())!.x).toBeCloseTo(xBefore, 0);
  } finally {
    await close();
  }
});

test('the daily roster and weekly grid share the same shift assignments', async ({ browser }, testInfo) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { viewport: phone });
  try {
    const { user } = await (await page.request.get('/api/v1/auth/me')).json();
    await page.goto('/roster');
    const navigation = page.getByRole('group', { name: 'أسبوع المناوبات' });
    const day = page.getByLabel('يوم المناوبة');
    await expect(day).toBeVisible();
    const originalDay = await day.inputValue();
    await navigation.getByRole('button', { name: 'الأسبوع التالي' }).click();
    await expect(day).not.toHaveValue(originalDay);
    const selectedDay = await day.locator('option').nth(1).getAttribute('value');
    expect(selectedDay).toBeTruthy();
    await day.selectOption(selectedDay!);
    const daily = page.getByRole('region', { name: 'مناوبات اليوم المختار' });
    const morning = daily.getByRole('region', { name: 'الصباحية', exact: true });
    await morning.getByRole('button', { name: /^إضافة مناوب/ }).click();
    await morning.getByRole('combobox', { name: 'اختر الموظف' }).selectOption(user.id);
    const assigned = morning.getByRole('button', { name: user.fullName, exact: true });
    await expect(assigned).toHaveAttribute('aria-pressed', 'false');
    await assigned.click();
    await expect(assigned).toHaveAttribute('aria-pressed', 'true');
    expect(await daily.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('roster-mobile.png') });
    await page.setViewportSize(desktop);
    const weekly = page.getByRole('region', { name: 'جدول المناوبات الأسبوعي' });
    await expect(weekly.getByRole('button', { name: user.fullName, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(weekly.getByRole('rowheader', { name: /الصباحية/ })).toHaveCSS('position', 'sticky');
    await page.screenshot({ path: testInfo.outputPath('roster-desktop.png') });
    await weekly.getByRole('button', { name: `إزالة ${user.fullName} من الوردية` }).click();
    await expect(weekly.getByRole('button', { name: user.fullName, exact: true })).toHaveCount(0);
  } finally {
    await close();
  }
});

test('report filters stay selected when the station comparison changes layout, and CSV follows them', async ({ browser }, testInfo) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { viewport: phone });
  try {
    await page.goto('/reports');
    const filters = page.getByRole('group', { name: 'تصفية التقارير' });
    const week = filters.getByRole('button', { name: 'آخر 7 أيام', exact: true });
    await week.click();
    const station = filters.getByLabel('المحطة', { exact: true });
    const stationValue = await station.locator('option').nth(1).getAttribute('value');
    expect(stationValue).toBeTruthy();
    await station.selectOption(stationValue!);
    const comparison = page.getByRole('region', { name: 'جدول المحطات' });
    await expect(comparison.getByRole('rowheader').first()).toBeVisible();
    expect(await comparison.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
    await comparison.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('reports-mobile.png') });
    await page.setViewportSize(desktop);
    await expect(week).toHaveAttribute('aria-pressed', 'true');
    await expect(station).toHaveValue(stationValue!);
    await expect(comparison.getByRole('rowheader').first()).toHaveCSS('position', 'sticky');
    await page.locator('.app-scroll').evaluate((node) => { node.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath('reports-desktop.png') });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'تصدير تقرير CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toContain(`report_week_all_${stationValue!.replace(':', '-')}_`);
  } finally {
    await close();
  }
});
