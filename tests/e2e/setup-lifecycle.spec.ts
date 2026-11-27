import { browserBuildDir } from './buildDir';
import { expect, test } from '@playwright/test';
import express from 'express';
import { build } from 'esbuild';
import { createTestServer, listen } from '../helpers';

for (const mode of ['browser', 'browser-temporary', 'sign-in'] as const) {
  test(`starts ${mode} setup directly from Login and reaches the organization wizard`, async ({ browser }) => {
    const token = 'example-browser-setup-token-1234567890';
    const email = 'first-owner@example.com';
    const temporary = 'InitialOwner2026';
    const password = 'PrivateOwner2026';
    const browserSetup = mode !== 'sign-in';
    let initialPassword = browserSetup ? undefined : temporary;
    const instance = await createTestServer({
      NODE_ENV: 'production',
      SEED_DEMO_DATA: 'false',
      ...(browserSetup ? { INSTALL_SETUP_TOKEN: token } : { ADMIN_EMAIL: email, ADMIN_PASSWORD: temporary }),
    });
    const dist = browserBuildDir;
    instance.app.use(express.static(dist));
    instance.app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: dist }));
    const http = await listen(instance.app);
    const context = await browser.newContext({ baseURL: http.baseUrl, viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      await page.goto('/');
      const launcher = page.getByRole('button', { name: 'بدء إعداد النظام' });
      await expect(launcher).toHaveAttribute('aria-expanded', 'false');
      const hint = page.getByRole('group', { name: 'بيانات الدخول الأولى' });
      await expect(hint).toBeVisible();
      await expect(hint).toContainText('اسم المستخدم');
      await expect(hint).toContainText('كلمة المرور الأولى');
      await expect(hint).toContainText(browserSetup ? 'اخترها في المعالج' : 'سجل التشغيل الأول');
      await expect(hint).not.toContainText(email);
      await expect(hint).not.toContainText(temporary);
      await launcher.press('Enter');
      const journey = page.getByRole('list', { name: 'رحلة إعداد مدار' });
      await expect(journey.getByRole('listitem')).toHaveCount(3);
      await expect(journey).toContainText(browserSetup ? 'إنشاء حساب المسؤول' : 'الدخول بحساب المسؤول');
      await expect(page.getByText(/تبدأ التهيئة بقيم قابلة للتعديل/)).toBeVisible();
      if (browserSetup) {
        await page.getByLabel('اسم المسؤول').fill('مدير غرفة الأخبار');
        await page.getByLabel('بريد المسؤول').fill(email);
        await page.getByLabel('رمز إعداد الخادم').fill(token);
        const newPassword = page.getByLabel('كلمة المرور', { exact: true });
        const confirmation = page.getByLabel('تأكيد كلمة المرور');
        await expect(newPassword).toHaveAttribute('type', 'password');
        if (mode === 'browser-temporary') {
          await page.getByRole('button', { name: 'توليد كلمة مرور مؤقتة', exact: true }).click();
          await expect(newPassword).toHaveAttribute('type', 'text');
          initialPassword = await newPassword.inputValue();
          expect(initialPassword).toHaveLength(12);
          await expect(confirmation).toHaveValue(initialPassword);
          await newPassword.fill(`${initialPassword}a`);
          await newPassword.fill(initialPassword);
          const persisted = await page.evaluate(value => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(item => item.includes(value)), initialPassword);
          expect(persisted).toBe(false);
        } else {
          await newPassword.fill('Short1');
          await confirmation.fill('Different2026');
          await expect(page.getByText('تأكيد كلمة المرور غير مطابق.')).toBeVisible();
          await newPassword.fill(password);
          await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: http.baseUrl });
          await page.evaluate(value => navigator.clipboard.writeText(value), password);
          await confirmation.press('Control+a');
          await confirmation.press('Control+v');
          await expect(confirmation).toHaveValue(password);
          await expect(confirmation).toBeFocused();
          await page.evaluate(() => navigator.clipboard.writeText(''));
          await expect(page.getByText('تأكيد كلمة المرور مطابق.')).toBeVisible();
          await page.getByRole('button', { name: 'إظهار كلمة المرور' }).click();
          await expect(newPassword).toHaveAttribute('type', 'text');
          await page.getByRole('button', { name: 'إخفاء كلمة المرور' }).click();
          await expect(newPassword).toHaveAttribute('type', 'password');
        }
        await page.getByRole('button', { name: 'إنشاء الحساب والمتابعة' }).click();
      } else {
        await page.getByLabel('البريد الإلكتروني').fill(email);
        await page.getByLabel('كلمة المرور', { exact: true }).fill(temporary);
        await page.getByRole('checkbox', { name: 'تذكّرني على هذا الجهاز', exact: true }).check();
        await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
      }
      if (initialPassword) {
        await expect(page.getByRole('heading', { name: 'تغيير كلمة المرور' })).toBeVisible();
        expect((await context.cookies()).find(cookie => cookie.name === 'nrcs_sid')?.expires).toBe(-1);
        await page.getByLabel('كلمة المرور الحالية').fill(initialPassword);
        await page.getByLabel('كلمة المرور الجديدة', { exact: true }).fill(password);
        await page.getByLabel('تأكيد كلمة المرور الجديدة').fill(password);
        await page.getByRole('button', { name: 'حفظ كلمة المرور' }).click();
      }
      const wizard = page.getByRole('region', { name: 'الإعداد السريع للنظام' });
      await expect(wizard.getByLabel('اسم المؤسسة *')).toBeVisible();
      await expect(wizard.getByText(/القيم الأولية لهوية النظام/)).toBeVisible();
      await expect(page.getByText('حسابات التجربة', { exact: true })).toHaveCount(0);
      if (mode === 'browser') {
        const colors = wizard.getByRole('group', { name: 'ألوان الواجهة' });
        await expect(colors.getByRole('radio')).toHaveCount(4);
        await colors.getByRole('radio', { name: 'أخضر زيتوني' }).check();
        await wizard.getByRole('button', { name: 'حفظ والمتابعة' }).click();
        await expect(page.locator('html')).toHaveAttribute('data-color-palette', 'olive');
        await wizard.getByRole('button', { name: /المؤسسة/ }).click();
        const engine = wizard.getByRole('region', { name: 'محرك قاعدة البيانات' });
        await expect(engine).toBeHidden();
        await wizard.getByText('خيارات قاعدة البيانات', { exact: true }).click();
        await expect(engine).toBeVisible();
        await wizard.getByRole('button', { name: /الفريق/ }).click();
        await wizard.locator('#setup-member-name').fill('محرر المناوبة');
        await wizard.locator('#setup-member-email').fill('shift-editor@example.com');
        await wizard.locator('#setup-member-password').fill('ShiftEditor2026');
        await wizard.getByRole('button', { name: 'حفظ الزميل والمتابعة' }).click();
        await expect(wizard.getByText('حُفظ حساب الزميل وسُجّلت خطوة الفريق.')).toBeVisible();
        await wizard.getByRole('button', { name: /الانتهاء/ }).click();
        await wizard.getByRole('button', { name: 'إنهاء الإعداد', exact: true }).click();
        await wizard.getByRole('button', { name: 'فتح مساحة العمل', exact: true }).click();
        await expect(wizard).toHaveCount(0);
        await page.goto('/users');
        await expect(page.getByText('محرر المناوبة', { exact: true }).first()).toBeVisible();
      }
      const freshPage = await browser.newPage({ baseURL: http.baseUrl });
      try {
        const setupResponse = freshPage.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/setup');
        await freshPage.goto('/');
        expect((await (await setupResponse).json()).data.mode).toBeNull();
        await expect(freshPage.getByRole('button', { name: 'تسجيل الدخول', exact: true })).toBeVisible();
        await expect(freshPage.getByRole('button', { name: 'بدء إعداد النظام' })).toHaveCount(0);
        await expect(freshPage.getByRole('group', { name: 'بيانات الدخول الأولى' })).toHaveCount(0);
        await expect(freshPage.getByRole('button', { name: 'توليد كلمة مرور مؤقتة' })).toHaveCount(0);
        if (mode === 'browser') {
          await expect(freshPage.locator('html')).toHaveAttribute('data-color-palette', 'olive');
          await freshPage.getByLabel('البريد الإلكتروني').fill('shift-editor@example.com');
          await freshPage.getByLabel('كلمة المرور', { exact: true }).fill('ShiftEditor2026');
          await freshPage.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
          await expect(freshPage.getByRole('heading', { name: 'تغيير كلمة المرور' })).toBeVisible();
        }
      } finally {
        await freshPage.close();
      }
    } finally {
      await context.close();
      await http.close();
      instance.close();
    }
  });
}

