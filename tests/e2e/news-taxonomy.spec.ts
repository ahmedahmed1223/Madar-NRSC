import { expect, test, type Page } from '@playwright/test';
import { openNav, openSettingsSection, signIn } from './helpers';
import { DEFAULT_NEWS_FILTER } from '../../src/shared/savedNewsFilters';

async function sync(page: Page, ops: unknown[]) {
  const response = await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops } });
  expect(response.ok()).toBe(true);
  const { results } = await response.json();
  expect(results.every((row: any) => row.ok)).toBe(true);
  return results;
}

function draft(id: string, title: string, categoryId?: string) {
  return { c: 'news', op: 'upsert', id, d: {
    id, title, shortTitle: title, status: 'DRAFT', categoryId, keywords: [], isBreaking: false,
    content: '<p>أضيف هذا الخبر إلى غرفة الأخبار للتحقق من نتيجة التصنيف والبحث والمتابعة الشخصية.</p>',
  } };
}

test('a saved parent category includes its descendant stories after reload', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  try {
    await openNav(page, 'الإعدادات');
    await openSettingsSection(page, 'تصنيفات الأخبار');
    const name = page.getByLabel('اسم التصنيف بالعربية');
    const parent = page.getByLabel('التصنيف الرئيسي', { exact: true });
    const add = async (title: string, parentPath?: string) => {
      await name.fill(title);
      if (parentPath) await parent.selectOption({ label: parentPath });
      await page.getByRole('button', { name: 'إضافة التصنيف', exact: true }).click();
      await expect(name).toHaveValue('');
    };
    await add('متابعة الاقتصاد');
    await add('أسواق الطاقة', 'متابعة الاقتصاد');
    await add('أسعار النفط', 'متابعة الاقتصاد / أسواق الطاقة');
    const parentId = await parent.getByRole('option', { name: 'متابعة الاقتصاد', exact: true }).getAttribute('value');
    const childId = await parent.getByRole('option', { name: 'متابعة الاقتصاد / أسواق الطاقة', exact: true }).getAttribute('value');
    const leafId = await parent.getByRole('option', { name: 'متابعة الاقتصاد / أسواق الطاقة / أسعار النفط', exact: true }).getAttribute('value');
    await sync(page, [
      draft('story-parent-category', 'خبر الاقتصاد الرئيسي', parentId!),
      draft('story-child-category', 'خبر الطاقة الفرعي', childId!),
      draft('story-leaf-category', 'خبر أسعار النفط', leafId!),
      draft('story-outside-category', 'خبر خارج تصنيف الاقتصاد'),
      { c: 'savedNewsFilters', op: 'upsert', id: 'legacy-category-name', d: {
        schemaVersion: 1, name: 'فلتر قديم باسم التصنيف', pinned: false,
        definition: { ...DEFAULT_NEWS_FILTER, selectedCategory: 'متابعة الاقتصاد' },
      } },
    ]);

    await page.goto('/news');
    const saved = page.getByLabel('الفلاتر المحفوظة', { exact: true });
    await saved.selectOption({ label: 'فلتر قديم باسم التصنيف' });
    await expect(page.getByRole('row').filter({ hasText: 'خبر الاقتصاد الرئيسي' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'خبر أسعار النفط' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'خبر خارج تصنيف الاقتصاد' })).toHaveCount(0);
    await page.locator('button[aria-controls="news-advanced-filters"]').click();
    const categoryFilter = page.locator('#news-list-category-select');
    await categoryFilter.selectOption(childId!);
    await expect(page.getByRole('row').filter({ hasText: 'خبر الطاقة الفرعي' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'خبر أسعار النفط' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'خبر الاقتصاد الرئيسي' })).toHaveCount(0);

    await page.getByRole('button', { name: 'حفظ الفلتر الحالي', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('اسم الفلتر', { exact: true }).fill('أسواق الطاقة بفروعها');
    await dialog.getByRole('button', { name: 'حفظ', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await saved.selectOption({ label: 'أسواق الطاقة بفروعها' });
    await expect(page.getByRole('row').filter({ hasText: 'خبر أسعار النفط' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'خبر الاقتصاد الرئيسي' })).toHaveCount(0);
  } finally {
    await close();
  }
});

test('a saved news keyword opens the incoming story from the bell', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'journalist@akhbar.tv');
  try {
    await page.goto('/alerts');
    const keyword = page.getByRole('textbox', { name: 'كلمة لمتابعة الأخبار', exact: true });
    await keyword.fill('أُوبك');
    await keyword.press('Enter');
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByRole('button', { name: 'حفظ الإعدادات', exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.getByRole('button', { name: 'حذف أُوبك', exact: true })).toBeVisible();

    await sync(page, [draft('story-personal-keyword', 'اتفقت أوبك على موعد الاجتماع')]);
    const bell = page.getByRole('button', { name: /^الإشعارات/ });
    await expect(bell).toHaveAccessibleName(/غير مقروء/);
    await bell.click();
    await page.getByRole('region', { name: 'مركز الإشعارات التحريرية', exact: true })
      .getByRole('button', { name: /خبر يطابق.*أُوبك/ }).click();
    await expect(page).toHaveURL(/\/news\/story-personal-keyword$/);
    await expect(page.getByRole('textbox', { name: /العنوان الرئيسي للمادة الصحفية/ })).toHaveValue('اتفقت أوبك على موعد الاجتماع');
  } finally {
    await close();
  }
});

test('an editor can apply the stylebook and approve the saved digital package', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  try {
    await openNav(page, 'الإعدادات');
    await openSettingsSection(page, 'الأخبار والتحرير');
    await page.getByLabel('الوسوم المفضلة لـ X وTelegram').fill('#غرفة_الأخبار');
    await page.getByRole('button', { name: 'إضافة قاعدة عبارة', exact: true }).click();
    await page.getByLabel('العبارة 1', { exact: true }).fill('إثر');
    await page.getByLabel('البديل 1', { exact: true }).fill('بعد');
    const saveSettings = page.getByRole('button', { name: 'حفظ دليل الأسلوب والوسوم', exact: true });
    await saveSettings.click();
    await expect(saveSettings).toBeDisabled();

    const item = draft('story-digital-package', 'استجابة إثر عاصفة');
    const [created] = await sync(page, [{ ...item, d: { ...item.d, authorId: 'usr-1' } }]);
    const [review] = await sync(page, [{ ...item, d: { ...created.row.d, status: 'UNDER_REVIEW' }, baseV: created.row.v }]);
    await sync(page, [{ ...item, d: { ...review.row.d, status: 'APPROVED' }, baseV: review.row.v }]);
    await page.goto('/news/story-digital-package');
    await page.getByText('النشر الرقمي ودليل الأسلوب', { exact: true }).click();
    await page.getByRole('tab', { name: 'دليل الأسلوب', exact: true }).click();
    await expect(page.locator('u').getByText('إثر', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: /استبدال.*إثر/ }).first().click();
    await expect(page.getByRole('textbox', { name: /العنوان الرئيسي للمادة الصحفية/ })).toHaveValue('استجابة بعد عاصفة');

    await page.getByRole('tab', { name: 'حزمة النشر', exact: true }).click();
    await page.getByRole('textbox', { name: 'نص X', exact: true }).fill('تحديث موجز عن العاصفة');
    await page.getByRole('button', { name: '#غرفة_الأخبار', exact: true }).first().click();
    await expect(page.getByRole('textbox', { name: 'نص X', exact: true })).toHaveValue('تحديث موجز عن العاصفة #غرفة_الأخبار');
    const approve = page.getByRole('button', { name: 'اعتماد الحزمة', exact: true });
    const download = page.getByRole('button', { name: 'تنزيل حزمة النشر', exact: true });
    await expect(download).toHaveCount(0);
    await expect(approve).toBeDisabled();
    await page.getByRole('button', { name: 'حفظ الحزمة', exact: true }).click();
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect(page.getByRole('button', { name: 'نسخ نص X', exact: true })).toBeVisible();
    const savedFile = page.waitForEvent('download');
    await download.click();
    expect((await savedFile).suggestedFilename()).toBe('حزمة-النشر.txt');
  } finally {
    await close();
  }
});
