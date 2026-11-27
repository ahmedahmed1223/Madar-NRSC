import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD, enterWorkspace } from './helpers';

// Request failures in this suite are injected at the browser route boundary.
test.use({ serviceWorkers: 'block' });

test('login stays within the viewport on small phones and wide desks', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#login-email')).toBeVisible();
  const entry = page.getByRole('region', { name: 'الدخول إلى مدار' });
  await expect(entry.getByText('لوحة التحكم للمنصة', { exact: true })).toBeVisible();
  await expect(entry.getByRole('heading', { name: 'مدار', exact: true })).toHaveCSS('font-family', /IBM Plex Sans Arabic/);
  const logo = entry.locator('img[src="/icon-192.png"]');
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(192);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/icon-192.png');
  const health = await page.request.get('/api/health');
  expect(health.ok()).toBe(true);
  const { version } = await health.json();
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  const buildVersion = page.getByText(`الإصدار ${version}`, { exact: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'تسجيل الدخول', exact: true })).toBeVisible();
    await expect(buildVersion).toBeVisible();
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
    await page.route('**/api/v1/data', route => route.abort('internetdisconnected'));
    await page.getByRole('button', { name: /^الحساب / }).click();
    await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click();
    const feedback = page.getByRole('alert').filter({ hasText: 'تعذر إكمال تسجيل الخروج' });
    await expect(feedback).toBeVisible();
    await page.unroute('**/api/v1/auth/logout');
    await page.unroute('**/api/v1/data');
    await feedback.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click();
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(feedback).toHaveCount(0);
});

test('remembering this device creates an opt-in cookie that logout removes', async ({ page }) => {
  await page.goto('/');
  const remember = page.getByRole('checkbox', { name: 'تذكّرني على هذا الجهاز', exact: true });
  await expect(remember).not.toBeChecked();
  await page.locator('#login-email').fill('editor@akhbar.tv');
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await remember.check();
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await enterWorkspace(page);
  const session = (await page.context().cookies()).find(cookie => cookie.name === 'nrcs_sid');
  expect(session?.httpOnly).toBe(true);
  expect(session?.expires).toBeGreaterThan(Date.now() / 1000 + 86_400);
  await page.route('**/api/v1/auth/logout', route => route.fulfill({
    status: 200, contentType: 'text/html', body: '<html>Proxy response</html>',
  }));
  await page.getByRole('button', { name: /^الحساب / }).click();
  await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click();
  const feedback = page.getByRole('alert').filter({ hasText: 'تعذر إكمال تسجيل الخروج' });
  await expect(feedback).toBeVisible();
  expect((await page.context().cookies()).some(cookie => cookie.name === 'nrcs_sid')).toBe(true);
  await page.unroute('**/api/v1/auth/logout');
  await feedback.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click();
  await expect(remember).not.toBeChecked();
  expect((await page.context().cookies()).some(cookie => cookie.name === 'nrcs_sid')).toBe(false);
});

test('logout still revokes the session when local air storage is inaccessible', async ({ page }) => {
  await page.goto('/');
  await page.locator('#login-email').fill('editor@akhbar.tv');
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await enterWorkspace(page);
  await page.evaluate(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, version) {
      if (name === 'madar-offline-air-v1') throw new DOMException('Blocked offline storage', 'SecurityError');
      return open.call(this, name, version);
    };
  });
  await page.getByRole('button', { name: /^الحساب / }).click();
  await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'تعذّر حذف نسخ الهواء المشفّرة' })).toBeVisible();
  expect((await page.context().cookies()).some(cookie => cookie.name === 'nrcs_sid')).toBe(false);
});
