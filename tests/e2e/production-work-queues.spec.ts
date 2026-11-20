import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

const syncPath = '**/api/v1/data/sync';
const headers = { 'X-NRCS-Client': 'web' };

async function rows(page: Page) {
  const response = await page.request.get('/api/v1/data');
  expect(response.ok()).toBe(true);
  return (await response.json()).collections;
}

test('mobile producer follows the preparation checklist and confirms the linked studio booking', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'producer@akhbar.tv', { viewport: { width: 390, height: 844 } });
  let release = () => {};
  try {
    const data = await rows(page);
    const episode = data.episodes.find((row: any) => row.d.rundown?.length && !row.d.deletedAt);
    const camera = data.resources.find((row: any) => row.d.kind === 'CAMERA');
    const cameraBooking = await page.request.post('/api/v1/data/sync', { headers, data: { ops: [{
      c: 'bookings', op: 'upsert', id: 'phase-three-camera', d: {
        id: 'phase-three-camera', resourceId: camera.id, title: 'Camera only', start: '2036-06-15T07:00:00Z', end: '2036-06-15T08:00:00Z', status: 'CONFIRMED',
        link: { kind: 'episode', id: episode.id, title: episode.d.title },
      },
    }] } });
    expect((await cameraBooking.json()).results[0].ok).toBe(true);
    await page.goto(`/episodes/${episode.id}`);
    const checklist = page.getByRole('region', { name: 'قائمة تحضير الحلقة' });
    await expect(checklist).toContainText('لا يوجد حجز استوديو مرتبط بالحلقة.');
    await checklist.getByRole('button', { name: 'متابعة الضيوف' }).click();
    await expect(page.getByTestId('episode-guests')).toBeVisible();
    await checklist.getByRole('button', { name: 'مراجعة الرانداون' }).click();
    await expect(page.getByRole('button', { name: /^الرانداون/ })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await checklist.getByRole('button', { name: 'حجز استوديو', exact: true }).click();
    const form = page.locator('#form-page-root');
    const resourceId = await form.getByLabel('المورد').inputValue();
    const studio = data.resources.find((row: any) => row.id === resourceId);
    expect(studio.d.kind).toBe('STUDIO');
    await form.getByLabel('من', { exact: true }).fill('2036-06-15T10:00');
    await form.getByLabel('إلى', { exact: true }).fill('2036-06-15T11:00');
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(syncPath, async route => {
      if (route.request().postDataJSON().ops.some((op: any) => op.c === 'bookings' && op.d?.resourceId === resourceId)) await gate;
      await route.continue();
    });
    await form.getByRole('button', { name: 'احجز', exact: true }).click();
    await expect(form.getByText('بانتظار تأكيد الخادم…')).toBeVisible();
    await expect(page.getByText('تم الحجز', { exact: true })).toHaveCount(0);
    release();
    await expect(form.getByLabel('المورد')).toHaveCount(0);
    await expect(checklist.getByText(new RegExp(`${studio.d.name.split(' (')[0]}.*مؤكد`))).toBeVisible();
    const after = await rows(page);
    expect(after.bookings.some((row: any) => row.d.resourceId === resourceId && row.d.link?.id === episode.id && row.d.status === 'CONFIRMED')).toBe(true);
    expect(after.episodes.find((row: any) => row.id === episode.id).d.status).toBe(episode.d.status);
    expect(errors).toEqual([]);
  } finally {
    release();
    await page.unroute(syncPath);
    await close();
  }
});

