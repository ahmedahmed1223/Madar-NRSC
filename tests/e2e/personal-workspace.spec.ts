import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('a private note follows its employee across browsers and is absent for another account', async ({ browser }) => {
  const author = await signIn(browser, 'reporter@akhbar.tv', { viewport: { width: 375, height: 812 } });
  const title = `ملاحظة خاصة ${Date.now()}`;
  try {
    await openNav(author.page, 'ملاحظاتي');
    await author.page.getByRole('button', { name: 'ملاحظة جديدة' }).click();
    await author.page.getByLabel('العنوان', { exact: true }).fill(title);
    await author.page.getByLabel('نص الملاحظة').fill('ملخصي الخاص للمناوبة');
    await author.page.getByRole('checkbox', { name: 'تثبيت في القائمة وإظهارها في الملصقات' }).check();
    await author.page.getByRole('button', { name: 'حفظ الملاحظة' }).click();
    await expect(author.page.getByText(title, { exact: true })).toBeVisible();

    const second = await signIn(browser, 'reporter@akhbar.tv');
    try {
      await openNav(second.page, 'ملاحظاتي');
      await expect(second.page.getByText(title, { exact: true })).toBeVisible();
      await expect(second.page.getByRole('button', { name: 'إلغاء التثبيت' }).first()).toBeVisible();
    } finally { await second.close(); }

    const colleague = await signIn(browser, 'editor@akhbar.tv');
    try {
      await openNav(colleague.page, 'ملاحظاتي');
      await expect(colleague.page.getByRole('heading', { name: 'ملاحظاتي' })).toBeVisible();
      await expect(colleague.page.getByText(title, { exact: true })).toHaveCount(0);
    } finally { await colleague.close(); }
    expect(author.errors).toEqual([]);
  } finally { await author.close(); }
});

test('tablet navigation opens on demand and closes with Escape', async ({ browser }) => {
  const user = await signIn(browser, 'reporter@akhbar.tv', { viewport: { width: 768, height: 1024 } });
  try {
    const { page } = user;
    const opener = page.getByRole('button', { name: 'فتح القائمة الرئيسية' });
    await expect(opener).toBeVisible();
    await expect(page.locator('#workspace-navigation')).toHaveAttribute('aria-hidden', 'true');
    await opener.click();
    await expect(page.getByRole('dialog', { name: 'القائمة الرئيسية' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole('navigation', { name: 'التنقل' })).toBeVisible();
  } finally { await user.close(); }
});
