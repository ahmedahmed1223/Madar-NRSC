import { expect, type Browser, type Page } from '@playwright/test';

export const DEMO_PASSWORD = 'Madar@Demo2026';

export async function openSettingsSection(page: Page, label: string) {
  const nav = page.getByRole('navigation', { name: 'أقسام الإعدادات' });
  await expect(nav).toBeVisible();
  const selector = nav.getByRole('combobox', { name: 'قسم الإعدادات' });
  if (await selector.isVisible()) {
    await selector.selectOption({ label });
  } else {
    await nav.getByRole('button', { name: label }).click();
  }
}

/** Signs in as a demo colleague in a fresh browser context; page errors fail the test. */
export async function signIn(browser: Browser, email: string, opts: { viewport?: { width: number; height: number }; bypassCSP?: boolean } = {}) {
  const context = await browser.newContext({ viewport: opts.viewport, bypassCSP: opts.bypassCSP });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Every confirmation is an in-app dialog now; a native one is a regression.
  page.on('dialog', (d) => {
    errors.push(`native ${d.type()} dialog: ${d.message()}`);
    void d.dismiss();
  });
  await page.goto('/');
  await page.fill('#login-email', email);
  await page.fill('#login-password', DEMO_PASSWORD);
  await page.click('button[type=submit]');
  await enterWorkspace(page);
  return { page, errors, close: async () => {
    await leaveEditors(page);
    await context.close();
  } };
}

export async function enterWorkspace(page: Page) {
  const main = page.locator('main');
  await expect(main).toBeAttached();
  const setup = page.getByRole('region', { name: 'الإعداد السريع للنظام' });
  if (await setup.isVisible()) await setup.getByRole('button', { name: 'رجوع', exact: true }).click();
  await expect(main).toBeVisible();
}

/** Let the normal UI unmount and confirm lock release before destroying the browser context. */
export async function leaveEditors(page: Page) {
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  const dialogs = page.locator('[role="dialog"], [role="alertdialog"]');
  if (await dialogs.count()) {
    await page.keyboard.press('Escape');
    await expect(dialogs).toHaveCount(0);
  }
  await openNav(page, 'الرئيسية');
  await expect.poll(async () => {
    const data = await (await page.request.get('/api/v1/data')).json();
    return (data.collections?.editLocks || []).filter((row: any) =>
      row.d.userId === me.user.id && Date.parse(row.d.expiresAt) > Date.now()).map((row: any) => row.id);
  }).toEqual([]);
}

/** Opens a screen from the sidebar by its label. */
export async function openNav(page: Page, label: string) {
  if (await page.locator('aside').getAttribute('aria-hidden') === 'true') {
    await page.getByRole('button', { name: 'فتح القائمة الرئيسية', exact: true }).click();
  }
  // Sections of the rail fold; open them all when the screen is in a folded one.
  // Section headers (they carry aria-expanded) can contain a screen's name, e.g. «غرفة الأخبار».
  const item = page.locator('aside nav button:not([aria-expanded])', { hasText: label }).first();
  if (!(await item.isVisible().catch(() => false))) {
    const folded = page.locator('aside nav button[aria-expanded="false"]');
    while (await folded.count()) await folded.first().click();
  }
  await item.click();
}