test('opening a new form in React Strict Mode keeps its browser history entry', async ({ page }) => {
  test.setTimeout(120_000);
  // The production React bundle omits the effect replay used in development previews.
  const { outputFiles: [script] } = await build({
    bundle: true,
    write: false,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    stdin: {
      loader: 'tsx',
      resolveDir: process.cwd(),
      contents: `
        import { StrictMode, useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { FormPage } from './src/components/common/FormPage';

        function SetupEntry() {
          const [open, setOpen] = useState(false);
          return <>
            <main><button onClick={() => setOpen(true)}>فتح المعالج</button></main>
            <div id="form-page-root" />
            {open && <FormPage isOpen onClose={() => setOpen(false)} title="معالج الإعداد">
              <input aria-label="اسم المؤسسة" defaultValue="مدار" />
            </FormPage>}
          </>;
        }
        createRoot(document.querySelector('#root')).render(<StrictMode><SetupEntry /></StrictMode>);
      `,
    },
  });
  await page.route('**/setup-history-test', route => route.fulfill({
    contentType: 'text/html; charset=UTF-8',
    body: '<style>.form-page-open main { display: none }</style><div id="root"></div><script src="/setup-history-test.js"></script>',
  }));
  await page.route('**/setup-history-test.js', route => route.fulfill({ contentType: 'text/javascript; charset=UTF-8', body: script.text }));
  await page.goto('/setup-history-test');

  const launcher = page.getByRole('button', { name: 'فتح المعالج' });
  await launcher.click();
  const organization = page.getByRole('textbox', { name: 'اسم المؤسسة' });
  await expect(organization).toBeFocused();
  await expect(organization).toHaveValue('مدار');
  await page.goBack();
  await expect(launcher).toBeVisible();
  await expect(page).toHaveURL(/\/setup-history-test$/);
});

