import { expect, test } from '@playwright/test';
import { signIn, openNav } from './helpers';
test.use({ actionTimeout: 10_000 });
test('production suggestions reach editorial forms without replacing historical/free-text names', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  const token = Date.now(); const name = `مذيع للقوائم ${token}`; const studioName = `استديو للقوائم ${token}`;
  const send = async (ops: any[]) => {
    const response = await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops } });
    expect((await response.json()).results.every((r: any) => r.ok)).toBe(true);
  };
  try {
    await send([{ c: 'productionPeople', op: 'upsert', id: `field-person-${token}`, d: { id: `field-person-${token}`, name, roles: ['PRESENTER', 'DIRECTOR'], active: true } },
      { c: 'resources', op: 'upsert', id: `field-studio-${token}`, d: { id: `field-studio-${token}`, name: studioName, kind: 'STUDIO', isActive: true } }]);
    await openNav(page, 'البرامج');
    await page.getByRole('button', { name: 'إضافة برنامج جديد', exact: true }).click();
    const presenter = page.locator('#program-presenter-input');
    const studio = page.locator('#program-studio-input');
    await expect.poll(async () => page.locator(`datalist#${await presenter.getAttribute('list')} option`).allTextContents()).toContain(name);
    await expect.poll(async () => page.locator(`datalist#${await studio.getAttribute('list')} option`).allTextContents()).toContain(studioName);
    await presenter.fill('مذيع تاريخي غير مسجل');
    const data = await (await page.request.get('/api/v1/data')).json();
    const person = data.collections.productionPeople.find((r: any) => r.id === `field-person-${token}`);
    await send([{ c: 'productionPeople', op: 'upsert', id: person.id, baseV: person.v, d: { ...person.d, active: false, name: 'اسم معدل' } }]);
    await expect(presenter).toHaveValue('مذيع تاريخي غير مسجل');
    await expect.poll(async () => page.locator(`datalist#${await presenter.getAttribute('list')} option`).allTextContents()).not.toContain(name);
    await page.keyboard.press('Escape');
    await openNav(page, 'النشرات');
    await page.getByRole('button', { name: 'نشرة جديدة', exact: true }).click();
    const anchors = page.getByLabel('المذيعون (افصل بفاصلة)', { exact: true });
    await anchors.fill('مذيع سابق، ');
    const options = page.locator(`datalist#${await anchors.getAttribute('list')} option`);
    await expect.poll(async () => options.count()).toBeGreaterThan(0);
    expect((await options.allTextContents()).every(option => option.startsWith('مذيع سابق، '))).toBe(true);
    await expect(anchors).toHaveValue('مذيع سابق، ');
  } finally { await close(); }
});
