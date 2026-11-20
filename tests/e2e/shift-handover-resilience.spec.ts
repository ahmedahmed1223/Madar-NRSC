import { expect, test } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'fs';
import { signIn } from './helpers';
const axe = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

for (const width of [390, 1440]) for (const theme of ['light', 'dark']) test(`handover draft preserves fields and keyboard focus ${width} ${theme}`, async ({ browser }) => {
  const { page, close, errors } = await signIn(browser, 'journalist@akhbar.tv', { viewport: { width, height: 900 }, bypassCSP: true });
  try {
    await page.evaluate(t => localStorage.setItem('nrcs-theme', t), theme);
    await page.goto('/roster?tab=handover');
    await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*\bdark\b)/);
    const opener = page.getByRole('button', { name: 'إنشاء تسليم' });
    await opener.click();
    await expect(page.getByLabel('عنوان التسليم')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('القسم', { exact: true })).toBeFocused();
    await page.getByLabel('الوردية المستلمة', { exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByLabel('الوردية المستلمة', { exact: true })).toHaveValue('NIGHT');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByLabel('الوردية المستلمة', { exact: true })).toHaveValue('EVENING');
    await page.getByLabel('عنوان التسليم').fill(`Recover ${width} ${theme}`);
    await page.getByLabel('ملاحظات القسم').fill('Preserve unsaved fields');
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    await page.reload();
    await page.getByRole('button', { name: 'إنشاء تسليم' }).click();
    await expect(page.getByLabel('عنوان التسليم')).toHaveValue(`Recover ${width} ${theme}`);
    await expect(page.getByLabel('ملاحظات القسم')).toHaveValue('Preserve unsaved fields');
    for (const name of ['حفظ المسودة', 'مراجعة النسخة الحالية', 'إضافة المرجع']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    await page.route('**/api/v1/shift-handovers', async route => {
      if (route.request().method() === 'POST') await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Test failure' }) }); else await route.continue();
    });
    await page.getByRole('button', { name: 'حفظ المسودة', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Test failure' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Test failure' })).toBeInViewport();
    await expect(page.getByLabel('عنوان التسليم')).toBeFocused();
    await expect(page.getByLabel('ملاحظات القسم')).toHaveValue('Preserve unsaved fields');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.addScriptTag({ content: axe });
    expect(await page.evaluate(async () => (await (window as any).axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v: any) => `${v.id}: ${v.nodes.map((n: any) => n.target).join(',')}`))).toEqual([]);
    await page.screenshot({ path: `test-results/handover-${width}-${theme}.png`, fullPage: true });
    expect(errors).toEqual([]);
  } finally { await close(); }
});

test('stopped waiting retains draft and reconciles a committed lost response without duplicate', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'journalist@akhbar.tv');
  try {
    await page.goto('/roster?tab=handover');
    await page.getByRole('button', { name: 'إنشاء تسليم' }).click();
    await page.getByLabel('عنوان التسليم').fill('Lost response draft');
    let writes = 0;
    await page.route('**/api/v1/shift-handovers', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      writes++;
      await route.fetch();
      // Commit succeeded, but the workstation does not receive its acknowledgement.
    });
    await page.getByRole('button', { name: 'حفظ المسودة', exact: true }).click();
    await page.getByRole('button', { name: 'إيقاف الانتظار' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'لم يصل تأكيد الخادم' })).toBeVisible();
    await expect(page.getByLabel('عنوان التسليم')).toHaveValue('Lost response draft');
    await page.getByRole('button', { name: 'حفظ المسودة', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'تأكدت نتيجة العملية السابقة' })).toBeVisible();
    expect(writes).toBe(1);
    const data = await (await page.request.get('/api/v1/shift-handovers')).json();
    expect(data.rows.filter((r: any) => r.d.title === 'Lost response draft')).toHaveLength(1);
  } finally { await close(); }
});

