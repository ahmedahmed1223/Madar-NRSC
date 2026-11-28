import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('the release history explains the Madar 5 changes by area', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  try {
    await page.goto('/whats-new');
    const release = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'مدار 5 لغرفة الأخبار وإدارة البيانات' }) });
    await expect(release).toContainText('v5.0.1');
    await expect(release.getByRole('heading', { level: 3 })).toHaveText([
      'التحرير والإنتاج والتكليفات',
      'محذوفات الأقسام',
      'تخزين الوسائط باستخدام Dropbox',
      'النسخ الاحتياطية وتجربة الاستعادة',
      'مساحة الصلاحيات',
      'المزامنة ورفع الملفات',
    ]);
    await expect(release.getByText(/بصمات ملفات الوسائط/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'التخزين الأساسي وتنظيم التكليفات والنشرات' })).toBeVisible();
  } finally {
    await close();
  }
});
