import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD, enterWorkspace } from './helpers';

// Request failures in this suite are injected at the browser route boundary.
test.use({ serviceWorkers: 'block' });

test('login stays within the viewport on small phones and wide desks', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#login-email')).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'تسجيل الدخول', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`login-${width}.png`), fullPage: true });
  }
});

test('mobile sign-in keeps credentials after a network failure and completes logout', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.locator('#login-email').fill('admin@akhbar.tv');
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.route('**/api/v1/auth/login', route => route.abort('failed'));
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('تحقق من الشبكة');
  await expect(page.locator('#login-password')).toHaveValue(DEMO_PASSWORD);
  await page.getByText('هل نسيت كلمة المرور؟', { exact: true }).click();
  await expect(page.getByText(/اطلب من مدير النظام إصدار كلمة مرور مؤقتة/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.unroute('**/api/v1/auth/login');
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await enterWorkspace(page);
  await page.getByRole('button', { name: /^الحساب / }).click();
  await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click();
  await expect(page.locator('#login-email')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'تم تسجيل الخروج بأمان' })).toBeVisible();
  await expect(page.locator('#login-password')).toHaveValue('');
});

test('two-factor sign-in focuses the code and accepts Arabic and Persian digits', async ({ page }) => {
  await page.goto('/');
  await page.route('**/api/v1/auth/login', route => route.fulfill({
    status: 403, contentType: 'application/json',
    body: JSON.stringify({ code: 'TOTP_REQUIRED', error: 'رمز التحقق مطلوب' }),
  }));
  await page.locator('#login-email').fill('admin@akhbar.tv');
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  const code = page.locator('#login-totp');
  await expect(code).toBeFocused();
  await code.fill('١٢٣٤٥٦');
  await expect(code).toHaveValue('123456');
  await code.fill('۱۲۳۴۵۶');
  await expect(code).toHaveValue('123456');
  await page.getByRole('button', { name: 'تبديل الحساب', exact: true }).click();
  await expect(page.locator('#login-email')).toBeFocused();
  await expect(page.locator('#login-password')).toHaveValue('');
});

test('logout failure stays visible and the operator can retry', async ({ page }) => {
    await page.goto('/');
    await page.locator('#login-email').fill('admin@akhbar.tv');
    await page.locator('#login-password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
    await enterWorkspace(page);
    await page.route('**/api/v1/auth/logout', route => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'temporarily unavailable' }),
    }));
    await page.getByRole('button', { name: /^الحساب / }).click();
    await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click();
    const feedback = page.getByRole('alert').filter({ hasText: 'تعذر إكمال تسجيل الخروج' });
    await expect(feedback).toBeVisible();
    await page.unroute('**/api/v1/auth/logout');
    await feedback.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click();
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(feedback).toHaveCount(0);
});
