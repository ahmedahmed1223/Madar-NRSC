import { expect, type Browser, type Page } from '@playwright/test';

export const DEMO_PASSWORD = 'Madar@Demo2026';

/** Signs in as a demo colleague in a fresh browser context; page errors fail the test. */
export async function signIn(browser: Browser, email: string, opts: { viewport?: { width: number; height: number } } = {}) {
  const context = await browser.newContext({ viewport: opts.viewport });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('/');
  await page.fill('#login-email', email);
  await page.fill('#login-password', DEMO_PASSWORD);
  await page.click('button[type=submit]');
  await expect(page.locator('main')).toBeVisible();
  return { page, errors, close: () => context.close() };
}

/** Opens a screen from the sidebar by its label. */
export async function openNav(page: Page, label: string) {
  await page.locator('aside nav button', { hasText: label }).first().click();
}
