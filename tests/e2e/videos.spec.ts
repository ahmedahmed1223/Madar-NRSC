import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('a story carries several ordered clips, including where to find a clip that is not attached', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'الأخبار');
  await page.locator('button[title="تحرير الخبر"]').first().click();
  const clips = page.getByTestId('news-videos');
  const title = await page.locator('input').first().inputValue();

  // Remove whatever the story had, then add a link and a written location.
  while (await clips.getByRole('button', { name: /^حذف المقطع/ }).count()) await clips.getByRole('button', { name: /^حذف المقطع/ }).first().click();
  await clips.getByRole('button', { name: /رابط مقطع/ }).click();
  await clips.getByLabel('اسم المقطع 1').fill('تصريح الوزير');
  await clips.getByLabel('رابط المقطع 1').fill('https://cdn.example/minister.mp4');
  await clips.getByRole('button', { name: /مكان مقطع/ }).click();
  await clips.getByLabel('اسم المقطع 2').fill('لقطات الافتتاح');
  await clips.getByLabel('مكان المقطع 2').fill('خادم المونتاج \\\\NAS01\\القمة\\01');

  // The opening shots go first.
  await clips.getByRole('button', { name: 'تقديم المقطع 2' }).click();
  await expect(clips.getByLabel('اسم المقطع 1')).toHaveValue('لقطات الافتتاح');

  await page.getByRole('button', { name: 'حفظ التغييرات' }).click();
  await expect(page).toHaveURL(/\/news$/);

  // Reopen: order and texts are kept; the preview tells production where each clip is.
  const row = page.locator('tr', { hasText: title.slice(0, 20) });
  await row.locator('button[title="تحرير الخبر"]').click();
  await expect(page.getByTestId('news-videos').getByLabel('اسم المقطع 1')).toHaveValue('لقطات الافتتاح');
  await expect(page.getByTestId('news-videos').getByLabel('رابط المقطع 2')).toHaveValue('https://cdn.example/minister.mp4');
  await page.goBack();
  await page.locator('tr', { hasText: title.slice(0, 20) }).locator('button[title="معاينة وسجل التدقيق"]').click();
  const list = page.getByRole('region', { name: 'مقاطع الفيديو' });
  await expect(list).toContainText('1');
  await expect(list).toContainText('لقطات الافتتاح');
  await expect(list).toContainText('NAS01');
  await expect(list).toContainText('تصريح الوزير');
  expect(errors).toEqual([]);
  await close();
});
