import { expect, test } from '@playwright/test';
import { openNav, openSettingsSection, signIn } from './helpers';

test('administrator builds a hierarchy, distinguishes local desks and moves a branch', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const { page } = admin;
  const added = new Set<string>();
  try {
    await openNav(page, 'الإعدادات');
    await openSettingsSection(page, 'الهيكل التنظيمي');
    await page.getByRole('button', { name: 'تحرير مخطط الأقسام' }).click();
    const form = page.getByRole('form', { name: 'الأقسام الإدارية' });
    const chart = form.getByRole('region', { name: 'مخطط الأقسام' });
    const name = form.getByLabel('اسم القسم', { exact: true });
    const root = 'شبكة التنسيق';
    const desk = 'مكتب التغطية المحلية';
    await chart.getByRole('button', { name: 'إضافة قسم رئيسي' }).click();
    await name.fill(root);
    const rootId = (await name.getAttribute('id'))!.replace('dept-name-', '');
    added.add(rootId);
    for (const [station, head] of [['غزة', 'usr-2'], ['بيروت', 'usr-3']]) {
      await chart.getByRole('button', { name: new RegExp(root) }).click();
      await form.getByRole('button', { name: 'إضافة قسم تابع' }).click();
      await name.fill(desk);
      added.add((await name.getAttribute('id'))!.replace('dept-name-', ''));
      await expect(form.getByLabel('تابع لقسم')).toHaveValue(rootId);
      await form.getByLabel('رئيس القسم').selectOption(head);
      const scope = form.getByRole('group', { name: 'محطات قسم ' + desk });
      for (const other of ['غزة', 'بيروت', 'إسطنبول'].filter(value => value !== station)) {
        await scope.getByRole('checkbox', { name: other, exact: true }).uncheck();
      }
    }
    await form.getByRole('button', { name: 'حفظ الأقسام' }).click();
    await expect(form.getByText('حُفظت الأقسام الإدارية')).toBeVisible();
    await page.reload();
    const branches = chart.getByRole('list', { name: 'فروع ' + root });
    await expect(branches.getByRole('button', { name: new RegExp(desk) })).toHaveCount(2);
    const gaza = new RegExp(desk + '.*غزة');
    const beirut = new RegExp(desk + '.*بيروت');
    await branches.getByRole('button', { name: gaza }).click();
    await expect(form.getByLabel('رئيس القسم')).toHaveValue('usr-2');
    await chart.getByRole('button', { name: 'نقل القسم المحدد' }).click();
    await expect(branches.getByRole('button', { name: gaza })).toBeDisabled();
    await chart.getByRole('button', { name: 'نقل إلى المستوى الرئيسي' }).click();
    await expect(branches.getByRole('button', { name: gaza })).toHaveCount(0);
    await page.setViewportSize({ width: 375, height: 812 });
    await branches.getByRole('button', { name: beirut }).click();
    await expect(name).toBeFocused();
    await expect(form.getByLabel('رئيس القسم')).toHaveValue('usr-3');
    await expect(form.getByLabel('تابع لقسم')).toHaveValue(rootId);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await form.getByRole('button', { name: 'حفظ الأقسام' }).click();
    await expect(form.getByText('حُفظت الأقسام الإدارية')).toBeVisible();
    await page.reload();
    await expect(branches.getByRole('button', { name: beirut })).toBeVisible();
    await expect(branches.getByRole('button', { name: gaza })).toHaveCount(0);
    expect(admin.errors).toEqual([]);
  } finally {
    try {
      const { collections } = await (await page.request.get('/api/v1/data')).json();
      const row = collections.settings[0];
      const departments = row.d.departments?.filter((d: { id: string }) => !added.has(d.id));
      if (departments && departments.length !== row.d.departments.length) {
        const response = await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' },
          data: { ops: [{ c: 'settings', id: row.id, op: 'upsert', baseV: row.v, d: { ...row.d, departments } }] } });
        expect((await response.json()).results[0].ok).toBe(true);
      }
    } finally { await admin.close(); }
  }
});
