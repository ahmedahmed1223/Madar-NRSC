import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

const journeys = [
  { role: 'SUPER_ADMIN', email: 'admin@akhbar.tv', screens: ['المستخدمون والصلاحيات', 'الإعدادات', 'سجل التدقيق'] },
  { role: 'ADMIN', email: 'director@akhbar.tv', screens: ['وضع الهواء', 'التقارير', 'المناوبات'] },
  { role: 'EDITOR', email: 'editor@akhbar.tv', screens: ['الأخبار', 'النشرات', 'المهام'] },
  { role: 'JOURNALIST', email: 'journalist@akhbar.tv', screens: ['الأخبار', 'المهام', 'حجز الموارد'] },
  { role: 'PRODUCER', email: 'producer@akhbar.tv', screens: ['البرامج', 'الحلقات', 'الضيوف'] },
  { role: 'PRESENTER', email: 'presenter@akhbar.tv', screens: ['الحلقات', 'وضع الهواء', 'شاشة الاستديو'] },
  { role: 'REPORTER', email: 'reporter@akhbar.tv', screens: ['أجندة التغطية', 'الأخبار', 'المهام'] },
  { role: 'MEDIA', email: 'media@akhbar.tv', screens: ['طلبات الأقسام', 'مكتبة الوسائط', 'المهام'] },
  { role: 'CREW', email: 'crew@akhbar.tv', screens: ['طلبات الأقسام', 'المناوبات', 'شاشة الاستديو'] },
  { role: 'VIEWER', email: 'trainee@akhbar.tv', screens: ['الأخبار', 'الحلقات', 'مكتبة الوسائط'] },
];

for (const journey of journeys) {
  test(`${journey.role}: signs in and follows the core read-only journey`, async ({ browser }) => {
    const { page, errors, close } = await signIn(browser, journey.email);
    for (const screen of journey.screens) {
      await openNav(page, screen);
      await expect(page.locator('main h1').first()).toBeVisible();
      await expect(page.locator('main')).not.toContainText('حدث خطأ غير متوقع');
    }
    if (journey.role === 'VIEWER') {
      await openNav(page, 'الأخبار');
      await expect(page.getByRole('button', { name: 'إنشاء خبر جديد' })).toHaveCount(0);
      await expect(page.locator('button[title="تحرير الخبر"]')).toHaveCount(0);
    }
    if (!['SUPER_ADMIN', 'ADMIN', 'EDITOR'].includes(journey.role)) {
      await expect(page.locator('aside nav button', { hasText: 'المستخدمون والصلاحيات' })).toHaveCount(0);
      await expect(page.locator('aside nav button', { hasText: 'الإعدادات' })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
    await close();
  });
}
