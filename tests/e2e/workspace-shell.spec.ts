import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('quick create opens the target form once per action', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'admin@akhbar.tv');
  try {
    const create = page.getByRole('button', { name: 'إنشاء جديد', exact: true });
    for (const [action, title, path] of [
      ['برنامج تلفزيوني جديد', 'إضافة برنامج تلفزيوني جديد', '/programs'],
      ['حلقة برنامج جديدة', /حلقة جديدة|إضافة حلقة/, '/episodes'],
      ['مهمة تحريرية جديدة', 'إسناد وتكليف بمهمة صحفية', '/tasks'],
      ['تكليف', 'تكليف من قالب', '/cards'],
    ] as const) {
      await create.click();
      const options = page.getByRole('group', { name: 'خيارات الإنشاء' });
      await options.getByRole('button', { name: action, exact: true }).click();
      const form = page.getByRole('region', { name: title });
      await expect(form).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await form.getByRole('button', { name: 'رجوع', exact: true }).click();
      await expect(form).toHaveCount(0);
      await page.goto(path);
      await expect(page.locator('#app-main')).toBeVisible();
      await expect(form).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  } finally {
    await close();
  }
});

test('mobile navigation keeps keyboard focus in the drawer and restores its trigger', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv', { viewport: { width: 320, height: 720 } });
  try {
    const trigger = page.getByRole('button', { name: 'فتح القائمة الرئيسية', exact: true });
    await trigger.focus();
    await trigger.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'القائمة الرئيسية' });
    const closeDrawer = drawer.getByRole('button', { name: 'إغلاق القائمة', exact: true });
    await expect(closeDrawer).toBeFocused();
    await expect(page.locator('.app-scroll')).toHaveAttribute('inert', '');
    await page.keyboard.press('Shift+Tab');
    await expect(drawer.locator(':focus')).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(closeDrawer).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toBeFocused();

    const create = page.getByRole('button', { name: 'إنشاء جديد', exact: true });
    await create.click();
    const menu = page.getByRole('group', { name: 'خيارات الإنشاء' });
    await expect(menu).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 320).toBe(true);
    await page.keyboard.press('Escape');
    await expect(create).toBeFocused();

    const appearance = page.getByRole('button', { name: /^المظهر/ });
    await appearance.focus();
    await appearance.press('Enter');
    const theme = page.getByRole('menu', { name: 'المظهر' });
    const themeBounds = await theme.boundingBox();
    expect(themeBounds && themeBounds.x >= 0 && themeBounds.x + themeBounds.width <= 320).toBe(true);
    await expect(theme.getByRole('menuitemradio', { name: /نهاري/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(theme.getByRole('menuitemradio', { name: /ليلي/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(appearance).toBeFocused();
  } finally {
    await close();
  }
});
