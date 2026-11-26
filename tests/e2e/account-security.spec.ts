import { browserBuildDir } from './buildDir';
import { expect, test } from '@playwright/test';
import express from 'express';
import path from 'node:path';
import { totp } from '../../src/server/totp';
import { createTestServer, listen } from '../helpers';
import { openNav, signIn } from './helpers';
import { DEMO_PASSWORD } from './helpers';

test('login password visibility switches without submitting credentials', async ({ page }) => {
  await page.goto('/');
  const password = page.getByLabel('كلمة المرور', { exact: true });
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'إظهار كلمة المرور' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'إخفاء كلمة المرور' }).click();
  await expect(password).toHaveAttribute('type', 'password');
});

test('login accepts keyboard paste while remaining masked without a paste button', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await page.goto('/');
  const sample = 'Paste-Test-2026! ';
  await page.evaluate(text => navigator.clipboard.writeText(text), sample);
  const password = page.getByLabel('كلمة المرور', { exact: true });
  await password.focus();
  await page.keyboard.press('Control+V');
  await expect(password).toHaveValue(sample);
  await expect(password).toHaveAttribute('type', 'password');
  await expect(page.getByRole('button', { name: 'لصق كلمة المرور', exact: true })).toHaveCount(0);
  await page.evaluate(() => navigator.clipboard.writeText(''));
});

test('the login two-factor challenge can return to account selection', async ({ browser }) => {
  const instance = await createTestServer();
  instance.app.use(express.static(browserBuildDir));
  instance.app.get('/{*path}', (_req, res) => res.sendFile(path.join(browserBuildDir, 'index.html')));
  const http = await listen(instance.app);
  const context = await browser.newContext({ baseURL: http.baseUrl });
  try {
    const page = await context.newPage();
    const api = context.request;
    const headers = { 'X-NRCS-Client': 'web' };
    const producer = { email: 'producer@akhbar.tv', password: DEMO_PASSWORD };

    const signedIn = await api.post(`${http.baseUrl}/api/v1/auth/login`, { headers, data: producer });
    expect(signedIn.ok()).toBe(true);
    const setup = await api.post(`${http.baseUrl}/api/v1/auth/2fa/setup`, { headers, data: { password: DEMO_PASSWORD } });
    const secret = (await setup.json()).secret as string;
    const enabled = await api.post(`${http.baseUrl}/api/v1/auth/2fa/enable`, { headers, data: { code: totp(secret) } });
    expect(enabled.ok()).toBe(true);
    await api.post(`${http.baseUrl}/api/v1/auth/logout`, { headers });

    await page.goto('/');
    await page.getByLabel('البريد الإلكتروني').fill(producer.email);
    await page.getByLabel('كلمة المرور', { exact: true }).fill(producer.password);
    await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
    await expect(page.getByLabel('رمز التحقق من تطبيق المصادقة')).toBeVisible();
    await page.getByRole('button', { name: 'تبديل الحساب' }).click();
    await expect(page.getByLabel('رمز التحقق من تطبيق المصادقة')).toHaveCount(0);
    await expect(page.getByLabel('البريد الإلكتروني')).toHaveValue('');
    await expect(page.getByLabel('كلمة المرور', { exact: true })).toHaveValue('');

    await page.getByLabel('البريد الإلكتروني').fill('admin@akhbar.tv');
    await page.getByLabel('كلمة المرور', { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
    await expect(page.locator('#login-email')).toHaveCount(0);
  } finally {
    await context.close();
    await http.close();
    instance.close();
  }
});

test('user table offers account actions and temporary password feedback', async ({ browser }) => {
  const session = await signIn(browser, 'admin@akhbar.tv');
  try {
    const { page } = session;
    await page.getByRole('button', { name: /^الحساب/ }).click();
    await page.getByRole('button', { name: /التحقق بخطوتين/ }).click();
    const twoFactor = page.getByRole('dialog', { name: 'التحقق بخطوتين (تطبيق المصادقة)' });
    const twoFactorPassword = twoFactor.getByLabel('كلمة المرور الحالية');
    await expect(twoFactorPassword).toHaveAttribute('type', 'password');
    await twoFactor.getByRole('button', { name: 'إظهار كلمة المرور' }).click();
    await expect(twoFactorPassword).toHaveAttribute('type', 'text');
    await twoFactor.getByRole('button', { name: 'إخفاء كلمة المرور' }).click();
    await expect(twoFactorPassword).toHaveAttribute('type', 'password');
    await page.keyboard.press('Escape');
    await expect(twoFactor).toHaveCount(0);

    await openNav(page, 'المستخدمون والصلاحيات');
    await expect(page.getByRole('heading', { name: 'المستخدمون والصلاحيات' })).toBeVisible();
    await page.getByRole('button', { name: 'عرض جدول' }).click();

    const manageableRow = page.locator('tbody tr').filter({ has: page.getByRole('button', { name: /إنهاء جلسات/ }) }).first();
    await expect(manageableRow).toBeVisible();
    await expect(manageableRow.getByRole('button', { name: /تجميد حساب/ })).toBeVisible();
    await expect(manageableRow.getByRole('button', { name: /حذف حساب/ })).toBeVisible();

    await page.getByRole('button', { name: 'إضافة مستخدم جديد' }).click();
    await page.getByRole('button', { name: 'توليد مؤقتة' }).click();
    const password = page.locator('#user-form-modal-field-5');
    await expect(password).toHaveAttribute('type', 'text');
    await expect(page.getByText('تأكيد كلمة المرور مطابق.')).toBeVisible();
    await page.getByRole('button', { name: 'إخفاء كلمة المرور' }).click();
    await expect(password).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'إلغاء', exact: true }).click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'تصدير القائمة (CSV)' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  } finally {
    await session.close();
  }
});
