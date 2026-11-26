import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('the address follows the screen: Back/Forward, reload and deep links', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'المصادر');
  await expect(page).toHaveURL(/\/wires$/);
  await expect(page).toHaveTitle(/المصادر · مدار/);
  await openNav(page, 'المهام');
  await expect(page).toHaveURL(/\/tasks$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/wires$/);
  await expect(page.locator('main')).toContainText('المصادر');
  await page.goForward();
  await expect(page).toHaveURL(/\/tasks$/);

  // A story has its own address that survives a reload.
  await openNav(page, 'الأخبار');
  await expect(page).toHaveURL(/\/news$/);
  await page.locator('button[title="تحرير الخبر"]').first().click();
  await expect(page).toHaveURL(/\/news\/[^/]+$/);
  const headline = page.locator('#news-headline-input');
  const title = await headline.inputValue();
  await expect(page).toHaveTitle(new RegExp(`محرر الخبر · مدار`));
  const storyUrl = page.url();
  await page.reload();
  await expect(headline).toHaveValue(title);
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

test('workspace history restores filtered episodes, broadcast selections and a breaking-news notification link', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'admin@akhbar.tv');
  try {
    await page.goto('/episodes');
    const program = page.locator('#episodes-program-filter');
    await program.selectOption('prg-1');
    await expect(page).toHaveURL(/\/episodes\?program=prg-1$/);
    await program.selectOption('prg-2');
    await expect(page).toHaveURL(/\/episodes\?program=prg-2$/);
    await page.goBack();
    await expect(program).toHaveValue('prg-1');
    await page.goForward();
    await expect(program).toHaveValue('prg-2');
    await page.reload();
    await expect(program).toHaveValue('prg-2');

    await page.goto('/on-air/ep-101');
    const airShow = page.getByLabel('الحلقة أو النشرة', { exact: true });
    await expect(airShow).toHaveValue('ep-101');
    await page.getByRole('button', { name: 'شاشة الاستديو', exact: true }).last().click();
    await expect(page).toHaveURL(/\/studio-screen\/ep-101$/);
    await expect(page.getByLabel('الحلقة', { exact: true })).toHaveValue('ep-101');
    await page.goBack();
    await expect(airShow).toHaveValue('ep-101');

    await page.goto('/requests?segment=seg-test');
    await expect(page.getByText(/طلبات الفقرة/)).toBeVisible();
    await page.getByRole('button', { name: 'عرض جميع الطلبات' }).click();
    await expect(page).toHaveURL(/\/requests$/);
    await page.goBack();
    await expect(page.getByText(/طلبات الفقرة/)).toBeVisible();

    await page.goto('/?open=%2Fnews%2Fnew%3Fbreaking%3D1');
    await expect(page).toHaveURL(/\/news\/new\?breaking=1$/);
    const headline = page.getByRole('heading', { name: 'خبر عاجل', exact: true });
    await expect(headline).toBeVisible();
    await page.reload();
    await expect(headline).toBeVisible();
    await openNav(page, 'الأخبار');
    await page.goBack();
    await expect(headline).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await close();
  }
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
  const cancel = dialog.getByRole('button', { name: 'إلغاء', exact: true });
  const confirm = dialog.getByRole('button', { name: 'تأكيد', exact: true });
  await expect(dialog).toContainText('إلغاء هذا الحجز؟');
  await expect(cancel).toBeFocused();
  // Tab cycles within the dialog.
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'إلغاء الحجز' })).toBeVisible();

  await page.getByRole('button', { name: 'إلغاء الحجز' }).click();
  await confirm.click();
  await expect(page.getByText('أُلغي الحجز').first()).toBeVisible();
  expect(errors).toEqual([]);
  await close();
});
