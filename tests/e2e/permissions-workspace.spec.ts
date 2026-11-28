import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('the system administrator can change their own station while role and department are locked', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  try {
    const { user } = await (await page.request.get('/api/v1/auth/me')).json();
    const station = user.stationId === 'beirut' ? 'istanbul' : 'beirut';
    await openNav(page, 'المستخدمون والصلاحيات');
    await page.getByRole('button', { name: `تعديل ${user.fullName}`, exact: true }).click();
    const form = page.getByRole('region', { name: `تعديل حساب ${user.fullName}` });
    await expect(form.locator('#user-form-modal-field-7')).toBeDisabled();
    await expect(form.getByLabel('القسم', { exact: true })).toBeDisabled();
    await form.getByLabel('المحطة', { exact: true }).selectOption(station);
    await form.getByRole('button', { name: /حفظ/ }).click();
    await expect(form).toHaveCount(0);
    await expect.poll(async () => (await (await page.request.get('/api/v1/auth/me')).json()).user.stationId).toBe(station);
  } finally { await close(); }
});

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


test('a background permissions refresh preserves a new draft and its original version', async ({ browser }) => {
  const { page } = await signIn(browser, 'admin@akhbar.tv');
  const endpoint = '/api/v1/admin/permissions';
  const pattern = '**' + endpoint;
  const headers = { 'X-NRCS-Client': 'web' };
  let releaseResponse!: () => void;
  const heldResponse = new Promise<void>(resolve => { releaseResponse = resolve; });
  let buffered = false;
  let originalPermissions: string[] | undefined;
  let externalChange = false;

  try {
    await openNav(page, 'المستخدمون والصلاحيات');
    await page.getByRole('tab', { name: 'مساحة الصلاحيات', exact: true }).click();
    await page.getByRole('button', { name: 'قسم', exact: true }).click();
    await page.locator('#permission-target').selectOption('newsroom');
    await page.getByRole('searchbox', { name: 'بحث في الصلاحيات' }).fill('news.publish');
    await page.getByRole('button', { name: /نشر فوري للبث الرقمي/ }).click();
    const deny = page.getByRole('button', { name: 'منع', exact: true });
    await expect(deny).toHaveAttribute('aria-pressed', 'false');

    const original = (await (await page.request.get(endpoint)).json()).data;
    const department = original.departments.find((item: { id: string }) => item.id === 'newsroom');
    originalPermissions = department.permissionOverrides ?? [];
    const externalPermissions = [
      ...originalPermissions!.filter(code => code !== 'media.upload' && code !== '!media.upload'),
      originalPermissions!.includes('media.upload') ? '!media.upload' : 'media.upload',
    ];

    await page.route(pattern, async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      buffered = true;
      await heldResponse;
      await route.fulfill({ response });
    });
    const external = await page.request.put(endpoint, { headers, data: {
      version: original.version, kind: 'department', id: 'newsroom', permissions: externalPermissions,
    } });
    externalChange = external.ok();
    expect(externalChange).toBe(true);
    await expect.poll(() => buffered).toBe(true);

    await deny.click();
    await expect(deny).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('تغييرات غير محفوظة', { exact: true })).toBeVisible();

    const refreshArrived = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'GET');
    releaseResponse();
    await refreshArrived;

    const review = page.getByRole('button', { name: 'مراجعة ثم حفظ' });
    await expect(review).toBeEnabled();
    await review.click();
    const submitted = page.waitForRequest(request => request.url().endsWith(endpoint) && request.method() === 'PUT');
    await page.getByRole('button', { name: 'تأكيد الحفظ' }).click();
    expect((await submitted).postDataJSON()).toMatchObject({
      version: original.version, permissions: expect.arrayContaining(['!news.publish']),
    });
    await expect(page.getByRole('alert')).toContainText('تعارض في نسخة الصلاحيات');
  } finally {
    releaseResponse();
    try {
      if (externalChange) {
        const current = (await (await page.request.get(endpoint)).json()).data;
        await page.request.put(endpoint, { headers, data: {
          version: current.version, kind: 'department', id: 'newsroom', permissions: originalPermissions,
        } });
      }
    } finally {
      await page.context().close();
    }
  }
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
