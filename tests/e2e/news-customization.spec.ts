import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('list customization persists and stays isolated between colleagues', async ({ browser }) => {
  const editor = await signIn(browser, 'editor@akhbar.tv');
  await openNav(editor.page, 'الأخبار');
  await editor.page.getByText('تخصيص قائمة الأخبار', { exact: true }).click();
  await editor.page.getByLabel('نتائج الصفحة', { exact: true }).selectOption('10');
  await editor.page.getByRole('group', { name: 'أعمدة الأخبار الاختيارية' }).getByLabel('المصدر والمحرر').uncheck();
  await expect(editor.page.getByRole('columnheader', { name: /المصدر \/ المحرر/ })).toHaveCount(0);
  await editor.page.reload();
  await editor.page.getByText('تخصيص قائمة الأخبار', { exact: true }).click();
  await expect(editor.page.getByLabel('نتائج الصفحة', { exact: true })).toHaveValue('10');
  await expect(editor.page.getByRole('group', { name: 'أعمدة الأخبار الاختيارية' }).getByLabel('المصدر والمحرر')).not.toBeChecked();
  const reporter = await signIn(browser, 'reporter@akhbar.tv');
  await openNav(reporter.page, 'الأخبار');
  await reporter.page.getByText('تخصيص قائمة الأخبار', { exact: true }).click();
  await expect(reporter.page.getByLabel('نتائج الصفحة', { exact: true })).toHaveValue('50');
  await editor.page.setViewportSize({ width: 390, height: 844 });
  expect(await editor.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await editor.close(); await reporter.close();
});

test('news templates save, escape markup, confirm replacement and undo', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  await openNav(page, 'الإعدادات');
  await page.getByRole('navigation', { name: 'أقسام الإعدادات' }).getByRole('button', { name: /الأخبار والتحرير/ }).click();
  await page.getByRole('button', { name: 'إضافة قالب أخبار', exact: true }).click();
  await page.getByLabel('اسم القالب 1', { exact: true }).fill('قالب خبر اختباري');
  await page.getByLabel('نص القالب 1', { exact: true }).fill('مقدمة الخبر\n<img src=x onerror=alert(1)>\nالتفاصيل والمصدر');
  await page.getByRole('button', { name: 'حفظ قوالب الأخبار', exact: true }).click();
  await expect(page.getByText('تم حفظ قوالب الأخبار', { exact: true })).toBeVisible();
  await page.goto('/news/new');
  await page.locator('#news-headline-input').fill('عنوان يبقى دون تغيير');
  const body = page.getByRole('textbox', { name: 'محتوى الخبر', exact: true });
  await body.fill('نص أصلي قبل القالب');
  await page.getByText('أدوات الخبر', { exact: true }).click();
  await page.getByLabel('قالب الخبر', { exact: true }).selectOption({ label: 'قالب خبر اختباري' });
  await page.getByRole('button', { name: 'تطبيق القالب', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'تطبيق القالب', exact: true }).click();
  await expect(body).toContainText('مقدمة الخبر');
  await expect(body.locator('img')).toHaveCount(0);
  await expect(page.locator('#news-headline-input')).toHaveValue('عنوان يبقى دون تغيير');
  await page.getByRole('button', { name: 'تراجع عن تطبيق القالب', exact: true }).click();
  await expect(body).toHaveText('نص أصلي قبل القالب');
  await page.getByRole('button', { name: 'تطبيق القالب', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'تطبيق القالب', exact: true }).click();
  await body.fill('تعديلات بعد تطبيق القالب');
  await page.getByRole('button', { name: 'تراجع عن تطبيق القالب', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'إلغاء', exact: true }).click();
  await expect(body).toHaveText('تعديلات بعد تطبيق القالب');
  await page.getByRole('button', { name: 'تراجع عن تطبيق القالب', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'استعادة النص السابق', exact: true }).click();
  await expect(body).toHaveText('نص أصلي قبل القالب');
  await close();
});

test('a rejected programme template save cannot announce success', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  const data = await (await page.request.get('/api/v1/data')).json();
  const episode = data.collections.episodes.find((row: any) => row.d.rundown?.length && row.d.programId);
  const program = data.collections.programs.find((row: any) => row.id === episode.d.programId);
  await page.goto(`/episodes/${episode.id}`);
  await page.route('**/api/v1/data/sync', async route => {
    const ops = route.request().postDataJSON().ops;
    if (!ops.some((op: any) => op.c === 'programs')) return route.continue();
    await route.fulfill({ json: { results: ops.map((op: any) => ({ c: op.c, id: op.id, ok: false, code: 'CONFLICT', message: 'اختبار رفض القالب', current: program })), rev: data.rev } });
  });
  await page.getByRole('button', { name: 'حفظ البنية كقالب للبرنامج', exact: true }).click();
  if (program.d.template) await page.getByRole('alertdialog').getByRole('button', { name: /تأكيد|نعم|متابعة/ }).click();
  await expect(page.getByTestId('episode-planner')).toContainText('لم يؤكد الخادم');
  await expect(page.getByTestId('episode-planner')).not.toContainText('حُفظت البنية');
  await page.unroute('**/api/v1/data/sync');
  await close();
});
