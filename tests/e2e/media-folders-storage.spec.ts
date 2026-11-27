import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('creates nested folders, selects media and moves them without changing the file', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  try {
    await page.goto('/media');
    const folders = page.getByRole('region', { name: 'مجلدات الوسائط' });
    const create = async (name: string) => {
      await folders.getByRole('button', { name: 'مجلد جديد', exact: true }).click();
      const form = page.getByRole('dialog', { name: 'مجلد وسائط جديد' });
      await form.getByLabel('اسم المجلد').fill(name);
      await form.getByRole('button').last().click();
      await expect(folders.getByRole('button', { name, exact: true })).toBeVisible();
    };
    await create('تغطيات مرئية');
    await folders.getByRole('button', { name: 'تغطيات مرئية', exact: true }).click();
    await create('ملفات الفجر');
    await folders.getByRole('button', { name: 'المكتبة', exact: true }).click();
    await folders.getByRole('button', { name: 'تحديد الملفات' }).click();
    const selection = page.getByRole('checkbox', { name: /^تحديد / }).first();
    const selectionName = await selection.getAttribute('aria-label');
    await selection.check();
    await folders.getByRole('button', { name: 'نقل المحدد' }).click();
    const move = page.getByRole('dialog', { name: 'نقل ملفات الوسائط' });
    await move.getByLabel('المجلد الوجهة').selectOption({ label: 'تغطيات مرئية / ملفات الفجر' });
    await move.getByRole('button', { name: 'تأكيد النقل' }).click();
    await expect(move).toHaveCount(0);
    await folders.getByRole('button', { name: 'تغطيات مرئية', exact: true }).click();
    await folders.getByRole('button', { name: 'ملفات الفجر', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: selectionName!, exact: true })).toBeVisible();
  } finally {
    await close();
  }
});

test('browses Dropbox folders and fills a library draft with the selected file', async ({ browser }) => {
  const { page, close, errors } = await signIn(browser, 'admin@akhbar.tv');
  const root = '/مدار';
  const folder = root + '/النشرات';
  const ref = folder + '/مادة.mp4';
  const file = { ref, path: ref, name: 'مادة.mp4', size: 514, supported: true };
  try {
    await page.route('**/api/v1/storage/status', route => route.fulfill({ json: { data: {
      dropbox: { enabled: false, connected: true, root }, gdrive: { enabled: false, connected: false },
      share: { enabled: false, mode: 'none', indexedFiles: 0 }, queue: { pending: 0, failed: 0, done: 0 }, isLocal: false,
    } } }));
    await page.route('**/api/v1/storage/dropbox/list?*', route => {
      const at = new URL(route.request().url()).searchParams.get('at');
      return route.fulfill({ json: { data: at === folder ? { at: folder, items: [file] } : { at: root,
        items: [{ ref: folder, name: 'النشرات', path: folder, size: 0, isFolder: true, supported: false }] } } });
    });
    await page.route('**/api/v1/storage/dropbox/search?*', route => route.fulfill({ json: { data: [file] } }));
    await page.route('**/api/v1/storage/dropbox/import', route => {
      expect(route.request().postDataJSON()).toEqual({ ref });
      return route.fulfill({ json: { data: { id: 'drop-test', url: '/api/v1/media/files/drop-test', sizeBytes: 514, originalName: 'مادة.mp4', mimeType: 'video/mp4' } } });
    });
    await page.goto('/media');
    await page.getByRole('button', { name: 'تصفّح Dropbox' }).click();
    const popup = page.getByRole('dialog', { name: 'تصفّح Dropbox' });
    await popup.getByRole('button', { name: 'النشرات', exact: true }).click();
    await expect(popup.getByText('مادة.mp4', { exact: true })).toBeVisible();
    await popup.getByRole('searchbox').fill('مادة');
    await popup.getByRole('searchbox').press('Enter');
    await expect(popup.getByRole('button', { name: 'العودة إلى المجلد الرئيسي' })).toBeVisible();
    await popup.getByRole('button', { name: 'إضافة', exact: true }).click();
    await expect(page.getByText(/أُضيف الملف من Dropbox.*مادة\.mp4/)).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await close();
  }
});
