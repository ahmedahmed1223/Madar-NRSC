import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('news search survives editing and reload with author and date filters', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'الأخبار');
  const search = page.getByRole('searchbox', { name: 'البحث في الأخبار' });
  await search.fill('القمة');
  await page.setViewportSize({ width: 1440, height: 400 });
  const scrollTop = await page.locator('#app-main').evaluate(el => { const scroller = el.parentElement!; scroller.scrollTop = 80; return scroller.scrollTop; });
  expect(scrollTop).toBeGreaterThan(0);
  await page.locator('button[title="تحرير الخبر"]').first().click();
  await page.getByTitle('العودة لقائمة الأخبار', { exact: true }).click();
  await expect(search).toHaveValue('القمة');
  await expect.poll(() => page.locator('#app-main').evaluate(el => el.parentElement!.scrollTop)).toBe(scrollTop);
  await page.reload();
  await expect(search).toHaveValue('القمة');
  await expect(page.getByLabel('الكاتب:', { exact: true })).toBeVisible();
  await expect(page.getByLabel('من تاريخ:', { exact: true })).toBeVisible();
  await close();
});

test('confirmed review advances to the next item from the filtered queue', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  const data = await (await page.request.get('/api/v1/data')).json();
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  const ids = [`review-queue-a-${Date.now()}`, `review-queue-b-${Date.now()}`];
  const response = await (await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: ids.map((id, index) => ({
    c: 'news', op: 'upsert', id, d: { ...data.collections.news[0].d, id, title: `رحلة المراجعة ${index + 1}`, content: 'هذه مادة اختبارية تحتوي على معلومات كافية لمراجعة الخبر وتأكيد صحة انتقال الحالة داخل النظام', status: 'UNDER_REVIEW', authorId: me.user.id, workflowLogs: [], deletedAt: undefined, embargoUntil: undefined },
  })) } })).json();
  expect(response.results.every((r: any) => r.ok)).toBe(true);
  await openNav(page, 'الأخبار');
  await page.getByRole('searchbox', { name: 'البحث في الأخبار' }).fill('رحلة المراجعة');
  await page.getByRole('tab', { name: /قيد المراجعة/ }).click();
  await page.getByRole('region', { name: 'طابور مراجعة الأخبار' }).getByRole('button', { name: 'رحلة المراجعة 1', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'فتح الخبر التالي بعد إنهاء المراجعة' })).toBeChecked();
  await page.getByRole('button', { name: 'اعتماد الخبر للنشر', exact: true }).click();
  await page.getByRole('button', { name: 'تأكيد ونقل الحالة', exact: true }).click();
  await expect(page.locator('#news-headline-input')).toHaveValue('رحلة المراجعة 2');
  await close();
});

test('return from a breaking story keeps the originating desk', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  const data = await (await page.request.get('/api/v1/data')).json();
  const item = data.collections.news.find((row: any) => row.d.status === 'PUBLISHED' && !row.d.deletedAt);
  expect(item).toBeTruthy();
  const result = await (await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [{ c: 'news', op: 'upsert', id: item.id, baseV: item.v, d: { ...item.d, isBreaking: true, breakingUntil: undefined } }] } })).json();
  expect(result.results[0].ok).toBe(true);
  await page.goto('/breaking');
  const search = page.getByRole('searchbox', { name: 'البحث في الأخبار' });
  await search.fill(' ');
  await page.locator('button[title="تحرير الخبر"]').first().click();
  await page.getByTitle('العودة لقائمة الأخبار', { exact: true }).click();
  await expect(page).toHaveURL(/\/breaking$/);
  await expect(search).toHaveValue(' ');
  await close();
});

test('cancelling browser reload keeps the editing lease alive', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'الأخبار');
  await page.locator('button[title="تحرير الخبر"]').first().click();
  const id = new URL(page.url()).pathname.split('/').pop();
  await page.locator('#news-headline-input').fill('نص يبقى عند إلغاء تحديث المتصفح');
  await expect.poll(async () => {
    const data = await (await page.request.get('/api/v1/data')).json();
    return data.collections.editLocks.some((row: any) => row.id === `news:${id}`);
  }).toBe(true);
  const releases: string[] = [];
  await page.route('**/api/v1/data/sync', async route => {
    const body = route.request().postDataJSON();
    for (const op of body.ops) if (op.c === 'editLocks' && op.op === 'delete') releases.push(op.id);
    await route.continue();
  });
  page.removeAllListeners('dialog');
  page.once('dialog', dialog => void dialog.dismiss());
  await page.reload({ timeout: 5000 }).catch(() => undefined);
  await expect(page.locator('#news-headline-input')).toHaveValue('نص يبقى عند إلغاء تحديث المتصفح');
  await page.request.get('/api/v1/data');
  expect(releases).toEqual([]);
  await page.unroute('**/api/v1/data/sync');
  await close();
});

