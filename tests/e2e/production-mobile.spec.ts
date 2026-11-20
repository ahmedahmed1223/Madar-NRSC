import { expect, test, type Locator } from '@playwright/test';
import { signIn } from './helpers';

const phone = { width: 320, height: 844 };

async function expectTouchTarget(control: Locator) {
  await expect(control).toBeVisible();
  const box = (await control.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(phone.width);
}

test('episode filters, sorting and workspace actions fit a narrow phone', async ({ browser }, testInfo) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { viewport: phone });
  try {
    await page.goto('/episodes');
    const filters = page.getByRole('group', { name: 'تصفية الحلقات' });
    await expectTouchTarget(filters.getByRole('searchbox'));
    for (const filter of await filters.getByRole('combobox').all()) {
      await expectTouchTarget(filter);
    }
    const list = page.getByRole('region', { name: 'قائمة الحلقات' });
    const dateHeader = list.getByRole('columnheader', { name: 'موعد البث' });
    const sort = dateHeader.getByRole('button');
    await expectTouchTarget(sort);
    await expect(dateHeader).toHaveAttribute('aria-sort', 'descending');
    await sort.click();
    await expect(dateHeader).toHaveAttribute('aria-sort', 'ascending');
    const open = list.getByRole('button', { name: 'فتح مساحة العمل', exact: true }).first();
    await expectTouchTarget(open);
    expect(await list.evaluate(node => node.scrollWidth - node.clientWidth)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('episodes-mobile.png') });
    await open.click();
    await expect(page).toHaveURL(/\/episodes\/.+/);
  } finally {
    await close();
  }
});

test('bulletin date controls navigate to another day and back on a phone', async ({ browser }, testInfo) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { viewport: phone });
  try {
    await page.goto('/bulletins');
    const picker = page.getByRole('group', { name: 'تاريخ عرض النشرات' });
    const date = picker.getByLabel('التاريخ', { exact: true });
    await expectTouchTarget(date);
    const today = await date.inputValue();
    const next = picker.getByRole('button', { name: 'اليوم التالي' });
    await expectTouchTarget(next);
    await next.click();
    await expect(date).not.toHaveValue(today);
    const reset = picker.getByRole('button', { name: 'العودة لليوم' });
    await expectTouchTarget(reset);
    await page.screenshot({ path: testInfo.outputPath('bulletins-mobile.png') });
    await reset.click();
    await expect(date).toHaveValue(today);
  } finally {
    await close();
  }
});

test('mobile production shows today’s broadcast assignments and exports filtered workload', async ({ browser }, testInfo) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { viewport: phone });
  try {
    const id = 'crd-mobile-broadcast';
    const title = 'تقرير المناوبة المسائي المقرر للبث اليوم';
    const { user } = await (await page.request.get('/api/v1/auth/me')).json();
    const write = await page.request.post('/api/v1/data/sync', {
      headers: { 'X-NRCS-Client': 'web' },
      data: { ops: [{ c: 'productionCards', op: 'upsert', id, d: {
        id, title, kind: 'REPORT', priority: 'NORMAL', status: 'OPEN',
        ownerId: user.id, airAt: new Date().toISOString(), log: [],
        steps: [{ id: `${id}-gather`, type: 'gather', status: 'TODO', complexity: 1, assigneeId: user.id }],
      } }] },
    });
    expect((await write.json()).results[0]).toMatchObject({ ok: true });
    await page.goto('/cards');
    const schedule = page.getByRole('region', { name: 'جدول ما يُبث اليوم' });
    const card = schedule.getByRole('button', { name: title });
    await expectTouchTarget(card);
    expect(await schedule.evaluate(node => node.scrollWidth - node.clientWidth)).toBe(0);
    await schedule.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('assignments-mobile.png') });
    await card.click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await page.goto('/workload');
    const workload = page.getByRole('group', { name: 'تصفية عبء العمل وتصديره' });
    const period = workload.getByRole('combobox', { name: 'الفترة' });
    await expectTouchTarget(period);
    await period.selectOption('custom');
    await expectTouchTarget(workload.getByLabel('من يوم'));
    await expectTouchTarget(workload.getByLabel('إلى يوم'));
    const exportCsv = workload.getByRole('button', { name: 'CSV', exact: true });
    await expectTouchTarget(exportCsv);
    await page.screenshot({ path: testInfo.outputPath('workload-mobile.png') });
    const [download] = await Promise.all([page.waitForEvent('download'), exportCsv.click()]);
    expect(download.suggestedFilename()).toMatch(/^متابعة-الفرق-.*\.csv$/);
  } finally {
    await close();
  }
});
