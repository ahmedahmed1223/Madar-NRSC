import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('department permission drafts, full review, save, conflict and cancellation work', async ({ browser }) => {
  const session = await signIn(browser, 'admin@akhbar.tv');
  const { page } = session;
  const headers = { 'X-NRCS-Client': 'web' };
  try {
    await openNav(page, 'المستخدمون والصلاحيات');
    await page.getByRole('tab', { name: 'مساحة الصلاحيات', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'مساحة الصلاحيات' })).toBeVisible();
    await page.getByRole('button', { name: 'قسم', exact: true }).click();
    await page.locator('#permission-target').selectOption('newsroom');
    const original = (await (await page.request.get('/api/v1/admin/permissions')).json()).data;
    await page.getByRole('searchbox', { name: 'بحث في الصلاحيات' }).fill('news.publish');
    await page.getByRole('button', { name: /نشر فوري للبث الرقمي/ }).click();
    await page.getByRole('button', { name: 'منع', exact: true }).click();
    await expect(page.getByText('تغييرات غير محفوظة', { exact: true })).toBeVisible();
    // No write before explicit save.
    expect((await (await page.request.get('/api/v1/admin/permissions')).json()).data.version).toBe(original.version);
    await page.getByRole('searchbox', { name: 'بحث في الصلاحيات' }).fill('media.upload');
    await page.getByRole('button', { name: /رفع وإدراج وسائط جديدة/ }).click();
    await page.getByRole('button', { name: 'منح', exact: true }).click();
    await page.getByRole('button', { name: 'مراجعة ثم حفظ' }).click();
    const review = page.getByRole('region', { name: 'مراجعة التغييرات قبل الحفظ' });
    await expect(review.getByText('news.publish', { exact: true }).first()).toBeVisible();
    await expect(review.getByText('media.upload', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'تأكيد الحفظ' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'تم حفظ الصلاحيات بنجاح' })).toBeVisible();
    const saved = (await (await page.request.get('/api/v1/admin/permissions')).json()).data;
    expect(saved.departments.find((d: any) => d.id === 'newsroom').permissionOverrides).toEqual(expect.arrayContaining(['!news.publish', 'media.upload']));

    // Keep a local draft while a concurrent administrator changes policy.
    await page.getByRole('button', { name: 'منع', exact: true }).click();
    const concurrent = await page.request.put('/api/v1/admin/permissions', { headers, data: {
      version: saved.version, kind: 'department', id: 'newsroom', permissions: ['!news.publish', 'media.upload', 'news.create'],
    } });
    expect(concurrent.ok()).toBe(true);
    await page.getByRole('button', { name: 'مراجعة ثم حفظ' }).click();
    await page.getByRole('button', { name: 'تأكيد الحفظ' }).click();
    await expect(page.getByRole('alert')).toContainText('تعارض في نسخة الصلاحيات');
    await expect(page.getByText('تغييرات غير محفوظة', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'إلغاء', exact: true }).click();
    await page.getByRole('button', { name: 'إلغاء التغييرات', exact: true }).click();
    await expect(page.getByText('كل التغييرات محفوظة', { exact: true })).toBeVisible();
    // Restore only the isolated browser-test fixture's policy.
    const current = (await (await page.request.get('/api/v1/admin/permissions')).json()).data;
    await page.request.put('/api/v1/admin/permissions', { headers, data: {
      version: current.version, kind: 'department', id: 'newsroom',
      permissions: original.departments.find((d: any) => d.id === 'newsroom').permissionOverrides || [],
    } });
    await page.screenshot({ path: 'test-results/permissions-desktop.jpg' });
    expect(session.errors).toEqual([]);
  } finally { await page.context().close(); }
});

test('phone editor blocks administrative department grants and guards unsaved navigation', async ({ browser }) => {
  const session = await signIn(browser, 'admin@akhbar.tv', { viewport: { width: 402, height: 874 } });
  const { page } = session;
  try {
    await openNav(page, 'المستخدمون والصلاحيات');
    await page.getByRole('tab', { name: 'مساحة الصلاحيات', exact: true }).click();
    await page.getByRole('button', { name: 'قسم', exact: true }).click();
    await page.locator('#permission-target').selectOption('montage');
    await page.getByRole('searchbox', { name: 'بحث في الصلاحيات' }).fill('system.settings');
    await page.getByRole('button', { name: /تهيئة إعدادات المحطة|إعدادات النظام|system.settings/ }).filter({ hasText: 'system.settings' }).click();
    await expect(page.getByRole('button', { name: 'منح', exact: true })).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'بحث في الصلاحيات' }).fill('news.create');
    await page.getByRole('button', { name: /صياغة خبر أو تقرير جديد/ }).click();
    await page.getByRole('button', { name: 'منح', exact: true }).click();
    await openNav(page, 'الرئيسية');
    await expect(page.getByRole('heading', { name: 'تغييرات صلاحيات غير محفوظة' })).toBeVisible();
    await page.getByRole('button', { name: 'متابعة التحرير', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'مساحة الصلاحيات' })).toBeVisible();
    await page.getByRole('button', { name: 'إلغاء', exact: true }).click();
    await page.getByRole('button', { name: 'إلغاء التغييرات', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/permissions-phone.jpg', fullPage: true });
    expect(session.errors).toEqual([]);
  } finally { await page.context().close(); }
});

