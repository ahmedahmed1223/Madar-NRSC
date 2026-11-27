import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

// A generated 16x16 VP8 clip, independent of network media and system ffmpeg at test time.
const video = Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwH/////////EU2bdKtNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHLTbuMU6uEElTDZ1OsggEY7AEAAAAAAABoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmpSrXsYMPQkBNgIxMYXZmNjEuOS4xMDZXQYxMYXZmNjEuOS4xMDYWVK5ryK4BAAAAAAAAP9eBAXPFiGvTcnZqSzWonIEAIrWcg3VuZIiBAIaFVl9WUDiDgQEj44OEAmJaAOCQsIEQuoEQmoECVbCEVbmBARJUw2fXc3OfY8CAZ8iZRaOHRU5DT0RFUkSHjExhdmY2MS45LjEwNnNzsmPAi2PFiGvTcnZqSzWoZ8ihRaOHRU5DT0RFUkSHlExhdmM2MS4zMS4xMDEgbGlidnB4H0O2dUCb54EAo6OBAACAEAIAnQEqEAAQAABHCIWFiIWEiAICAAwNYAD+/6tQgKOVgQAoALEBAAUQrAAYABhYL/QACAAAo5WBAFAAsQEABRCsABgAGFgv9AAIAACjlYEAeACxAQAFEKwAGAAYWC/0AAgAAKOVgQCgALEBAAUQrAAYABhYL/QACAAAo5WBAMgAsQEABRCsABgAGFgv9AAIAAA=', 'base64');
const headers = { 'X-NRCS-Client': 'web' };

test('the bulletin editor can stop the initial preview and manually review a replacement', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  let editor: Awaited<ReturnType<typeof signIn>> | undefined;
  try {
    test.skip(!await admin.page.evaluate(() => Boolean(document.createElement('video').canPlayType('video/webm; codecs="vp8"'))), 'This browser cannot preview the VP8 fixture');
    const id = `media-preview-${Date.now()}`;
    const initial = await (await admin.page.request.get('/api/v1/data')).json();
    const upload = async (label: string, suffix: string) => {
      const file = await admin.page.request.post('/api/v1/media/upload', {
        headers: { ...headers, 'Content-Type': 'video/webm', 'X-File-Name': `clip-${suffix}.webm` }, data: video,
      });
      expect(file.ok()).toBe(true);
      const { data } = await file.json();
      return { c: 'media', op: 'upsert', id: `${id}-${suffix}`, d: { ...data, id: `${id}-${suffix}`, title: label,
        fileName: `clip-${suffix}.webm`, mediaType: 'VIDEO', durationSeconds: 1, tags: [] } };
    };
    const first = await upload('لقطة أولى للمعاينة', 'first');
    const alternative = await upload('لقطة بديلة للمعاينة', 'replacement');
    const storyId = `${id}-story`;
    const slug = 'قصة معاينة اللقطات';
    const setup = await admin.page.request.post('/api/v1/data/sync', { headers, data: { ops: [first, alternative,
      { c: 'bulletins', op: 'upsert', id, d: { ...initial.collections.bulletins[0].d, id, title: 'نشرة معاينة الفيديو', editorId: 'usr-2', status: 'PLANNING', approvalSteps: [] } },
      { c: 'bulletinStories', op: 'upsert', id: storyId, d: { id: storyId, bulletinId: id, slug, script: 'مقدمة التقرير',
        type: 'PKG', status: 'DRAFT', rank: 1500, floated: true, clipMediaId: first.id, clipSeconds: 1 } },
    ] } });
    expect((await setup.json()).results.every((result: { ok: boolean }) => result.ok)).toBe(true);

    editor = await signIn(browser, 'editor@akhbar.tv');
    const { page } = editor;
    await page.goto(`/bulletins/${id}`);
    const openStory = () => page.getByRole('button', { name: `فتح ${slug}`, exact: true }).click();
    await openStory();
    const form = page.getByTestId('story-editor');
    const review = form.getByRole('region', { name: 'معاينة مادة القصة' });
    await expect(review.getByLabel('الوقت المتبقي للمعاينة')).toBeVisible();
    await expect(review.getByRole('button', { name: 'اعتماد المادة', exact: true })).toBeDisabled();
    await review.getByRole('button', { name: 'إيقاف المعاينة وطلب بديل', exact: true }).click();
    await expect(review.getByRole('status')).toContainText('أُوقفت المادة وطُلب بديل');

    await form.getByRole('button', { name: 'تغيير', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'إرفاق من مكتبة الوسائط' });
    await picker.getByRole('searchbox').fill('لقطة بديلة للمعاينة');
    await picker.getByRole('button', { name: /لقطة بديلة للمعاينة/ }).click();
    await picker.getByRole('button', { name: 'اعتماد المرفقات' }).click();
    await form.getByRole('button', { name: 'حفظ', exact: true }).click();
    await expect(form).toBeHidden();
    await openStory();
    await expect(review.getByRole('status')).toContainText('معاينة واعتماد يدوي');
    await expect(review.getByLabel('الوقت المتبقي للمعاينة')).toHaveCount(0);
    await review.getByRole('button', { name: 'معاينة الفيديو', exact: true }).click();
    await review.locator('video').evaluate(async (player: HTMLVideoElement) => { player.muted = true; await player.play(); });
    await review.getByRole('button', { name: 'اعتماد المادة', exact: true }).click();
    await expect(review.getByRole('status')).toContainText('اعتُمدت المادة يدويًا');
    const state = await (await page.request.get('/api/v1/data')).json();
    expect(state.collections.bulletinStories.find((row: { id: string }) => row.id === storyId)?.d)
      .toMatchObject({ rank: 1500, floated: true, status: 'DRAFT', mediaReview: { mediaId: alternative.id, decision: 'MANUAL' } });
  } finally {
    await editor?.close();
    await admin.close();
  }
});
