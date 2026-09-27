import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

const SCREENS = ['البرقيات', 'الأخبار', 'النشرات', 'أجندة التغطية', 'البرامج', 'الحلقات', 'وضع الهواء', 'طلبات الأقسام', 'حجز الموارد', 'المناوبات', 'المساعدة'];

test('every main screen opens without errors for the desk chief', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'editor@akhbar.tv');
  for (const label of SCREENS) {
    await openNav(page, label);
    await expect(page.locator('main h1').first()).toBeVisible();
    await expect(page.getByText('حدث خطأ غير متوقع')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
  await close();
});

test('screens also work in dark mode and on a phone', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'reporter@akhbar.tv', { viewport: { width: 390, height: 844 } });
  await page.evaluate(() => {
    localStorage.setItem('nrcs-theme', 'dark');
    document.documentElement.classList.add('dark');
  });
  await page.reload();
  await expect(page.locator('main')).toBeVisible();
  // No horizontal page scroll at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
  await close();
});

test('appearance menu: day, night, or follow the device', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'editor@akhbar.tv');
  await page.getByRole('button', { name: /^المظهر/ }).click();
  await page.getByRole('menuitemradio', { name: /ليلي/ }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: /^المظهر/ }).click();
  await page.getByRole('menuitemradio', { name: /نهاري/ }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.getByRole('button', { name: /^المظهر/ }).click();
  await page.getByRole('menuitemradio', { name: /حسب الجهاز/ }).click();
  expect(await page.evaluate(() => localStorage.getItem('nrcs-theme'))).toBeNull();
  expect(errors).toEqual([]);
  await close();
});