test('offline reconnect never queues a handover mutation', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'journalist@akhbar.tv');
  try {
    await page.goto('/roster?tab=handover');
    await page.getByRole('button', { name: 'إنشاء تسليم' }).click();
    await page.getByLabel('عنوان التسليم').fill('Offline draft');
    const mutations: string[] = [];
    page.on('request', req => { if (req.url().includes('/api/v1/shift-handovers') && req.method() !== 'GET') mutations.push(req.method()); });
    await page.context().setOffline(true);
    await expect(page.getByRole('button', { name: 'حفظ المسودة', exact: true })).toBeDisabled();
    await page.getByLabel('ملاحظات القسم').fill('Still editable locally');
    await page.context().setOffline(false);
    await expect(page.getByRole('button', { name: 'حفظ المسودة', exact: true })).toBeEnabled();
    expect(mutations).toEqual([]);
    await expect(page.getByLabel('ملاحظات القسم')).toHaveValue('Still editable locally');
  } finally { await page.context().setOffline(false); await close(); }
});

test('edits after an uncertain save are never marked as confirmed', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'journalist@akhbar.tv');
  try {
    await page.goto('/roster/handover');
    await page.getByRole('button', { name: 'إنشاء تسليم' }).click();
    await page.getByLabel('عنوان التسليم').fill('Uncertain save with later edits');
    await page.route('**/api/v1/shift-handovers', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fetch();
    });
    await page.getByRole('button', { name: 'حفظ المسودة', exact: true }).click();
    await page.getByRole('button', { name: 'إيقاف الانتظار' }).click();
    await expect(page.getByLabel('ملاحظات القسم')).toBeEnabled();
    await page.getByLabel('ملاحظات القسم').fill('These changes have not reached the server');
    await page.getByRole('button', { name: 'حفظ المسودة', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'تغيرت الحقول' })).toBeVisible();
    await expect(page.getByLabel('ملاحظات القسم')).toHaveValue('These changes have not reached the server');
    await expect(page.getByRole('button', { name: 'نشر التسليم', exact: true })).toHaveCount(0);
    const rows = (await (await page.request.get('/api/v1/shift-handovers')).json()).rows;
    expect(rows.find((r: any) => r.d.title === 'Uncertain save with later edits').d.note).toBe('');
  } finally { await close(); }
});
test('blocked recovery storage keeps current fields usable and warns explicitly', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'journalist@akhbar.tv');
  try {
    await page.goto('/roster/handover');
    await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.startsWith('madar-form-draft:v1:handover:')) throw new Error('blocked'); return original.call(this, key, value); }; });
    await page.getByRole('button', { name: 'إنشاء تسليم' }).click();
    await page.getByLabel('عنوان التسليم').fill('Blocked recovery');
    await expect(page.getByText('تعذر حفظ نسخة الاستعادة على الجهاز؛ أبقِ النافذة مفتوحة حتى تأكيد الحفظ.')).toBeVisible();
    await page.getByRole('button', { name: 'حفظ المسودة', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'حُفظت المسودة' })).toBeVisible();
    await expect(page.getByLabel('عنوان التسليم')).toHaveValue('Blocked recovery');
  } finally { await close(); }
});

