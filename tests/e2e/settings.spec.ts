import { expect, test } from '@playwright/test';
import { openNav, openSettingsSection, signIn } from './helpers';

test('administrators see what demo data is left and must confirm before removing it', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'admin@akhbar.tv');
  await openNav(page, 'الإعدادات');
  // Settings are grouped in sections; the choice is remembered.
  const sections = page.getByRole('navigation', { name: 'أقسام الإعدادات' });
  await sections.getByRole('button', { name: /تصنيفات الأخبار/ }).click();
  await expect(page.getByText('تصنيفات الأخبار وألوانها')).toBeVisible();
  await sections.getByRole('button', { name: /البيانات/ }).click();
  const card = page.getByTestId('demo-data-card');
  await expect(card).toContainText('أخبار');
  const remove = card.getByRole('button', { name: /حذف البيانات التجريبية/ });
  await expect(remove).toBeDisabled();
  await card.getByLabel('تأكيد الحذف').fill('حذف');
  await expect(remove).toBeEnabled();
  // Coming back to Settings opens the last section used.
  await openNav(page, 'الرئيسية');
  await openNav(page, 'الإعدادات');
  await expect(page.getByTestId('demo-data-card')).toBeVisible();
  expect(errors).toEqual([]);
  await close();
});

test('the setup wizard stays open and Back returns to its launching screen', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'admin@akhbar.tv');
  try {
    const wizard = page.getByRole('region', { name: 'الإعداد السريع للنظام' });
    await openNav(page, 'المساعدة');
    await page.getByRole('button', { name: /الإعداد السريع للنظام/ }).click();
    await expect(wizard.getByRole('navigation', { name: 'خطوات الإعداد' })).toBeInViewport();
    await wizard.getByRole('button', { name: /المؤسسة/ }).click();
    await expect(wizard.getByLabel('اسم المؤسسة *')).not.toHaveValue('');
    await page.goBack();
    await expect(wizard).toHaveCount(0);
    await expect(page).toHaveURL(/\/help$/);

    await openNav(page, 'الإعدادات');
    await openSettingsSection(page, 'البيانات');
    const openSetup = page.getByRole('button', { name: 'فتح معالج الإعداد', exact: true });
    await openSetup.click();
    await expect(wizard.getByRole('heading', { name: 'الإعداد السريع للنظام' })).toBeInViewport();
    await expect(wizard.getByLabel('اسم المؤسسة *')).not.toHaveValue('');
    await wizard.getByRole('button', { name: 'رجوع', exact: true }).click();
    await expect(openSetup).toBeVisible();
    await expect(page).toHaveURL(/\/settings$/);

    await page.evaluate(() => {
      Object.defineProperty(window.history, 'pushState', {
        configurable: true,
        value() { throw new DOMException('History writes blocked by the preview', 'SecurityError'); },
      });
    });
    try {
      await openSetup.click();
      await expect(wizard.getByLabel('اسم المؤسسة *')).not.toHaveValue('');
      await wizard.getByRole('button', { name: 'رجوع', exact: true }).click();
      await expect(openSetup).toBeVisible();
      await expect(page).toHaveURL(/\/settings$/);
    } finally {
      await page.evaluate(() => Reflect.deleteProperty(window.history, 'pushState'));
    }
    expect(errors).toEqual([]);
  } finally {
    await close();
  }
});
