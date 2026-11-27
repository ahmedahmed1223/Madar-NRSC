import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('system navigation, contextual trash, role-aware tours and private pinned notes', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const reporter = await signIn(browser, 'reporter@akhbar.tv');
  try {
    const { page } = admin;
    await page.goto('/help');
    const nav = page.getByRole('navigation', { name: 'التنقل' });
    await expect(nav.getByRole('group', { name: 'المساعدة', exact: true })).toBeVisible();
    const groups = await nav.getByRole('group').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')));
    expect(groups.slice(-3)).toEqual(['الاستعادة', 'إدارة النظام', 'المساعدة']);
    await nav.getByRole('button', { name: 'إدارة النظام', exact: true }).click();
    await expect(nav.getByRole('group', { name: 'إدارة النظام' }).getByRole('button', { name: 'المستخدمون والصلاحيات' })).toBeVisible();
    await page.getByRole('button', { name: /إعداد حلقة من الفكرة إلى البث/ }).click();
    await expect(page).toHaveURL(/\/episodes$/);
    await page.keyboard.press('Escape');

    await page.goto('/media');
    await page.getByRole('link', { name: 'محذوفات ملفات الوسائط' }).click();
    await expect(page).toHaveURL(/\/trash\/media$/);
    await expect(page.getByLabel('القسم', { exact: true })).toHaveValue('media');
    await page.reload();
    await expect(page.getByLabel('القسم', { exact: true })).toHaveValue('media');

    await page.goto('/personal-notes');
    await page.getByRole('button', { name: 'ملاحظة جديدة' }).click();
    await page.getByLabel('العنوان', { exact: true }).fill('متابعة مراجعة المساء');
    await page.getByLabel('نص الملاحظة').fill('راجِع تسجيل الحلقة قبل التسليم.');
    await page.getByLabel('تثبيت في القائمة وإظهارها في الملصقات').check();
    await page.getByRole('button', { name: 'حفظ الملاحظة', exact: true }).click();
    await expect(page.getByText('متابعة مراجعة المساء', { exact: true })).toBeVisible();
    await page.goto('/news');
    const dock = page.getByRole('complementary', { name: 'ملصقاتي' });
    await dock.getByRole('button', { name: /الملصقات/ }).click();
    await expect(dock.getByText('راجِع تسجيل الحلقة قبل التسليم.')).toBeVisible();
    await reporter.page.goto('/news');
    await expect(reporter.page.getByRole('complementary', { name: 'ملصقاتي' })).toHaveCount(0);
    await dock.getByRole('button', { name: 'إلغاء تثبيت متابعة مراجعة المساء' }).click();
    await expect(dock).toHaveCount(0);
    expect([...admin.errors, ...reporter.errors]).toEqual([]);
  } finally {
    await Promise.all([reporter.close(), admin.close()]);
  }
});
