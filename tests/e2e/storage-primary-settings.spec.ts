import { expect, test } from '@playwright/test';
import { openSettingsSection, signIn } from './helpers';

for (const { device, width, height } of [{ device: 'desktop', width: 1440, height: 900 }, { device: 'phone', width: 390, height: 844 }]) {
  test('independent storage destinations and visible action results on ' + device, async ({ browser }) => {
    const admin = await signIn(browser, 'admin@akhbar.tv', { viewport: { width, height } });
    const { page } = admin;
    const mediaTarget = device === 'desktop' ? 'dropbox' : 'nas';
    const backupTarget = device === 'desktop' ? 'nas' : 'gdrive';
    try {
      page.setDefaultTimeout(10_000);
      const status = (await (await page.request.get('/api/v1/storage/status')).json()).data;
      await page.route('**/api/v1/storage/status', route => route.fulfill({ json: {
        success: true, data: { ...status, dropbox: { ...status.dropbox, connected: true }, share: { ...status.share, mode: 'direct' } },
      } }));
      await page.route('**/api/v1/db/backup-status', route => route.fulfill({ json: {
        success: true, data: { primaryTarget: 'local', primaryConfigured: true, primaryDestinations: { dropbox: false, gdrive: true, nas: true } },
      } }));
      await page.route('**/api/v1/storage/dropbox/verify', route => route.fulfill({ json: {
        success: true, data: { credentials: 'verified', read: 'verified', write: 'missing_scope' },
      } }));
      await page.goto('/settings');
      await openSettingsSection(page, 'التخزين');
      await page.getByRole('combobox', { name: 'التخزين الأساسي للوسائط', exact: true }).selectOption(mediaTarget);
      await page.getByRole('combobox', { name: 'التخزين الأساسي للنسخ الاحتياطية', exact: true }).selectOption(backupTarget);
      await page.getByRole('button', { name: 'حفظ إعدادات التخزين' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'حُفظت إعدادات التخزين.' })).toBeVisible();
      const settings = (await (await page.request.get('/api/v1/data')).json()).collections.settings[0].d;
      expect(settings.storage).toMatchObject({ primaryMedia: mediaTarget, primaryBackups: backupTarget });
      await page.getByRole('button', { name: 'فحص أذونات القراءة والكتابة' }).click();
      const toast = page.getByRole('alert').filter({ hasText: 'الإذن غير ممنوح' });
      await expect(toast).toBeVisible();
      const viewport = page.viewportSize();
      const box = await toast.boundingBox();
      expect(box?.y).toBeGreaterThanOrEqual(0);
      expect(box && viewport && box.y + box.height <= viewport.height).toBe(true);
    } finally {
      await admin.close();
    }
  });
}
