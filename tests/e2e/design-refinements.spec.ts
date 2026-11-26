import { expect, test, type Page } from '@playwright/test';
import { openNav, openSettingsSection, signIn } from './helpers';

const mobile = { width: 375, height: 812 };

async function mockNews(page: Page, stories: Array<{ id: string; title: string; summary: string; content: string }>) {
  await page.route('**/api/v1/data', async route => {
    const response = await route.fetch();
    const data = await response.json();
    const sample = data.collections.news[0];
    data.collections.news = stories.map(story => ({
      ...sample, id: story.id, d: { ...sample.d, ...story, status: 'DRAFT', isBreaking: false },
    }));
    await route.fulfill({ response, json: data });
  });
  await page.reload();
  await expect(page.locator('main')).toBeVisible();
}

test('module settings keep save and discard in view beside a mid-list change on mobile', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { viewport: mobile });
  try {
    await openNav(page, 'الإعدادات');
    await openSettingsSection(page, 'وحدات النظام');
    const region = page.getByRole('region', { name: 'إتاحة الوحدات' });
    const module = region.getByLabel('المراسلات', { exact: true });
    await module.scrollIntoViewIfNeeded();
    await module.selectOption('disabled');
    const save = region.getByRole('button', { name: 'حفظ إتاحة الوحدات' });
    const discard = region.getByRole('button', { name: 'إلغاء المسودة' });
    await expect(save).toBeInViewport({ ratio: 1 });
    await expect(discard).toBeInViewport({ ratio: 1 });
    await discard.click();
    await expect(module).toHaveValue('everyone');
    await expect(discard).toHaveCount(0);
  } finally {
    await close();
  }
});

test('module settings can show only the modules changed by a preset', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  try {
    await openNav(page, 'الإعدادات');
    await openSettingsSection(page, 'وحدات النظام');
    const region = page.getByRole('region', { name: 'إتاحة الوحدات' });
    await region.getByLabel('قالب تشغيل').selectOption('work');
    await region.getByRole('button', { name: 'معاينة القالب ضمن النطاق' }).click();
    await region.getByRole('checkbox', { name: 'عرض الوحدات المعدلة فقط' }).check();
    await expect(region.getByLabel('البرامج والحلقات', { exact: true })).toHaveValue('disabled');
    await expect(region.getByLabel('التكليفات', { exact: true })).toHaveCount(0);
    await region.getByRole('button', { name: 'إلغاء المسودة' }).click();
    await expect(region.getByLabel('التكليفات', { exact: true })).toHaveValue('everyone');
  } finally {
    await close();
  }
});

test('mobile news gives the title, state and primary action the row while preserving desktop metadata', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { viewport: mobile });
  const title = 'تقرير طويل عن متابعة أخبار المدينة وتوضيح نتائج الاجتماع للفريق الميداني';
  const summary = 'ملخص التقرير الصحفي';
  try {
    await mockNews(page, [{ id: 'mobile-news', title, summary, content: '' }]);
    await openNav(page, 'الأخبار');
    const row = page.locator('[data-news-id="mobile-news"]');
    await row.scrollIntoViewIfNeeded();
    await expect(row.getByRole('button', { name: title })).toBeInViewport();
    await expect(row.getByText('مسودة', { exact: true }).filter({ visible: true })).toBeInViewport();
    await expect(row.getByRole('button', { name: 'تحرير الخبر' })).toBeInViewport();
    await expect(row.getByText(summary, { exact: true })).toBeHidden();
    expect(await row.evaluate(element => {
      const scroller = element.closest('.overflow-x-auto')!;
      return scroller.scrollWidth <= scroller.clientWidth;
    })).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(row.getByText(summary, { exact: true })).toBeVisible();
  } finally {
    await close();
  }
});

test('unified search explains when the story body is needed for a match', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  try {
    await mockNews(page, [
      { id: 'body-match', title: 'متابعة الاجتماع', summary: 'ملاحظات من غرفة الأخبار', content: '<p>بالتَّلسكوبات الجديدة</p>' },
      { id: 'title-match', title: 'التلسكوبات في المدينة', summary: 'مراجعة المعدات', content: '<p>بالتَّلسكوبات الجديدة</p>' },
    ]);
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'البحث الموحد' });
    await dialog.getByRole('combobox', { name: /بحث في الأخبار/ }).fill('تلسكوبات');
    const list = dialog.getByRole('listbox');
    await expect(list.getByRole('option', { name: /متابعة الاجتماع/ })).toContainText('مطابقة في نص الخبر');
    await expect(list.getByRole('option', { name: /التلسكوبات في المدينة/ })).toContainText('مراجعة المعدات');
    await expect(list.getByRole('option', { name: /التلسكوبات في المدينة/ })).not.toContainText('مطابقة في نص الخبر');
    await page.keyboard.press('Escape');
  } finally {
    await close();
  }
});