test('first setup, institutional administrator and demo cleanup use the saved organization', async ({ browser }) => {
  // Cleanup removes samples. Give this journey its own database even when the entire suite runs.
  const instance = await createTestServer();
  const dist = browserBuildDir;
  instance.app.use(express.static(dist));
  instance.app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: dist }));
  const http = await listen(instance.app);
  const context = await browser.newContext({ baseURL: http.baseUrl });
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'بدء إعداد النظام' }).click();
    await expect(page.getByText(/اختر حساب مدير النظام من حسابات التجربة/)).toBeVisible();
    await page.getByRole('list', { name: 'حسابات التجربة' }).getByRole('button').filter({ hasText: 'admin@akhbar.tv' }).click();
    const wizard = page.getByRole('region', { name: 'الإعداد السريع للنظام' });
    const name = wizard.getByLabel('اسم المؤسسة *');
    await expect(name).not.toHaveValue('');
    await name.fill('غرفة أخبار المؤسسة');
    await wizard.getByLabel('عرض الساعة').selectOption('h12');
    await wizard.getByRole('button', { name: 'حفظ والمتابعة' }).click();
    await wizard.getByRole('button', { name: 'إنشاء حساب مسؤول' }).click();
    await wizard.getByLabel('اسم المسؤول', { exact: true }).fill('مدير الفريق');
    await wizard.getByLabel('بريد المسؤول').fill('team-admin@example.com');
    const initialPassword = wizard.getByLabel('كلمة المرور المؤقتة', { exact: true });
    const initialConfirmation = wizard.getByLabel('تأكيد كلمة المرور');
    await expect(initialPassword).toHaveAttribute('type', 'password');
    await initialPassword.fill('Short1');
    await initialConfirmation.fill('Different2026');
    await expect(wizard.getByText('تأكيد كلمة المرور غير مطابق.')).toBeVisible();
    await initialPassword.fill('Temporary2026');
    await initialConfirmation.fill('Temporary2026');
    await expect(wizard.getByText('تأكيد كلمة المرور مطابق.')).toBeVisible();
    await wizard.getByRole('button', { name: 'إظهار كلمة المرور' }).click();
    await expect(initialPassword).toHaveAttribute('type', 'text');
    await wizard.getByRole('button', { name: 'إخفاء كلمة المرور' }).click();
    await expect(initialPassword).toHaveAttribute('type', 'password');
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
    await page.getByRole('navigation', { name: 'أقسام الإعدادات' }).getByRole('button', { name: 'البيانات', exact: true }).click();
    await expect(wizard).toHaveCount(0);
    await expect(card.getByRole('button', { name: /حذف البيانات التجريبية \(0\)/ })).toBeDisabled();
    await card.getByRole('button', { name: 'فتح معالج الإعداد' }).click();
    await expect(name).toHaveValue('غرفة أخبار المؤسسة');
    await expect(wizard.getByLabel('عرض الساعة')).toHaveValue('h12');
    await wizard.getByRole('button', { name: 'رجوع', exact: true }).click();

    await card.getByLabel(/حذف حسابات المستخدمين التجريبيين/).check();
    await card.getByLabel('تأكيد الحذف').fill('حذف');
    await card.getByRole('button', { name: /حذف البيانات التجريبية/ }).click();
    await expect(name).toHaveValue('غرفة أخبار المؤسسة');
    await wizard.getByRole('button', { name: 'رجوع', exact: true }).click();
    await expect(card.getByText(/لا توجد أمثلة أو حسابات تجريبية متاحة للحذف/)).toBeVisible();
    await card.getByRole('button', { name: 'فتح معالج الإعداد' }).click();
    await expect(name).toHaveValue('غرفة أخبار المؤسسة');
  } finally {
    await context.close();
    await http.close();
    instance.close();
  }
});