test('failed save offers retry and compact actions remain reachable on mobile', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv', { viewport: { width: 390, height: 844 } });
  await openNav(page, 'الأخبار');
  await page.locator('button[title="تحرير الخبر"]').first().click();
  await page.locator('#news-headline-input').fill('اختبار إعادة محاولة الحفظ');
  const data = await (await page.request.get('/api/v1/data')).json();
  const id = new URL(page.url()).pathname.split('/').pop();
  const row = data.collections.news.find((r: any) => r.id === id);
  await page.route('**/api/v1/data/sync', async route => {
    const body = route.request().postDataJSON();
    if (!body.ops.some((op: any) => op.c === 'news')) return route.continue();
    return route.fulfill({ json: { rev: data.rev, dbId: data.dbId,
      results: body.ops.map(() => ({ ok: false, code: 'CONFLICT', message: 'رفض اختباري', current: row })) } });
  });
  await page.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click();
  await expect(page.getByRole('button', { name: 'إعادة محاولة الحفظ', exact: true })).toBeVisible();
  await expect(page.locator('#news-headline-input')).toHaveValue('اختبار إعادة محاولة الحفظ');
  await page.unroute('**/api/v1/data/sync');
  await page.getByRole('button', { name: 'إعادة محاولة الحفظ', exact: true }).click();
  await expect(page.getByText('تم الحفظ على الخادم', { exact: true })).toBeVisible();
  await page.locator('#news-headline-input').evaluate(el => el.scrollIntoView());
  const bar = page.getByRole('toolbar', { name: 'إجراءات تحرير الخبر' });
  await expect(bar).toBeVisible();
  const rect = await bar.boundingBox();
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(391);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/editor-actions-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => { const rect = await page.locator('aside').boundingBox(); return Math.round(rect!.x + rect!.width); }).toBeLessThanOrEqual(1440);
  await expect(bar).toBeVisible();
  const desktopRect = await bar.boundingBox();
  expect(desktopRect!.y).toBeGreaterThanOrEqual(0);
  expect(desktopRect!.y + desktopRect!.height).toBeLessThan(901);
  expect(await page.evaluate(() => document.documentElement.scrollTop)).toBe(0);
  await page.screenshot({ path: 'test-results/editor-actions-desktop.png' });
  await close();
});

test('failed bulk action lists every failure and offers retry', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'الأخبار');
  await page.getByRole('checkbox', { name: /^تحديد الخبر:/ }).first().check();
  const data = await (await page.request.get('/api/v1/data')).json();
  await page.route('**/api/v1/data/sync', async route => {
    const body = route.request().postDataJSON();
    if (!body.ops.some((op: any) => op.c === 'news')) return route.continue();
    return route.fulfill({ json: { rev: data.rev, dbId: data.dbId, results: body.ops.map((op: any) => ({ ok: false, code: 'TEST', message: 'فشل اختباري', current: data.collections.news.find((row: any) => row.id === op.id) })) } });
  });
  await page.getByRole('button', { name: 'حذف المحدد', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'حذف', exact: true }).click();
  await expect(page.getByRole('region', { name: 'نتيجة الإجراء الجماعي' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'إعادة محاولة الفاشل فقط', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /^تحديد الخبر:/ }).first()).toBeChecked();
  await page.unroute('**/api/v1/data/sync');
  await close();
});

test('review queue and episode blockers expose actionable destinations', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'الأخبار');
  await page.getByRole('tab', { name: /قيد المراجعة/ }).first().click();
  await expect(page.getByRole('region', { name: 'طابور مراجعة الأخبار' })).toBeVisible();
  const data = await (await page.request.get('/api/v1/data')).json();
  const episode = data.collections.episodes.find((row: any) => row.d.rundown?.length);
  const guest = data.collections.guests[0];
  const changed = await (await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [{
    c: 'episodes', op: 'upsert', id: episode.id, baseV: episode.v,
    d: { ...episode.d, status: 'IN_PREPARATION', questions: [], guests: [{ guestId: guest.id, guestName: guest.d.fullName, bookingStatus: 'CANDIDATE' }], rundown: [
      { ...episode.d.rundown[0], id: 'blocker-test-segment', title: 'فقرة نواقص اختبارية', segmentType: 'REPORT', scriptText: '', script: '', newsId: null, videoAssetUrl: '', mediaIds: [] },
      { ...episode.d.rundown[0], id: 'blocker-test-interview', title: 'حوار اختبار النواقص', segmentType: 'LIVE_INTERVIEW', scriptText: 'نص جاهز للحوار', newsId: null, guests: [{ guestId: guest.id, guestName: guest.d.fullName, role: 'MAIN' }] },
    ] },
  }] } })).json();
  expect(changed.results[0].ok).toBe(true);
  await page.goto(`/episodes/${episode.id}`);
  await page.getByRole('button', { name: 'عرض النواقص', exact: true }).click();
  const action = page.getByRole('button', { name: /^معالجة النقص:/ }).first();
  await expect(action).toBeVisible();
  const label = await action.getAttribute('aria-label');
  await action.click();
  const target = page.locator(label?.includes('الفيديو') ? '#segment-video-input' : '#segment-script-textarea');
  await expect(target).toBeVisible();
  await expect(target).toBeFocused();
  await page.goBack();
  await page.getByRole('button', { name: /^معالجة النقص: حوار اختبار النواقص - الضيف$/ }).click();
  await expect(page.getByRole('navigation', { name: 'خطوات إعداد الحلقة' }).getByRole('button', { name: /الضيوف والحجز/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^معالجة النقص: حوار اختبار النواقص - الأسئلة$/ }).click();
  await expect(page.getByRole('heading', { name: 'سؤال جديد', exact: true })).toBeVisible();
  await page.goBack();
  await openNav(page, 'الرئيسية');
  const fresh = await (await page.request.get('/api/v1/data')).json();
  await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [{ c: 'episodes', op: 'upsert', id: episode.id, baseV: fresh.collections.episodes.find((row: any) => row.id === episode.id).v, d: episode.d }] } });
  await close();
});
