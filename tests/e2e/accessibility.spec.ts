import { expect, test, type Browser, type Page } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'fs';
import { DEMO_PASSWORD, leaveEditors } from './helpers';

/**
 * WCAG 2.x A/AA checks (axe-core) on every main screen, by day, by night and on a phone.
 * The app's CSP forbids inline scripts, so only this test browser bypasses it to inject axe.
 */
const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const SCREENS = ['', 'wires', 'news', 'breaking', 'bulletins', 'stories', 'diary', 'programs', 'episodes', 'calendar', 'guests', 'on-air', 'studio-screen', 'media', 'requests', 'tasks', 'bookings', 'roster', 'reports', 'audit', 'users', 'settings', 'help', 'whats-new', 'alerts'];

async function violations(page: Page) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const result = await (window as any).axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] });
    return result.violations.map((v: any) => `${v.id}: ${v.nodes.map((n: any) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  });
}

async function audit(browser: Browser, opts: { colorScheme: 'light' | 'dark'; width: number; height: number }) {
  const context = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, colorScheme: opts.colorScheme, bypassCSP: true });
  const page = await context.newPage();
  const found: string[] = [];
  await page.goto('/');
  found.push(...(await violations(page)).map((v: string) => `login → ${v}`));
  await page.fill('#login-email', 'admin@akhbar.tv');
  await page.fill('#login-password', DEMO_PASSWORD);
  await page.click('button[type=submit]');
  await expect(page.locator('main')).toBeVisible();
  const data = await page.evaluate(async () => (await (await fetch('/api/v1/data', { headers: { 'X-NRCS-Client': 'web' } })).json()));
  const first = (c: string) => data.collections?.[c]?.[0]?.id;
  const deep = [`news/${first('news')}`, `episodes/${first('episodes')}`, `bulletins/${first('bulletins')}`, `programs/${first('programs')}`];
  for (const screen of [...SCREENS, ...deep]) {
    await page.goto(`/${screen}`);
    await expect(page.locator('main')).toBeVisible();
    await page.waitForTimeout(400);
    found.push(...(await violations(page)).map((v: string) => `/${screen} → ${v}`));
    await leaveEditors(page);
  }
  await leaveEditors(page);
  await context.close();
  return found;
}

test.describe.configure({ timeout: 180_000 });

test('no WCAG A/AA violations by day on the desktop', async ({ browser }) => {
  expect(await audit(browser, { colorScheme: 'light', width: 1280, height: 800 })).toEqual([]);
});

test('no WCAG A/AA violations by night', async ({ browser }) => {
  expect(await audit(browser, { colorScheme: 'dark', width: 1280, height: 800 })).toEqual([]);
});

test('no WCAG A/AA violations on a phone', async ({ browser }) => {
  expect(await audit(browser, { colorScheme: 'light', width: 390, height: 844 })).toEqual([]);
});
