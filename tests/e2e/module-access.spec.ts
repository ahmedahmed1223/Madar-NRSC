import { expect, test } from '@playwright/test';
import { openNav, openSettingsSection, signIn } from './helpers';

test('administrator controls module access in settings and connected workspaces update', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const producer = await signIn(browser, 'producer@akhbar.tv');
  const denied = producer.page.getByRole('heading', { name: 'هذه الوحدة غير متاحة لهذا الحساب' });
  try {
    await producer.page.goto('/programs');
    await expect(producer.page.getByRole('button', { name: 'إضافة برنامج جديد', exact: true })).toBeVisible();
    await openNav(admin.page, 'الإعدادات');
    await openSettingsSection(admin.page, 'حالة النظام');
    const controls = admin.page.getByRole('region', { name: 'إتاحة الوحدات' });
    const programmes = controls.getByLabel('البرامج والحلقات', { exact: true });
    const assignments = controls.getByLabel('التكليفات', { exact: true });
    const save = controls.getByRole('button', { name: 'حفظ إتاحة الوحدات' });

    await programmes.selectOption('disabled');
    await assignments.selectOption('disabled');
    await save.click();
    await expect(controls.getByRole('status')).toHaveText('حُفظت إتاحة الوحدات');
    await expect(denied).toBeVisible();
    await producer.page.goto('/cards/card-example');
    await expect(denied).toBeVisible();

    await admin.page.goto('/bulletins');
    await expect(admin.page.getByRole('heading', { name: 'النشرات', exact: true }).first()).toBeVisible();
    await openNav(admin.page, 'الإعدادات');
    await openSettingsSection(admin.page, 'حالة النظام');
    await programmes.selectOption('everyone');
    await assignments.selectOption('everyone');
    await save.click();
    await expect(controls.getByRole('status')).toHaveText('حُفظت إتاحة الوحدات');
    await expect(denied).not.toBeVisible();
    expect(admin.errors).toEqual([]);
    expect(producer.errors).toEqual([]);
  } finally {
    await Promise.all([admin.close(), producer.close()]);
  }
});
