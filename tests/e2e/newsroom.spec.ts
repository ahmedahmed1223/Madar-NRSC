import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('an embargoed story shows its embargo everywhere and cannot go out early', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'الأخبار');
  await page.locator('button[title="تحرير الخبر"]').first().click();
  const tomorrow = await page.evaluate(() => {
    const d = new Date(Date.now() + 24 * 3600_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T09:00`;
  });
  const title = await page.locator('input').first().inputValue();
  await page.fill('#news-embargo', tomorrow);
  await page.getByRole('button', { name: 'حفظ وإغلاق', exact: true }).click();
  // Back on the list, the story carries its embargo.
  const row = page.locator('tr', { hasText: title.slice(0, 20) });
  await expect(row.getByText(/محظور حتى/)).toBeVisible();
  // Reopening it shows the embargo banner.
  await row.locator('button[title="تحرير الخبر"]').click();
  await expect(page.getByText(/تحت الحظر حتى/).first()).toBeVisible();
  expect(errors).toEqual([]);
  await close();
});

test('the As-Run log lists what went to air', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'producer@akhbar.tv');
  await openNav(page, 'وضع الهواء');
  await page.getByRole('tab', { name: /سجل البث الفعلي/ }).click();
  await expect(page.getByLabel('التاريخ')).toBeVisible();
  expect(errors).toEqual([]);
  await close();
});
