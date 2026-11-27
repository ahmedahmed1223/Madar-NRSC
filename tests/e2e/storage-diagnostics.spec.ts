import { expect, test } from '@playwright/test';
import { openNav, openSettingsSection, signIn } from './helpers';

test('Dropbox approval opens directly and a rejected code can be corrected without re-entering the application keys', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const { page } = admin;
  try {
    const status = (await (await page.request.get('/api/v1/storage/status')).json()).data;
    await openNav(page, 'الإعدادات');
    await openSettingsSection(page, 'التخزين');
    const dropbox = page.getByRole('group', { name: 'Dropbox', exact: true });
    await dropbox.getByText('ربط Dropbox', { exact: true }).click();
    await dropbox.getByLabel('App key', { exact: true }).fill('samplekey');
    await dropbox.getByLabel('App secret', { exact: true }).fill('sample-secret');
    const consent = dropbox.getByRole('link', { name: 'افتح صفحة الموافقة في Dropbox' });
    const target = new URL((await consent.getAttribute('href'))!);
    expect(target.origin).toBe('https://www.dropbox.com');
    expect(target.searchParams.get('client_id')).toBe('samplekey');
    expect(target.searchParams.get('token_access_type')).toBe('offline');
    expect(target.href).not.toContain('sample-secret');
    await page.context().route('https://www.dropbox.com/oauth2/authorize?**', route => route.fulfill({ body: 'Mock Dropbox consent' }));
    const [popup] = await Promise.all([page.waitForEvent('popup'), consent.click()]);
    await popup.close();
    await page.route('**/api/v1/storage/dropbox/connect', route => {
      const payload = route.request().postDataJSON();
      return payload.code === 'accepted-code' || payload.refreshToken === 'direct-qa-token'
        ? route.fulfill({ json: { success: true, data: { ...status, dropbox: { ...status.dropbox, connected: true, account: 'QA Dropbox' } } } })
        : route.fulfill({ status: 400, json: { error: 'اطلب رمز جديد من Dropbox.' } });
    });
    const code = dropbox.getByLabel('رمز التفويض من Dropbox');
    await code.fill('expired-code');
    await code.press('Enter');
    await expect(dropbox.getByRole('alert')).toHaveText('اطلب رمز جديد من Dropbox.');
    await expect(dropbox.getByLabel('App secret', { exact: true })).toHaveValue('sample-secret');
    await code.fill('accepted-code');
    await dropbox.getByRole('button', { name: 'ربط', exact: true }).click();
    await expect(dropbox.getByText(/الربط محفوظ والنسخ متوقف/)).toBeVisible();
    await dropbox.getByText('تجديد تفويض Dropbox', { exact: true }).click();
    await expect(dropbox.getByLabel('App secret', { exact: true })).toBeEmpty();
    await dropbox.getByRole('radio', { name: 'لديّ Refresh token' }).check();
    await expect(consent).toHaveCount(0);
    await dropbox.getByLabel('App key', { exact: true }).fill('samplekey');
    await dropbox.getByLabel('App secret', { exact: true }).fill('sample-secret');
    const token = dropbox.getByLabel('Refresh token', { exact: true });
    await expect(token).toHaveAttribute('type', 'password');
    await token.fill('direct-qa-token');
    const submitted = page.waitForRequest(req => req.url().endsWith('/storage/dropbox/connect'));
    await dropbox.getByRole('button', { name: 'ربط', exact: true }).click();
    expect((await submitted).postDataJSON()).toEqual({ appKey: 'samplekey', appSecret: 'sample-secret', refreshToken: 'direct-qa-token' });
    await expect(token).toBeHidden();
    await dropbox.getByText('تجديد تفويض Dropbox', { exact: true }).click();
    await expect(token).toBeEmpty();
  } finally {
    await admin.close();
  }
});