test('media queue shows departmental work and reports delivery only after the request is confirmed', async ({ browser }) => {
  const requester = await signIn(browser, 'producer@akhbar.tv');
  const { page, errors, close } = await signIn(browser, 'media@akhbar.tv');
  let release = () => {};
  try {
    const requestId = 'phase-three-montage';
    const mediaId = 'phase-three-video';
    const data = await rows(requester.page);
    const source = data.episodes.find((row: any) => row.d.rundown?.length > 1 && !row.d.deletedAt);
    const segment = source.d.rundown[1];
    const created = await requester.page.request.post('/api/v1/data/sync', { headers, data: { ops: [
      { c: 'requests', op: 'upsert', id: requestId, d: { id: requestId, type: 'MONTAGE', priority: 'URGENT', title: 'Montage delivery fixture', link: { kind: 'segment', episodeId: source.id, segmentId: segment.id, title: segment.title } } },
      { c: 'requests', op: 'upsert', id: 'phase-three-graphics', d: { type: 'GRAPHICS', title: 'Graphics request outside the montage desk' } },
    ] } });
    expect((await created.json()).results.map((r: any) => r.ok)).toEqual([true, true]);
    const video = await page.request.post('/api/v1/data/sync', { headers, data: { ops: [{ c: 'media', op: 'upsert', id: mediaId, d: { id: mediaId, title: 'Approved fixture video', fileName: 'fixture.mp4', mediaType: 'VIDEO', mimeType: 'video/mp4', videoStatus: 'APPROVED', url: '/fixture.mp4', tags: [] } }] } });
    expect((await video.json()).results[0].ok).toBe(true);
    await page.goto('/requests');
    await page.getByRole('tab', { name: /تسليم الوسائط/ }).click();
    const requestRow = page.getByRole('article').filter({ hasText: 'Montage delivery fixture' });
    await expect(requestRow).toBeVisible();
    await expect(page.getByText('Graphics request outside the montage desk')).toHaveCount(0);
    await requestRow.getByRole('button', { name: segment.title, exact: true }).click();
    const segmentPath = `/episodes/${encodeURIComponent(source.id)}/segments/${encodeURIComponent(segment.id)}`;
    const segmentRow = page.locator(`[data-sortable-item="${segment.id}"]`);
    await expect(page).toHaveURL(path => path.pathname === segmentPath);
    await expect(segmentRow).toBeFocused();
    await page.reload();
    await expect(segmentRow).toBeFocused();
    await page.goto('/requests');
    await page.getByRole('tab', { name: /تسليم الوسائط/ }).click();
    await requestRow.getByRole('button', { name: 'إرفاق مادة وتسليمها' }).click();
    const picker = page.getByRole('dialog', { name: 'اختيار مادة التسليم' });
    await picker.getByRole('button', { name: /Approved fixture video/ }).click();
    await picker.getByRole('button', { name: 'متابعة التسليم' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'إنجاز الطلب' });
    await expect(confirm).toContainText('Montage delivery fixture');
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(syncPath, async route => {
      if (route.request().postDataJSON().ops.some((op: any) => op.c === 'requests' && op.id === requestId && op.d?.status === 'DONE')) await gate;
      await route.continue();
    });
    await confirm.getByRole('button', { name: 'تأكيد الإنجاز' }).click();
    await expect(requestRow.getByText('بانتظار تأكيد الخادم')).toBeVisible();
    await expect(page.getByText('أُنجز الطلب وسُلّمت المادة', { exact: true })).toHaveCount(0);
    expect((await rows(page)).requests.find((row: any) => row.id === requestId).d.status).toBe('OPEN');
    release();
    await expect(page.getByRole('status').filter({ hasText: 'أُنجز الطلب وسُلّمت المادة' })).toBeVisible();
    await expect(requestRow).toHaveCount(0);
    await page.goto(`/requests/${requestId}`);
    await expect(requestRow.getByRole('button', { name: /المادة المسلّمة: Approved fixture video/ })).toBeVisible();
    const after = await rows(page);
    expect(after.requests.find((row: any) => row.id === requestId).d).toMatchObject({ status: 'DONE', resultMediaId: mediaId });
    expect(after.media.find((row: any) => row.id === mediaId).d.videoStatus).toBe('APPROVED');
    expect(errors).toEqual([]);
  } finally {
    release();
    await page.unroute(syncPath);
    await close();
    await requester.close();
  }
});
