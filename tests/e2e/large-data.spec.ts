import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

/** Years of work leave thousands of guests, tasks and episodes; screens draw them a page at a time. */
test('long lists draw a page at a time and still search the whole archive', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'editor@akhbar.tv');
  await page.route('**/api/v1/data', async route => {
    const response = await route.fetch();
    const data = await response.json();
    const grow = (name: string, count: number, make: (sample: any, i: number) => any) => {
      const sample = data.collections[name][0];
      data.collections[name] = Array.from({ length: count }, (_, i) => ({ ...sample, id: `big-${name}-${i}`, d: { ...sample.d, id: `big-${name}-${i}`, ...make(sample.d, i) } }));
    };
    grow('guests', 300, (_, i) => ({ fullName: `ضيف أرشيفي ${i}` }));
    grow('tasks', 200, (_, i) => ({ title: `مهمة أرشيفية ${i}`, status: 'TODO', priority: 'NORMAL' }));
    grow('episodes', 160, (s, i) => ({ title: `حلقة أرشيفية ${i}`, episodeNumber: 500 + i }));
    await route.fulfill({ response, json: data });
  });
  await page.reload();
  await expect(page.locator('main')).toBeVisible();

  await openNav(page, 'الضيوف');
  await expect(page.getByRole('button', { name: /عرض المزيد/ })).toContainText('252');
  await expect(page.locator('main h3, main h2').filter({ hasText: 'ضيف أرشيفي' })).toHaveCount(48);
  await page.getByRole('button', { name: /عرض المزيد/ }).click();
  await expect(page.locator('main h3, main h2').filter({ hasText: 'ضيف أرشيفي' })).toHaveCount(96);
  // Search reaches guests that are not drawn yet.
  await page.getByRole('searchbox').or(page.getByPlaceholder(/بحث/)).first().fill('ضيف أرشيفي 299');
  await expect(page.locator('main h3, main h2').filter({ hasText: 'ضيف أرشيفي 299' })).toHaveCount(1);

  await openNav(page, 'المهام');
  const column = page.locator('[aria-label="المهام المطلوبة"]').first();
  await expect(column.getByRole('button', { name: /عرض المزيد/ })).toContainText('170');

  await openNav(page, 'الحلقات');
  await expect(page.getByRole('button', { name: /عرض المزيد/ })).toContainText('120');
  expect(errors).toEqual([]);
  await close();
});