test('an individual grant visibly remains blocked by an inherited department denial', async ({ browser }) => {
  const session = await signIn(browser, 'admin@akhbar.tv');
  const { page } = session;
  const headers = { 'X-NRCS-Client': 'web' };
  let original: any;
  let target: any;
  try {
    original = (await (await page.request.get('/api/v1/admin/permissions')).json()).data;
    target = original.users.find((u: any) => u.role !== 'SUPER_ADMIN' && u.departmentId === 'newsroom');
    expect(target).toBeTruthy();
    const response = await page.request.put('/api/v1/admin/permissions', { headers, data: {
      version: original.version, kind: 'department', id: 'newsroom', permissions: ['!news.publish'],
    } });
    expect(response.ok()).toBe(true);
    await openNav(page, 'المستخدمون والصلاحيات');
    await page.getByRole('tab', { name: 'مساحة الصلاحيات', exact: true }).click();
    await page.getByRole('button', { name: 'مستخدم', exact: true }).click();
    await page.locator('#permission-target').selectOption(target.id);
    await page.getByRole('searchbox', { name: 'بحث في الصلاحيات' }).fill('news.publish');
    await page.getByRole('button', { name: /نشر فوري للبث الرقمي/ }).click();
    await page.getByRole('button', { name: 'منح', exact: true }).click();
    await expect(page.getByText('المنح المسجل لا يغيّر النتيجة الفعلية', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'مراجعة ثم حفظ' }).click();
    await page.getByRole('button', { name: 'تأكيد الحفظ' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'تم حفظ الصلاحيات بنجاح' })).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'مساحة الصلاحيات', exact: true }).click();
    await page.getByRole('button', { name: 'مستخدم', exact: true }).click();
    await page.locator('#permission-target').selectOption(target.id);
    await page.getByRole('searchbox', { name: 'بحث في الصلاحيات' }).fill('news.publish');
    await expect(page.getByText('منع من قسم غرفة التحرير', { exact: false }).first()).toBeVisible();
  } finally {
    if (original && target) {
      for (const change of [
        { kind: 'user', id: target.id, permissions: target.customPermissions || [] },
        { kind: 'department', id: 'newsroom', permissions: original.departments.find((d: any) => d.id === 'newsroom').permissionOverrides || [] },
      ]) {
        const current = (await (await page.request.get('/api/v1/admin/permissions')).json()).data;
        await page.request.put('/api/v1/admin/permissions', { headers, data: { version: current.version, ...change } });
      }
    }
    await page.context().close();
  }
});

test('custom role creation, permission editing, metadata updates and deletion remain available', async ({ browser }) => {
  const session = await signIn(browser, 'admin@akhbar.tv');
  const { page } = session;
  try {
    await openNav(page, 'المستخدمون والصلاحيات');
    await page.getByRole('tab', { name: 'مساحة الصلاحيات', exact: true }).click();
    await page.getByRole('button', { name: 'إضافة دور', exact: true }).click();
    await page.locator('#role-edit-modal-field-1').fill('دور اختبار الصلاحيات');
    await page.locator('#role-edit-modal-field-3').fill('PERMISSION_BROWSER_TEST');
    await page.getByRole('button', { name: 'حفظ إعدادات الدور' }).click();
    await expect(page.locator('#role-edit-modal-field-1')).toHaveCount(0);
    const snapshot = (await (await page.request.get('/api/v1/admin/permissions')).json()).data;
    const role = snapshot.roles.find((r: any) => r.roleCode === 'PERMISSION_BROWSER_TEST');
    expect(role).toBeTruthy();
    await page.locator('#permission-target').selectOption(role.id);
    await page.getByRole('searchbox', { name: 'بحث في الصلاحيات' }).fill('media.delete');
    await page.getByRole('button', { name: /حذف مواد من الأرشيف/ }).click();
    await page.getByRole('button', { name: 'نعم، يمنح', exact: true }).click();
    await page.getByRole('button', { name: 'مراجعة ثم حفظ' }).click();
    await page.getByRole('button', { name: 'تأكيد الحفظ' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'تم حفظ الصلاحيات بنجاح' })).toBeVisible();
    await page.getByRole('button', { name: 'تعديل بيانات الدور', exact: true }).click();
    await page.locator('#role-edit-modal-field-1').fill('دور اختبار محدّث');
    await page.getByRole('button', { name: 'حفظ إعدادات الدور' }).click();
    await expect(page.locator('#role-edit-modal-field-1')).toHaveCount(0);
    await expect(page.locator('#permission-target')).toHaveValue(role.id);
    await page.getByRole('button', { name: 'حذف الدور', exact: true }).click();
    await page.locator('[role="dialog"], [role="alertdialog"]').last().getByRole('button', { name: 'حذف الدور', exact: true }).click();
    await expect.poll(async () => {
      const next = (await (await page.request.get('/api/v1/admin/permissions')).json()).data;
      return next.roles.some((r: any) => r.id === role.id);
    }).toBe(false);
    expect(session.errors).toEqual([]);
  } finally { await page.context().close(); }
});
