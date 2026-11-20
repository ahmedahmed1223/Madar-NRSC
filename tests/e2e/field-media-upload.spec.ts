import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('a mobile reporter can retry a file and send the same field report with the confirmed attachment', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'reporter@akhbar.tv', { viewport: { width: 390, height: 844 } });
  let rejectFirst!: () => void;
  const firstUpload = new Promise<void>(resolve => { rejectFirst = resolve; });
  let attempts = 0;
  const title = `خبر ميداني ${Date.now()}`;
  const text = 'نص ميداني تجريبي محفوظ أثناء إعادة الرفع';
  const reportLine = page.getByRole('textbox', { name: 'سطر واحد', exact: true });
  try {
    await page.route('**/api/v1/media/upload', async route => {
      if (++attempts === 1) {
        await firstUpload;
        await route.fulfill({ status: 503, json: { error: 'تعذر رفع الملف مؤقتاً' } });
      } else await route.continue();
    });
    await page.goto('/news/new?breaking=1');
    await expect(page.getByRole('heading', { name: 'خبر عاجل', exact: true })).toBeVisible();
    await page.getByLabel('العنوان', { exact: true }).fill(title);
    await reportLine.fill(text);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'رفع من الجهاز' }).click();
    await (await chooser).setFiles({
      name: 'field.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMioAAAAASUVORK5CYII=', 'base64'),
    });
    const picker = page.getByRole('dialog', { name: 'إرفاق من مكتبة الوسائط' });
    await expect(picker.getByRole('progressbar', { name: 'رفع field.png' })).toBeVisible();
    await expect(picker.getByRole('button', { name: 'اعتماد المرفقات' })).toBeDisabled();
    await picker.getByRole('searchbox').press('Enter');
    await expect(picker).toBeVisible();
    rejectFirst();
    await expect(picker.getByText('تعذر رفع الملف مؤقتاً')).toBeVisible();
    await picker.getByRole('button', { name: 'إعادة المحاولة: field.png' }).click();
    await expect(picker.getByRole('status').filter({ hasText: 'المرفقات المؤكدة' })).toHaveText('المرفقات المؤكدة: 1 من 1');
    await picker.getByRole('button', { name: 'اعتماد المرفقات' }).click();
    await expect(page.getByLabel('العنوان', { exact: true })).toHaveValue(title);
    await expect(reportLine).toHaveValue(text);
    await expect(page.getByRole('link', { name: 'field', exact: true })).toBeVisible();
    expect(attempts).toBe(2);
    await page.getByRole('button', { name: 'إرسال العاجل للمراجعة' }).click();
    await expect.poll(async () => {
      const { collections } = await (await page.request.get('/api/v1/data')).json();
      const item = collections.news.find((row: any) => row.d.title === title)?.d;
      return { status: item?.status, attachments: item?.mediaIds?.length };
    }).toEqual({ status: 'UNDER_REVIEW', attachments: 1 });
  } finally {
    rejectFirst();
    await close();
  }
});
