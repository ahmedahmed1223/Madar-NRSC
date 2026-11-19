import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'fs';
import { openNav, signIn } from './helpers';

/**
 * Version 4 beyond production cards: messaging between colleagues, roles that open only the
 * screens of their job, notifications that announce themselves, and the administrator's monitor.
 */
const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const H = { 'X-NRCS-Client': 'web' };

async function violations(page: Page) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const result = await (window as any).axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] });
    return result.violations.map((v: any) => `${v.id}: ${v.nodes.map((n: any) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  });
}
const overflows = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

test.describe.configure({ mode: 'serial' });

test('colleagues write to each other, attach a file and point at a story; nobody else reads it', async ({ browser }) => {
  const editor = await signIn(browser, 'editor@akhbar.tv');
  await openNav(editor.page, 'المراسلات');
  await editor.page.getByRole('button', { name: 'رسالة جديدة' }).click();
  await editor.page.getByRole('searchbox', { name: 'بحث عن زميل' }).fill('طارق');
  await editor.page.getByRole('button', { name: /طارق الهاشمي/ }).click();
  await expect(editor.page).toHaveURL(/\/messages\/dm/);
  const thread = editor.page.getByRole('region', { name: /محادثة طارق الهاشمي/ });
  await expect(thread.getByText('لا رسائل بعد')).toBeVisible();

  // A reference to a story and a document go with the message.
  await thread.getByRole('button', { name: 'إشارة إلى خبر أو مادة' }).click();
  const picker = editor.page.getByRole('region', { name: 'إشارة إلى مادة' });
  await picker.getByRole('searchbox').fill('القمة');
  await expect(picker.getByRole('listitem').first()).toContainText('القمة');
  await picker.getByRole('listitem').first().getByRole('button').click();
  await expect(picker).toHaveCount(0);
  await expect(thread.getByRole('button', { name: 'إزالة الإشارة' })).toBeVisible();
  await editor.page.locator('input[type=file]').setInputFiles({ name: 'ملاحظات التحرير.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await expect(thread.getByText('جاهز')).toBeVisible();
  await thread.getByLabel('نص الرسالة').fill('راجع هذا الخبر قبل النشرة من فضلك');
  await thread.getByLabel('نص الرسالة').press('Enter');
  const log = thread.getByRole('log');
  await expect(log.getByText('راجع هذا الخبر قبل النشرة من فضلك')).toBeVisible();
  await expect(log.getByRole('link', { name: /ملاحظات التحرير\.pdf/ })).toBeVisible();
  await expect(thread.getByLabel('نص الرسالة')).toHaveValue('');
  expect(editor.errors).toEqual([]);

  // The journalist is told while working elsewhere, opens it from the toast and follows the reference.
  const journalist = await signIn(browser, 'journalist@akhbar.tv');
  await expect(journalist.page.getByRole('button', { name: /^المراسلات/ })).toContainText('1');
  await thread.getByLabel('نص الرسالة').fill('والأمر عاجل');
  await thread.getByLabel(/رسالة عاجلة/).check();
  await thread.getByLabel('نص الرسالة').press('Enter');
  const toast = journalist.page.getByRole('status').filter({ hasText: 'والأمر عاجل' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'فتح' }).click();
  await expect(journalist.page).toHaveURL(/\/messages\/dm/);
  const theirs = journalist.page.getByRole('region', { name: /محادثة سارة عبد العزيز/ }).getByRole('log');
  await expect(theirs.getByText('والأمر عاجل')).toBeVisible();
  // Reading the conversation clears its badge and its notifications.
  await expect(journalist.page.getByRole('button', { name: /^المراسلات/ })).not.toContainText(/\d/);
  await expect.poll(async () => (await (await journalist.page.request.get('/api/v1/data')).json()).collections.notifications.filter((r: any) => !r.d.isRead && String(r.d.linkUrl).startsWith('/messages/')).length).toBe(0);
  const file = await journalist.page.request.get(await theirs.getByRole('link', { name: /ملاحظات التحرير\.pdf/ }).getAttribute('href') as string);
  expect(file.status()).toBe(200);
  await theirs.getByRole('button', { name: /القمة/ }).click();
  await expect(journalist.page).toHaveURL(/\/news\//);
  expect(journalist.errors).toEqual([]);
  await journalist.close();

  // A third colleague sees neither the conversation nor the file.
  const reporter = await signIn(browser, 'reporter@akhbar.tv', { viewport: { width: 390, height: 844 } });
  await reporter.page.goto('/messages');
  await expect(reporter.page.getByText('لا محادثات بعد')).toBeVisible();
  const data = await (await reporter.page.request.get('/api/v1/data')).json();
  expect(data.collections.messages.filter((r: any) => String(r.d.channel).startsWith('dm:'))).toEqual([]);
  const href = await log.getByRole('link', { name: /ملاحظات التحرير\.pdf/ }).getAttribute('href');
  expect((await reporter.page.request.get(href as string)).status()).toBe(404);
  expect(await overflows(reporter.page)).toBe(false);
  await reporter.close();
  await editor.close();
});

test('a group and the open channels work from a phone, by day and by night', async ({ browser }) => {
  const editor = await signIn(browser, 'editor@akhbar.tv');
  await openNav(editor.page, 'المراسلات');
  await editor.page.getByRole('button', { name: 'مجموعة جديدة' }).click();
  await editor.page.getByLabel('اسم المجموعة *').fill('تغطية غزة — فريق المساء');
  await editor.page.getByRole('searchbox', { name: 'بحث عن زميل' }).fill('ليلى');
  await editor.page.getByRole('checkbox', { name: /ليلى النجار/ }).check();
  await editor.page.getByRole('button', { name: 'إنشاء المجموعة' }).click();
  const group = editor.page.getByRole('region', { name: /محادثة تغطية غزة/ });
  await group.getByLabel('نص الرسالة').fill('المادة الخام على القرص المشترك');
  await group.getByLabel('نص الرسالة').press('Enter');
  await expect(group.getByRole('log').getByText('المادة الخام على القرص المشترك')).toBeVisible();
  await editor.close();

  for (const colorScheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme, bypassCSP: true });
    const page = await context.newPage();
    await page.goto('/');
    await page.fill('#login-email', 'reporter@akhbar.tv');
    await page.fill('#login-password', 'Madar@Demo2026');
    await page.click('button[type=submit]');
    await expect(page.locator('main')).toBeVisible();
    await page.goto('/messages');
    await expect(page.getByRole('button', { name: /تغطية غزة/ })).toBeVisible();
    expect(await overflows(page)).toBe(false);
    expect(await violations(page)).toEqual([]);
    await page.getByRole('button', { name: /تغطية غزة/ }).click();
    const thread = page.getByRole('region', { name: /محادثة تغطية غزة/ });
    await expect(thread.getByRole('log').getByText('المادة الخام على القرص المشترك')).toBeVisible();
    await expect(thread.getByLabel('نص الرسالة')).toBeInViewport();
    expect(await overflows(page)).toBe(false);
    expect(await violations(page)).toEqual([]);
    if (colorScheme === 'light') {
      await thread.getByLabel('نص الرسالة').fill('وصلت، أبدأ الرفع');
      await thread.getByRole('button', { name: 'إرسال' }).click();
      await expect(thread.getByRole('log').getByText('وصلت، أبدأ الرفع')).toBeVisible();
      await thread.getByRole('button', { name: 'العودة إلى المحادثات' }).click();
      await expect(page).toHaveURL(/\/messages$/);
      // The notification centre fits the phone and its rows are real buttons.
      await page.getByRole('button', { name: /^الإشعارات/ }).click();
      const row = page.getByRole('button', { name: /تغطية غزة — فريق المساء: / });
      await expect(row).toBeVisible();
      const box = (await row.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
    await context.close();
  }
});

test('a role opens only the screens of its job', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  // The media colleague becomes a montage editor; the role comes with its own screens.
  const users = (await (await admin.page.request.get('/api/v1/data')).json()).collections.users;
  const media = users.find((u: any) => u.id === 'usr-7');
  const res = await (await admin.page.request.post('/api/v1/data/sync', { headers: H, data: { ops: [{ c: 'users', op: 'upsert', id: 'usr-7', d: { ...media.d, role: 'MONTAGE' }, baseV: media.v }] } })).json();
  expect(res.results[0].ok).toBe(true);

  // The administrator narrows the role further in the role editor.
  await admin.page.goto('/users');
  await admin.page.getByRole('tab', { name: /الأدوار/ }).or(admin.page.getByRole('button', { name: /الأدوار والصلاحيات|الأدوار/ })).first().click();
  await admin.page.getByText('موظف مونتاج').first().scrollIntoViewIfNeeded();
  const roles = (await (await admin.page.request.get('/api/v1/data')).json()).collections.roles;
  const montage = roles.find((r: any) => r.d.roleCode === 'MONTAGE');
  expect(montage.d.screens).toContain('media');
  expect(montage.d.screens).not.toContain('guests');
  expect(admin.errors).toEqual([]);
  await admin.close();

  const editorRole = await signIn(browser, 'media@akhbar.tv');
  const nav = editorRole.page.locator('aside nav');
  await expect(nav.getByRole('button', { name: /مكتبة الوسائط/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: /طلبات الأقسام/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: /التكليفات/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: /الضيوف/ })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: /المصادر/ })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: /المستخدمون/ })).toHaveCount(0);
  // The address bar does not get around it, and the search does not offer it.
  await editorRole.page.goto('/guests');
  await expect(editorRole.page.getByRole('heading', { name: 'هذه الصفحة ليست ضمن صفحات دورك' })).toBeVisible();
  await editorRole.page.getByRole('button', { name: 'العودة إلى الرئيسية' }).click();
  await expect(editorRole.page).toHaveURL(/\/$/);
  await editorRole.page.keyboard.press('Control+k');
  const dialog = editorRole.page.getByRole('dialog', { name: 'البحث الموحد' });
  await dialog.getByRole('combobox', { name: /بحث في الأخبار/ }).fill('الضيوف');
  await expect(dialog.getByRole('listbox').getByRole('option', { name: /^الضيوف/ })).toHaveCount(0);
  await editorRole.page.keyboard.press('Escape');
  expect(editorRole.errors).toEqual([]);
  await editorRole.close();
});

test('the administrator follows the system and ends a colleague\'s sessions', async ({ browser }) => {
  const reporter = await signIn(browser, 'reporter@akhbar.tv');
  const admin = await signIn(browser, 'admin@akhbar.tv');
  await admin.page.goto('/settings');
  await admin.page.getByText('مراقبة النظام').first().click();
  const monitor = admin.page.getByRole('region', { name: 'مراقبة النظام' });
  await expect(monitor.getByText('النسخ الاحتياطي الدوري معطل')).toBeVisible();
  await expect(monitor.getByText('قاعدة البيانات', { exact: true })).toBeVisible();
  const sessions = monitor.getByRole('region', { name: /جدول الجلسات النشطة/ });
  const row = sessions.getByRole('row', { name: /ليلى النجار/ });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'إنهاء الجلسات' }).click();
  await admin.page.getByRole('alertdialog').or(admin.page.getByRole('dialog')).getByRole('button', { name: 'إنهاء الجلسات' }).click();
  await expect(monitor.getByText('أُنهيت جلسات ليلى النجار')).toBeVisible();
  await expect(sessions.getByRole('row', { name: /ليلى النجار/ })).toHaveCount(0);
  expect((await reporter.page.request.get('/api/v1/auth/me')).status()).toBe(401);
  expect(admin.errors).toEqual([]);
  await admin.close();
  await reporter.page.context().close();
});

test('each colleague chooses the text size of their device', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'admin@akhbar.tv');
  const rootSize = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).toContain('IBM Plex Sans Arabic');
  // The typeface is served by the app itself.
  expect(await page.evaluate(() => document.fonts.check('16px "IBM Plex Sans Arabic"'))).toBe(true);
  expect(await page.evaluate(() => [...document.styleSheets].every((s) => !s.href || new URL(s.href).origin === location.origin))).toBe(true);

  expect(await rootSize()).toBe(17);
  await page.getByRole('button', { name: /المظهر/ }).first().click();
  await page.getByRole('menuitemradio', { name: 'أكبر' }).click();
  expect(await rootSize()).toBe(21);
  expect(await overflows(page)).toBe(false);
  await page.keyboard.press('Escape');

  // Remembered on this device, applied before the app draws.
  await page.reload();
  await expect(page.locator('main')).toBeVisible();
  expect(await rootSize()).toBe(21);
  await page.goto('/settings');
  await page.getByText('تفضيلات هذا الجهاز').first().click();
  await expect(page.getByLabel('حجم الخط')).toHaveValue('larger');
  await page.getByLabel('حجم الخط').selectOption('compact');
  expect(await rootSize()).toBe(16);
  await page.getByLabel('حجم الخط').selectOption('normal');
  expect(await rootSize()).toBe(17);
  expect(errors).toEqual([]);
  await close();
});