test('incoming summary opens the handover tab and a revoked permission cannot acknowledge', async ({ browser }) => {
  const administrator = await signIn(browser, 'admin@akhbar.tv');
  const incoming = await signIn(browser, 'journalist@akhbar.tv');
  try {
    const data = await (await administrator.page.request.get('/api/v1/data')).json();
    const original = data.collections.users.find((r: any) => r.d.email === 'journalist@akhbar.tv');
    const id = `2026-10-11:newsroom:EVENING:${original.id}`;
    await administrator.page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [{ c: 'roster', op: 'upsert', id, d: { id, date: '2026-10-11', departmentId: 'newsroom', shift: 'EVENING', userId: original.id, userName: original.d.fullName } }] } });
    const created = await administrator.page.request.post('/api/v1/shift-handovers', { headers: { 'X-NRCS-Client': 'web' }, data: { id: 'incoming-summary-test', schemaVersion: 1, departmentId: 'newsroom', sourceDate: '2026-10-11', sourceShift: 'MORNING', recipientDate: '2026-10-11', recipientShift: 'EVENING', title: 'Summary handover', note: '', references: [] } });
    expect(created.ok()).toBe(true);
    const row = (await created.json()).row;
    await administrator.page.request.post('/api/v1/shift-handovers/incoming-summary-test/publish', { headers: { 'X-NRCS-Client': 'web' }, data: { baseV: row.v } });
    await incoming.page.reload();
    await incoming.page.getByRole('button', { name: 'مراجعة تسليم الوردية', exact: true }).click();
    await expect(incoming.page).toHaveURL(/\/roster\/handover$/);
    await incoming.page.getByRole('button', { name: 'Summary handover', exact: true }).click();
    await expect(incoming.page.getByRole('button', { name: 'تأكيد الاستلام', exact: true })).toBeEnabled();
    const changed = await administrator.page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [{ c: 'users', op: 'upsert', id: original.id, baseV: original.v, d: { ...original.d, customPermissions: ['!handover.view'] } }] } });
    expect((await changed.json()).results[0].ok).toBe(true);
    await expect(incoming.page.getByText('تحتاج صلاحية قراءة تسليم الوردية؛ النشر وحده لا يمنح حق القراءة.')).toBeVisible();
    const ack = await incoming.page.request.post('/api/v1/shift-handovers/incoming-summary-test/acknowledge', { headers: { 'X-NRCS-Client': 'web' }, data: { note: '' } });
    expect(ack.status()).toBe(403);
    const latest = await (await administrator.page.request.get('/api/v1/data')).json();
    const current = latest.collections.users.find((r: any) => r.id === original.id);
    await administrator.page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [{ c: 'users', op: 'upsert', id: original.id, baseV: current.v, d: original.d }] } });
  } finally { await administrator.close(); await incoming.close(); }
});
test('switching accounts does not restore another author draft', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'journalist@akhbar.tv');
  try {
    await page.goto('/roster/handover');
    await page.getByRole('button', { name: 'إنشاء تسليم' }).click();
    await page.getByLabel('عنوان التسليم').fill('Private account draft');
    await page.keyboard.press('Escape');
    await page.request.post('/api/v1/auth/logout', { headers: { 'X-NRCS-Client': 'web' } });
    await page.reload();
    await page.fill('#login-email', 'editor@akhbar.tv');
    await page.fill('#login-password', 'Madar@Demo2026');
    await page.click('button[type=submit]');
    await expect(page.locator('main')).toBeVisible();
    await page.goto('/roster/handover');
    await page.getByRole('button', { name: 'إنشاء تسليم' }).click();
    await expect(page.getByLabel('عنوان التسليم')).toHaveValue('');
  } finally { await close(); }
});
test('a lost create response can be reconciled after refreshing the browser', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'journalist@akhbar.tv');
  try {
    await page.goto('/roster/handover');
    await page.getByRole('button', { name: 'إنشاء تسليم' }).click();
    await page.getByLabel('عنوان التسليم').fill('Recovered committed draft');
    let writes = 0;
    await page.route('**/api/v1/shift-handovers', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      writes++; await route.fetch();
    });
    await page.getByRole('button', { name: 'حفظ المسودة', exact: true }).click();
    await expect.poll(async () => (await (await page.request.get('/api/v1/shift-handovers')).json()).rows.some((r: any) => r.d.title === 'Recovered committed draft')).toBe(true);
    await page.getByRole('button', { name: 'إيقاف الانتظار' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'لم يصل تأكيد الخادم' })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'إنشاء تسليم' }).click();
    await expect(page.getByLabel('عنوان التسليم')).toHaveValue('Recovered committed draft');
    await page.getByRole('button', { name: 'حفظ المسودة', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'تأكدت نتيجة العملية السابقة' })).toBeVisible();
    expect(writes).toBe(1);
  } finally { await close(); }
});
test('a restored create conflict can explicitly load the current server version', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'journalist@akhbar.tv');
  try {
    const user = (await (await page.request.get('/api/v1/auth/me')).json()).user;
    const draft = { id: 'restored-conflict', schemaVersion: 1, departmentId: 'newsroom', sourceDate: '2026-10-11', sourceShift: 'MORNING', recipientDate: '2026-10-11', recipientShift: 'EVENING', title: 'Restored conflict', note: 'Local note', references: [] };
    const created = await page.request.post('/api/v1/shift-handovers', { headers: { 'X-NRCS-Client': 'web' }, data: { ...draft, note: 'Current server note' } });
    expect(created.ok()).toBe(true);
    await page.evaluate(({ userId, value }) => localStorage.setItem(`madar-form-draft:v1:handover:${userId}:new`, JSON.stringify({ version: 1, value: { draft: value, baseV: null } })), { userId: user.id, value: draft });
    await page.goto('/roster/handover');
    await page.getByRole('button', { name: 'إنشاء تسليم' }).click();
    await page.getByRole('button', { name: 'حفظ المسودة', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'توجد نسخة مختلفة على الخادم' })).toBeVisible();
    await page.getByRole('button', { name: 'مراجعة النسخة الحالية', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'تحميل النسخة' }).click();
    await expect(page.getByLabel('ملاحظات القسم')).toHaveValue('Current server note');
  } finally { await close(); }
});

