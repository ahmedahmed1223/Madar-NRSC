import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('rejected story save keeps script open', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'producer@akhbar.tv');
  const data = await (await page.request.get('/api/v1/data')).json();
  const row = data.collections.bulletins[0];
  const story = data.collections.bulletinStories.find((r: any) => r.d.bulletinId === row.id);
  await openNav(page, 'النشرات');
  await page.getByLabel('التاريخ', { exact: true }).fill(row.d.date);
  await page.getByRole('button', { name: `فتح ${row.d.title}`, exact: true }).click();
  await page.getByRole('button', { name: `فتح ${story.d.slug}`, exact: true }).click();
  const form = page.getByTestId('story-editor');
  await form.locator('textarea').first().fill('نص معدل يبقى عند رفض الحفظ');
  await page.route('**/api/v1/data/sync', async route => {
    const ops = route.request().postDataJSON().ops;
    if (!ops.some((op: any) => op.c === 'bulletinStories')) return route.continue();
    await route.fulfill({ json: { rev: data.rev, results: ops.map((op: any) => ({ c: op.c, id: op.id, ok: false, code: 'CONFLICT', message: 'رفض قصة للاختبار', current: story })) } });
  });
  await form.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(form.locator('textarea').first()).toHaveValue('نص معدل يبقى عند رفض الحفظ');
  await expect(form.getByRole('alert')).toContainText('رفض قصة للاختبار');
  await page.unroute('**/api/v1/data/sync');
  await form.getByRole('button', { name: 'إغلاق', exact: true }).click();
  await close();
});

test('rejected bulletin metadata keeps fields open and retry saves on the server', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'producer@akhbar.tv');
  const data = await (await page.request.get('/api/v1/data')).json();
  const row = data.collections.bulletins.find((r: any) => r.d.title.startsWith('نشرة الثامنة'));
  await openNav(page, 'النشرات');
  await page.getByLabel('التاريخ', { exact: true }).fill(row.d.date);
  await page.locator('button[aria-label^="فتح نشرة الثامنة"]').first().click();
  await page.getByRole('button', { name: 'بيانات النشرة', exact: true }).click();
  const form = page.locator('#form-page-root');
  const title = `${row.d.title} (تعديل محفوظ بعد إعادة المحاولة)`;
  await form.getByLabel('العنوان', { exact: true }).fill(title);
  await page.route('**/api/v1/data/sync', async route => {
    const body = route.request().postDataJSON();
    if (!body.ops.some((op: any) => op.c === 'bulletins')) return route.continue();
    await route.fulfill({ json: { rev: data.rev, results: body.ops.map((op: any) => ({ c: op.c, id: op.id, ok: false, code: 'CONFLICT', message: 'رفض حفظ النشرة للاختبار', current: row })) } });
  });
  await form.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(form.getByLabel('العنوان', { exact: true })).toHaveValue(title);
  await expect(form.getByRole('alert')).toBeVisible();
  await expect(page.getByText('حُفظت بيانات النشرة', { exact: true })).not.toBeVisible();
  await page.unroute('**/api/v1/data/sync');
  await form.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(page.getByText('حُفظت بيانات النشرة', { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const saved = await (await page.request.get('/api/v1/data')).json();
    return saved.collections.bulletins.find((r: any) => r.id === row.id).d.title;
  }).toBe(title);
  await close();
});

for (const collection of ['bulletinFormats', 'bulletinStories']) {
  test(`rejected ${collection} write does not announce success`, async ({ browser }) => {
    const { page, close } = await signIn(browser, 'producer@akhbar.tv');
    const data = await (await page.request.get('/api/v1/data')).json();
    const row = data.collections.bulletins[0];
    await openNav(page, 'النشرات');
    await page.getByLabel('التاريخ', { exact: true }).fill(row.d.date);
    await page.locator(`button[aria-label="فتح ${row.d.title}"]`).click();
    await page.route('**/api/v1/data/sync', async route => {
      const body = route.request().postDataJSON();
      if (!body.ops.some((op: any) => op.c === collection)) return route.continue();
      await route.fulfill({ json: { rev: data.rev, results: body.ops.map((op: any) => ({ c: op.c, id: op.id, ok: false, code: 'FORBIDDEN', message: 'رفض الحفظ للاختبار' })) } });
    });
    if (collection === 'bulletinFormats') {
      await page.getByRole('button', { name: 'حفظ كقالب', exact: true }).click();
      await page.getByLabel('اسم القالب', { exact: true }).fill('قالب رفض اختباري');
      await page.getByRole('dialog').getByRole('button', { name: 'موافق', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'رفض الحفظ للاختبار' }).first()).toBeVisible();
      await expect(page.getByText(/حُفظت بنية النشرة كقالب/)).not.toBeVisible();
    } else {
      await page.getByRole('button', { name: 'من غرفة الأخبار', exact: true }).click();
      const form = page.locator('#form-page-root');
      await form.getByRole('checkbox').first().check();
      await form.getByRole('button', { name: /إضافة.*للنشرة/ }).click();
      await expect(form.getByRole('alert')).toContainText('رفض الحفظ للاختبار');
      await expect(form.getByRole('checkbox').first()).toBeChecked();
      await expect(page.getByText(/أُضيفت .* قصة كمسودات/)).not.toBeVisible();
      await page.unroute('**/api/v1/data/sync');
      await form.getByRole('button', { name: /إضافة.*للنشرة/ }).click();
      await expect(page.getByText('أُضيفت 1 قصة كمسودات في آخر النشرة', { exact: true })).toBeVisible();
      const after = await (await page.request.get('/api/v1/data')).json();
      expect(after.collections.bulletinStories.length).toBe(data.collections.bulletinStories.length + 1);
    }
    await page.unroute('**/api/v1/data/sync');
    await close();
  });
}
