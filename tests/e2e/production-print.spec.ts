import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('bulletin preparation and autocue keep draft copy and reserve stories in the correct document', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { viewport: { width: 390, height: 844 } });
  try {
    await page.goto('/bulletins/bul-demo-main');
    await page.getByRole('button', { name: 'تصدير وطباعة', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'تصدير وطباعة' });
    await menu.getByRole('button', { name: 'نص إعداد النشرة — طباعة' }).click();
    const preview = page.getByRole('dialog', { name: 'معاينة الطباعة' });
    const paper = preview.locator('iframe').contentFrame().locator('body');
    await expect(paper).toContainText('انطلقت اليوم أعمال القمة');
    await expect(paper).toContainText('خبر احتياطي: أسعار النفط');
    await preview.getByRole('button', { name: 'إغلاق', exact: true }).click();
    await menu.getByRole('button', { name: 'إغلاق', exact: true }).click();
    await page.getByRole('button', { name: 'الملقن', exact: true }).click();
    const fromPrompter = page.getByRole('button', { name: 'طباعة نص الأوتوكيو' });
    await fromPrompter.click();
    await expect(paper).toContainText('انطلاق أعمال القمة الاقتصادية');
    await expect(paper).toContainText('بانتظار اعتماد محرر النشرة');
    await expect(paper).not.toContainText('انطلقت اليوم أعمال القمة');
    await expect(paper).not.toContainText('أسعار النفط');
    await preview.getByRole('button', { name: 'إغلاق', exact: true }).click();
    await expect(fromPrompter).toBeFocused();
    await page.keyboard.press('Escape');
  } finally {
    await close();
  }
});

test('episode documents open from the workspace and the introduction prints the current draft', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  try {
    await page.goto('/episodes/ep-101');
    await page.getByRole('button', { name: 'تصدير وطباعة', exact: true }).first().click();
    const menu = page.getByRole('dialog', { name: 'تصدير وطباعة' });
    const preview = page.getByRole('dialog', { name: 'معاينة الطباعة' });
    const paper = preview.locator('iframe').contentFrame().locator('body');
    for (const label of ['رانداون الحلقة', 'نص إعداد الحلقة', 'نص الأوتوكيو']) {
      await menu.getByRole('button', { name: `${label} — PDF` }).click();
      await expect(paper).toContainText('قمة الاستثمار');
      if (label === 'نص إعداد الحلقة') await expect(paper).toContainText('أهلاً بكم مشاهدينا');
      await preview.getByRole('button', { name: 'إغلاق', exact: true }).click();
    }
    await menu.getByRole('button', { name: 'إغلاق', exact: true }).click();
    await page.getByRole('button', { name: 'سكريبت المقدمة والأوتوكيو' }).click();
    const draft = 'مسودة المقدمة للمعاينة قبل الحفظ';
    await page.locator('#intro-script-textarea').fill(draft);
    await page.getByRole('button', { name: 'طباعة المقدمة' }).click();
    await page.getByRole('button', { name: 'مقدمة الحلقة — طباعة' }).click();
    await expect(paper).toContainText(draft);
    await expect(paper).toContainText('نسخة العمل الحالية قبل الحفظ');
    await preview.getByRole('button', { name: 'إغلاق', exact: true }).click();
    await page.getByRole('dialog', { name: 'طباعة المقدمة' }).getByRole('button', { name: 'إغلاق', exact: true }).click();
  } finally {
    await close();
  }
});
