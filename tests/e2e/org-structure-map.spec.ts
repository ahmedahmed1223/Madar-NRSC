import { expect, test } from '@playwright/test';
import { openNav, openSettingsSection, signIn } from './helpers';

const H = { 'X-NRCS-Client': 'web' };

test('administrator explores station cooperation and switches organizational views on phone and dark mode', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const { page } = admin;
  const before = await (await page.request.get('/api/v1/data')).json();
  const original = before.collections.settings[0];
  try {
    const stations = [
      { id: 'gaza', name: 'غزة', isMain: true, linkedIds: [] },
      { id: 'beirut', name: 'بيروت', linkedIds: ['istanbul'] },
      { id: 'istanbul', name: 'إسطنبول', linkedIds: [] },
    ];
    const saved = await page.request.post('/api/v1/data/sync', { headers: H, data: { ops: [{
      c: 'settings', id: original.id, op: 'upsert', baseV: original.v,
      d: { ...original.d, stations, stationGroups: [{ id: 'north', name: 'منطقة الشمال', stationIds: ['beirut', 'istanbul'] }] },
    }] } });
    expect((await saved.json()).results[0].ok).toBe(true);

    await openNav(page, 'الإعدادات');
    await openSettingsSection(page, 'الهيكل التنظيمي');
    const views = page.getByRole('group', { name: 'طرق عرض الهيكل التنظيمي' });
    await views.getByRole('button', { name: 'خريطة المحطات', exact: true }).click();
    const map = page.getByRole('region', { name: 'خريطة تعاون المحطات' });
    await expect(map).toBeVisible();
    const mainBox = await map.getByRole('button', { name: /غزة/ }).boundingBox();
    const branchBox = await map.getByRole('button', { name: /إسطنبول/ }).boundingBox();
    expect(mainBox!.x).toBeGreaterThan(branchBox!.x);
    const link = map.getByTestId('station-link-beirut-istanbul');
    await expect(link).toHaveCount(1);
    expect(await link.evaluate((element: SVGLineElement) => element.getBBox().width)).toBeGreaterThan(0);
    await map.getByRole('button', { name: /بيروت/ }).click();
    const details = page.getByRole('region', { name: 'تفاصيل محطة بيروت' });
    await expect(details).toContainText('منطقة الشمال');
    await expect(details).toContainText('تتابع وتكلّف');
    await expect(details).toContainText('إسطنبول');

    await map.getByRole('button', { name: 'عرض قائمة المحطات', exact: true }).click();
    const list = page.getByRole('list', { name: 'قائمة المحطات وروابطها' });
    await expect(list).toBeVisible();
    await list.getByRole('button', { name: /إسطنبول/ }).click();
    await expect(page.getByRole('region', { name: 'تفاصيل محطة إسطنبول' })).toContainText('بيروت');

    await views.getByRole('button', { name: 'مخطط الأقسام', exact: true }).click();
    await expect(page.getByRole('region', { name: 'مخطط الأقسام' })).toBeVisible();
    await views.getByRole('button', { name: 'مصفوفة الأقسام والمحطات', exact: true }).click();
    await expect(page.getByRole('table')).toBeVisible();

    await views.getByRole('button', { name: 'خريطة المحطات', exact: true }).click();
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: /المظهر:/ }).first().click();
    await page.getByRole('menuitemradio', { name: /^ليلي/ }).click();
    await expect(map).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/dark/);
    expect(admin.errors).toEqual([]);
  } finally {
    const latest = (await (await page.request.get('/api/v1/data')).json()).collections.settings[0];
    await page.request.post('/api/v1/data/sync', { headers: H, data: { ops: [{
      c: 'settings', id: latest.id, op: 'upsert', baseV: latest.v,
      d: { ...latest.d, stations: original.d.stations, stationGroups: original.d.stationGroups },
    }] } });
    await admin.close();
  }
});