test('administrator checks Dropbox and restores a media upload from trash', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const { page } = admin;
  const title = `مادة اختبار التخزين ${Date.now()}`;
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMioAAAAASUVORK5CYII=', 'base64');

  try {
    await openNav(page, 'الإعدادات');
    await openSettingsSection(page, 'التخزين');
    const dropbox = page.getByRole('group', { name: 'Dropbox', exact: true });
    await dropbox.getByRole('button', { name: 'فحص الاتصال والمجلد' }).click();
    await expect(dropbox.getByText('بيانات الربط غير محفوظة أو غير مكتملة')).toBeVisible();
    await dropbox.getByRole('button', { name: 'فحص أذونات القراءة والكتابة' }).click();
    await expect(dropbox.getByText('تجديد تفويض فحص الأذونات')).toBeVisible();

    await openNav(page, 'مكتبة الوسائط');
    await page.getByRole('button', { name: 'رفع مادة وسائط جديدة' }).click();
    await page.locator('#media-file-input').setInputFiles({
      name: 'storage-test.png', mimeType: 'image/png',
      buffer: image,
    });
    await expect(page.getByText('تم رفع الملف', { exact: false })).toBeVisible();
    await page.getByLabel('عنوان المادة أو الملف').fill(title);
    await page.getByRole('button', { name: 'تسجيل في الأرشيف' }).click();
    await page.getByRole('button', { name: `معاينة المادة: ${title}`, exact: true }).click();
    const preview = page.getByRole('dialog', { name: `معاينة المادة: ${title}` });
    await expect(preview.getByText('أماكن حفظ الملف', { exact: true })).toBeVisible();
    await expect(preview.getByText('الخادم · نسخة متاحة', { exact: true })).toBeVisible();
    const fileUrl = await preview.getByRole('img', { name: title }).getAttribute('src');
    if (!fileUrl) throw new Error('Media preview did not expose a file URL');
    await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);

    await page.getByRole('button', { name: `نقل إلى سلة المحذوفات: ${title}` }).click();
    await page.getByRole('button', { name: 'تأكيد', exact: true }).click();
    await expect(page.getByRole('button', { name: `معاينة المادة: ${title}` })).toHaveCount(0);
    await expect.poll(async () => (await page.request.get(fileUrl)).status()).toBe(404);

    await openNav(page, 'سلة المحذوفات');
    const trash = page.getByRole('region', { name: 'سلة المحذوفات' });
    await trash.getByRole('combobox', { name: 'القسم' }).selectOption('media');
    await trash.getByRole('button', { name: `استعادة ${title}` }).click();
    await expect(trash.getByRole('status')).toContainText(title);
    const restored = await page.request.get(fileUrl);
    expect(restored.ok()).toBe(true);
    expect(await restored.body()).toEqual(image);
    await openNav(page, 'مكتبة الوسائط');
    await expect(page.getByRole('button', { name: `معاينة المادة: ${title}` })).toBeVisible();
    expect(admin.errors).toEqual([]);
  } finally {
    await admin.close();
  }
});

test('administrator configures the per-user limit and expiry of contributor links', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const { page } = admin;
  const settings = async () => (await (await page.request.get('/api/v1/data')).json()).collections.settings[0];
  const before = await settings();
  const headers = { 'X-NRCS-Client': 'web' };
  const issue = () => page.request.post('/api/v1/external-intake/links', { headers, data: { kind: 'upload' } });

  try {
    await openNav(page, 'الإعدادات');
    await openSettingsSection(page, 'التخزين');
    const form = page.getByRole('form', { name: 'روابط رفع المتعاونين' });
    const limit = form.getByRole('spinbutton', { name: 'عدد الروابط لكل مستخدم خلال 24 ساعة' });
    const expiry = form.getByRole('spinbutton', { name: 'صلاحية الرابط بالساعات' });
    await expect(limit).toHaveValue('10');
    await expect(expiry).toHaveValue('24');
    await limit.fill('1');
    await expiry.fill('2');
    await form.getByRole('button', { name: 'حفظ إعدادات الروابط' }).click();
    await expect(form.getByRole('status')).toHaveText('حُفظت إعدادات روابط الرفع.');
    await page.reload();
    await expect(limit).toHaveValue('1');
    await expect(expiry).toHaveValue('2');

    const start = Date.now();
    const created = await issue();
    expect(created.ok()).toBe(true);
    const { data } = await created.json();
    expect(data.path).toMatch(/^\/intake#[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(data.expiresAt) - start).toBeGreaterThanOrEqual(2 * 3_600_000);
    expect(Date.parse(data.expiresAt) - Date.now()).toBeLessThanOrEqual(2 * 3_600_000);
    expect((await issue()).status()).toBe(429);
    expect(admin.errors).toEqual([]);
  } finally {
    try {
      const latest = await settings();
      if (latest.v !== before.v) {
        const response = await page.request.post('/api/v1/data/sync', { headers, data: {
          ops: [{ c: 'settings', id: latest.id, baseV: latest.v, op: 'upsert', d: {
            ...latest.d, contributorDropLinkDailyLimit: before.d.contributorDropLinkDailyLimit,
            contributorDropLinkExpiryHours: before.d.contributorDropLinkExpiryHours,
          } }],
        } });
        expect((await response.json()).results[0].ok).toBe(true);
      }
    } finally {
      await admin.close();
    }
  }
});
