import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('a director reaches the first bulletin blocker on mobile and from air preflight', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'admin@akhbar.tv', { viewport: { width: 375, height: 812 } });
  try {
    const { collections } = await (await page.request.get('/api/v1/data')).json();
    const baseBulletin = collections.bulletins[0].d;
    const baseStory = collections.bulletinStories[0].d;
    const bulletinId = `bulletin-mobile-preflight-${Date.now()}`;
    const storyId = `${bulletinId}-story`;
    const response = await page.request.post('/api/v1/data/sync', {
      headers: { 'X-NRCS-Client': 'web' }, data: { ops: [
        { c: 'bulletins', op: 'upsert', id: bulletinId, d: { ...baseBulletin, id: bulletinId, title: 'نشرة اختبار جاهزية الهاتف', status: 'PLANNING' } },
        { c: 'bulletinStories', op: 'upsert', id: storyId, d: { ...baseStory, id: storyId, bulletinId, slug: 'القصة المتعطلة للاختبار', status: 'DRAFT', script: '', killed: false, floated: false } },
      ] },
    });
    expect((await response.json()).results.map((result: { ok: boolean }) => result.ok)).toEqual([true, true]);

    await page.goto(`/bulletins/${bulletinId}`);
    const preflight = page.getByRole('region', { name: 'جاهزية النشرة' });
    const openBlocker = preflight.getByRole('button', { name: 'فتح قصة النشرة: القصة المتعطلة للاختبار' });
    await expect(openBlocker).toBeInViewport();
    await expect(preflight).toContainText('لم يكتمل اعتماد القصة');
    await expect(preflight).toContainText('المسؤول');
    await openBlocker.click();
    await expect(page.locator('#form-page-root .form-page')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('bulletin-rundown').getByRole('button', { name: 'وضع الهواء', exact: true }).click();
    await expect(page.getByRole('button', { name: 'بدء البث', exact: true })).toBeDisabled();
    await expect(page.getByText('خادم مدار', { exact: true })).toBeVisible();
    await openBlocker.click();
    await expect(page).toHaveURL(path => path.pathname === `/bulletins/${bulletinId}`);
    await expect(page.locator('#form-page-root .form-page')).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await close(); }
});

test('the programme directory offers a dense list and keeps the card view available', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'producer@akhbar.tv', { viewport: { width: 768, height: 900 } });
  try {
    await page.goto('/programs');
    const list = page.getByRole('list', { name: 'قائمة البرامج' });
    await expect(list).toBeVisible();
    await expect(list.getByText('الحلقة القادمة', { exact: true }).first()).toBeVisible();
    await expect(list.getByText('المنتج', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'البطاقات', exact: true }).click();
    await expect(list).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^فتح ملف البرنامج:/ }).first()).toBeVisible();
  } finally { await close(); }
});
