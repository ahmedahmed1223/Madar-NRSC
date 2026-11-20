import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('a mobile reporter can retry a file and pass the same report through a shift handover', async ({ browser }) => {
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
    let storyId = '';
    await expect.poll(async () => {
      const { collections } = await (await page.request.get('/api/v1/data')).json();
      const matches = collections.news.filter((row: any) => row.d.title === title);
      storyId = matches[0]?.id ?? '';
      return { count: matches.length, status: matches[0]?.d.status, attachments: matches[0]?.d.mediaIds?.length };
    }).toEqual({ count: 1, status: 'UNDER_REVIEW', attachments: 1 });
    const editor = await signIn(browser, 'editor@akhbar.tv');
    try {
      const { collections } = await (await editor.page.request.get('/api/v1/data')).json();
      expect(collections.news.find((row: any) => row.id === storyId)?.d).toMatchObject({
        title, status: 'UNDER_REVIEW',
      });
      await editor.page.goto(`/news/${storyId}`);
      await expect(editor.page.getByRole('link', { name: 'field', exact: true })).toBeVisible();
      const incoming = await signIn(browser, 'admin@akhbar.tv');
      try {
        const date = '2026-10-12';
        const { user } = await (await incoming.page.request.get('/api/v1/auth/me')).json();
        const rosterId = `${date}:newsroom:EVENING:${user.id}`;
        const roster = await incoming.page.request.post('/api/v1/data/sync', {
          headers: { 'X-NRCS-Client': 'web' },
          data: { ops: [{ c: 'roster', op: 'upsert', id: rosterId, d: {
            id: rosterId, date, departmentId: 'newsroom', shift: 'EVENING', userId: user.id, userName: user.fullName,
          } }] },
        });
        expect((await roster.json()).results[0].ok).toBe(true);
        await editor.page.goto('/roster?tab=handover');
        await editor.page.getByRole('button', { name: 'إنشاء تسليم' }).click();
        const handoverTitle = `تسليم للمراجعة — ${title}`;
        await editor.page.getByLabel('عنوان التسليم').fill(handoverTitle);
        await editor.page.getByLabel('تاريخ الوردية الصادرة').fill(date);
        await editor.page.getByLabel('تاريخ الوردية المستلمة').fill(date);
        await editor.page.getByLabel('الوردية المستلمة', { exact: true }).selectOption('EVENING');
        await editor.page.getByLabel('ملاحظات القسم').fill('راجع النص والمرفق قبل اختيار الفقرة للنشرة');
        await editor.page.getByLabel('اختيار مرجع').selectOption(`news:${storyId}`);
        await editor.page.getByRole('button', { name: 'إضافة المرجع' }).click();
        await editor.page.getByRole('button', { name: 'حفظ المسودة', exact: true }).click();
        await expect(editor.page.getByRole('status').filter({ hasText: 'حُفظت المسودة' })).toBeVisible();
        await editor.page.getByRole('button', { name: 'نشر التسليم', exact: true }).click();
        await editor.page.getByRole('alertdialog').getByRole('button', { name: 'نشر التسليم', exact: true }).click();
        await expect(editor.page.getByRole('status').filter({ hasText: 'نُشر التسليم' })).toBeVisible();
        await incoming.page.goto('/roster?tab=handover');
        await incoming.page.getByRole('button', { name: handoverTitle, exact: true }).click();
        await incoming.page.getByRole('button', { name: 'تأكيد الاستلام', exact: true }).click();
        await expect(incoming.page.getByRole('status').filter({ hasText: 'تأكد استلام الوردية' })).toBeVisible();
        await incoming.page.getByRole('button', { name: title, exact: true }).click();
        await expect(incoming.page).toHaveURL(new RegExp(`/news/${storyId}$`));
        await expect(incoming.page.getByRole('link', { name: 'field', exact: true })).toBeVisible();
      } finally {
        await incoming.close();
      }
    } finally {
      await editor.close();
    }
  } finally {
    rejectFirst();
    await close();
  }
});
