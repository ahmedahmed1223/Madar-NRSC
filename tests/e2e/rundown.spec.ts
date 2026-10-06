import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('story status can be changed straight from the bulletin rundown', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'producer@akhbar.tv');
  await openNav(page, 'النشرات');
  const data = await (await page.request.get('/api/v1/data')).json();
  const bulletin = data.collections.bulletins.find((row: any) => row.d.title.startsWith('نشرة الثامنة'));
  expect(bulletin).toBeTruthy();
  await page.getByLabel('التاريخ', { exact: true }).fill(bulletin.d.date);
  await page.locator('button[aria-label^="فتح نشرة الثامنة"]').first().click();
  const status = page.locator('select[aria-label^="حالة «"]').first();
  await expect(status).toBeVisible();
  const before = await status.inputValue();
  const options = await status.locator('option').evaluateAll((els) => els.map((o) => (o as HTMLOptionElement).value));
  const target = options.find((v) => v !== before)!;
  expect(target).toBeTruthy();
  await status.selectOption(target);
  await expect(page.getByRole('status').filter({ hasText: /اعتُمدت|اعتمادك|جاهزة للاعتماد|أُعيدت .* مسودة/ }).first()).toBeVisible();
  expect(errors).toEqual([]);
  await close();
});
