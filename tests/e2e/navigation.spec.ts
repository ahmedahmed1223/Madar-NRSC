import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('the address follows the screen: Back/Forward, reload and deep links', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'البرقيات');
  await expect(page).toHaveURL(/\/wires$/);
  await expect(page).toHaveTitle(/البرقيات · مدار/);
  await openNav(page, 'المهام');
  await expect(page).toHaveURL(/\/tasks$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/wires$/);
  await expect(page.locator('main')).toContainText('البرقيات');
  await page.goForward();
  await expect(page).toHaveURL(/\/tasks$/);

  // A story has its own address that survives a reload.
  await openNav(page, 'الأخبار');
  await expect(page).toHaveURL(/\/news$/);
  await page.locator('button[title="تحرير الخبر"]').first().click();
  await expect(page).toHaveURL(/\/news\/[^/]+$/);
  const title = await page.locator('input').first().inputValue();
  await expect(page).toHaveTitle(new RegExp(`محرر الخبر · مدار`));
  const storyUrl = page.url();
  await page.reload();
  await expect(page.locator('input').first()).toHaveValue(title);
  await expect(page).toHaveURL(storyUrl);
  await page.goBack();
  await expect(page).toHaveURL(/\/news$/);

  // A typed address opens its screen directly; an unknown one lands on the dashboard.
  await page.goto('/bulletins');
  await expect(page.getByRole('heading', { name: 'النشرات' }).first()).toBeVisible();
  await page.goto('/no-such-screen');
  await expect(page).toHaveURL(/\/$/);
  expect(errors).toEqual([]);
  await close();
});

test('confirmations are in-app dialogs: Esc cancels, the button confirms, focus stays inside', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'journalist@akhbar.tv');
  await openNav(page, 'حجز الموارد');
  await page.getByRole('button', { name: 'حجز جديد' }).click();
  const form = page.locator('#form-page-root');
  await form.getByLabel('المورد').selectOption({ label: 'كاميرا ميدانية B' });
  await form.getByLabel('الغرض').fill('حجز لاختبار نافذة التأكيد');
  const day = await page.evaluate(() => {
    const d = new Date(Date.now() + 3 * 24 * 3600_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await form.getByLabel('من', { exact: true }).fill(`${day}T08:00`);
  await form.getByLabel('إلى', { exact: true }).fill(`${day}T09:00`);
  await form.getByRole('button', { name: 'احجز' }).click();
  await page.getByText('حجز لاختبار نافذة التأكيد').first().click();

  await page.getByRole('button', { name: 'إلغاء الحجز' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('إلغاء هذا الحجز؟');
  await expect(dialog.getByRole('button', { name: 'تأكيد' })).toBeFocused();
  // Tab cycles within the dialog.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'تأكيد' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'إلغاء الحجز' })).toBeVisible();

  await page.getByRole('button', { name: 'إلغاء الحجز' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'تأكيد' }).click();
  await expect(page.getByText('أُلغي الحجز').first()).toBeVisible();
  expect(errors).toEqual([]);
  await close();
});
