import { expect, test } from '@playwright/test';
import express from 'express';
import path from 'node:path';
import { createTestServer, DEMO_PASSWORD, listen } from '../helpers';

test('first setup, institutional administrator and demo cleanup use the saved organization', async ({ browser }) => {
  // Cleanup removes samples. Give this journey its own database even when the entire suite runs.
  const instance = await createTestServer();
  const dist = path.resolve('dist');
  instance.app.use(express.static(dist));
  instance.app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  const http = await listen(instance.app);
  const context = await browser.newContext({ baseURL: http.baseUrl });
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.locator('#login-email').fill('admin@akhbar.tv');
    await page.locator('#login-password').fill(DEMO_PASSWORD);
    await page.locator('button[type=submit]').click();
    const wizard = page.getByRole('region', { name: 'الإعداد السريع للنظام' });
    const name = wizard.getByLabel('اسم المؤسسة *');
    await expect(name).not.toHaveValue('');
    await name.fill('غرفة أخبار المؤسسة');
    await wizard.getByLabel('عرض الساعة').selectOption('h12');
    await wizard.getByRole('button', { name: 'حفظ والمتابعة' }).click();
    await wizard.getByRole('button', { name: 'إنشاء حساب مسؤول' }).click();
    await wizard.getByLabel('اسم المسؤول', { exact: true }).fill('مدير الفريق');
    await wizard.getByLabel('بريد المسؤول').fill('team-admin@example.com');
    await wizard.getByLabel('كلمة المرور المؤقتة', { exact: true }).fill('Temporary2026');
    await wizard.getByLabel('تأكيد كلمة المرور').fill('Temporary2026');
    await wizard.getByRole('button', { name: 'حفظ حساب المسؤول' }).click();
    await expect(wizard.getByRole('status').filter({ hasText: 'team-admin@example.com' })).toBeVisible();
    await wizard.getByRole('button', { name: 'متابعة', exact: true }).click();
    await expect(wizard.getByRole('heading', { name: 'المحطات', exact: true })).toBeVisible();
    await wizard.getByRole('button', { name: 'رجوع', exact: true }).click();
    await page.goto('/settings');
    await page.getByRole('navigation', { name: 'أقسام الإعدادات' }).getByRole('button', { name: /البيانات/ }).click();
    const card = page.getByTestId('demo-data-card');
    await card.getByLabel('تأكيد الحذف').fill('حذف');
    await card.getByRole('button', { name: /حذف البيانات التجريبية/ }).click();
    await expect(name).toHaveValue('غرفة أخبار المؤسسة');
    await expect(wizard.getByLabel('عرض الساعة')).toHaveValue('h12');
    await wizard.getByRole('button', { name: 'رجوع', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'أقسام الإعدادات' })).toBeVisible();
    await expect(wizard).toHaveCount(0);
  } finally {
    await context.close();
    await http.close();
    instance.close();
  }
});