test('source-only author can confirm a lost publication response without resending', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const author = await signIn(browser, 'journalist@akhbar.tv');
  const { page } = author;
  try {
    const { user } = await (await page.request.get('/api/v1/auth/me')).json();
    const date = '2026-10-11';
    const rosterId = `${date}:graphics:MORNING:${user.id}`;
    const roster = await admin.page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [{
      c: 'roster', op: 'upsert', id: rosterId,
      d: { id: rosterId, date, departmentId: 'graphics', shift: 'MORNING', userId: user.id, userName: user.fullName },
    }] } });
    expect((await roster.json()).results[0].ok).toBe(true);
    await page.goto('/roster/handover');
    await page.getByRole('button', { name: 'إنشاء تسليم' }).click();
    await page.getByLabel('عنوان التسليم').fill('Source-only confirmation');
    await page.getByLabel('القسم', { exact: true }).selectOption('graphics');
    await page.getByLabel('تاريخ الوردية الصادرة').fill(date);
    await page.getByLabel('تاريخ الوردية المستلمة').fill(date);
    await page.getByRole('button', { name: 'حفظ المسودة', exact: true }).click();
    const publish = page.getByRole('button', { name: 'نشر التسليم', exact: true });
    await expect(publish).toBeEnabled();
    let writes = 0;
    await page.route('**/api/v1/shift-handovers/*/publish', async route => {
      writes++;
      expect((await route.fetch()).ok()).toBe(true);
      await route.abort('failed');
    });
    await publish.click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'نشر التسليم', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'لم يصل تأكيد الخادم' })).toBeVisible();
    await publish.click();
    await expect(page.getByRole('status').filter({ hasText: 'تأكدت نتيجة العملية السابقة' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes).toBe(1);
    const { rows } = await (await admin.page.request.get('/api/v1/shift-handovers')).json();
    expect(rows.filter((row: any) => row.d.title === 'Source-only confirmation' && row.d.state === 'PUBLISHED')).toHaveLength(1);
    await expect(page.getByRole('button', { name: 'Source-only confirmation', exact: true })).toHaveCount(0);
  } finally { await author.close(); await admin.close(); }
});
