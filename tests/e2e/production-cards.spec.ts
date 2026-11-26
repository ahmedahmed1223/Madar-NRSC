import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'fs';
import { openNav, openSettingsSection, signIn } from './helpers';

/**
 * The version 4 journey: an administrator shapes the stations, a chief editor creates a card
 * across three stations, a field reporter finishes their step from a phone, and the editor
 * follows the day, the workload and the handover brief.
 */
const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const H = { 'X-NRCS-Client': 'web' };
const TITLE = 'شهادة مصوّرة من مخيم جباليا';
const shiftStations = ['غزة', 'بيروت', 'إسطنبول', 'عمّان'];
const shiftNames = Array.from({ length: 36 }, (_, index) => `مراسل المناوبة التجريبية ${index + 1}`);

async function downloadReport(page: Page, filename: RegExp) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'CSV', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(filename);
  const path = await download.path();
  if (!path) throw new Error('The browser did not provide a local CSV download');
  const content = await fs.promises.readFile(path, 'utf8');
  expect(content.charCodeAt(0)).toBe(0xfeff);
  return content;
}

async function violations(page: Page) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const result = await (window as any).axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] });
    return result.violations.map((v: any) => `${v.id}: ${v.nodes.map((n: any) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  });
}

const overflows = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

test.describe.configure({ mode: 'serial' });

test('an administrator manages stations and puts colleagues in them', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const { page } = admin;
  await page.goto('/settings');
  await openSettingsSection(page, 'المحطات والتكليفات');
  const form = page.getByRole('form', { name: 'المحطات والتكليفات' });
  await expect(form.getByLabel('اسم المحطة 1')).toHaveValue('غزة');
  await expect(form.getByLabel('اسم المحطة 3')).toHaveValue('إسطنبول');

  // A fourth station, Beirut as the main one, and Gaza limited to working with Istanbul.
  await form.getByRole('button', { name: 'إضافة محطة' }).click();
  await form.getByLabel('اسم المحطة 4').fill('عمّان');
  await form.getByRole('listitem').filter({ has: page.getByLabel('اسم المحطة 2') }).getByLabel('المحطة الرئيسية').check();
  const gaza = form.getByRole('listitem').filter({ has: page.getByLabel('اسم المحطة 1') });
  await gaza.getByLabel('مفتوحة لكل المحطات غير المقيّدة').uncheck();
  await gaza.getByRole('group', { name: 'المحطات المرتبطة بمحطة غزة' }).getByLabel('إسطنبول').check();
  await expect(gaza.getByText('تتابع وتكلّف: بيروت، إسطنبول')).toBeVisible();
  await form.getByRole('button', { name: 'حفظ' }).click();
  await expect(form.getByRole('status')).toHaveText('حُفظت المحطات والمجموعات وأنواع المهام');
  await expect.poll(async () => {
    const { collections } = await (await page.request.get('/api/v1/data')).json();
    return (collections.settings[0].d.stations ?? []).map((station: { name: string }) => station.name);
  }).toContain('عمّان');

  // Verify that the confirmed settings survive a reload.
  await page.reload();
  await openSettingsSection(page, 'المحطات والتكليفات');
  await expect(page.getByLabel('اسم المحطة 4')).toHaveValue('عمّان');

  // Colleagues are placed in stations from the user form.
  const data = await (await page.request.get('/api/v1/data')).json();
  const stations: { id: string; name: string }[] = data.collections.settings[0].d.stations;
  const id = (name: string) => stations.find((s) => s.name === name)!.id;
  expect(stations.map((s) => s.name)).toEqual(shiftStations);
  await page.goto('/users');
  await page.getByPlaceholder(/ابحث بالاسم/).fill('reporter@akhbar.tv');
  await page.getByTitle('تعديل المستخدم').first().click();
  const userForm = page.getByRole('region', { name: /تعديل حساب/ });
  await userForm.getByLabel('المحطة', { exact: true }).selectOption(id('غزة'));
  await userForm.getByRole('button', { name: 'حفظ التعديلات' }).click();
  await expect.poll(async () => (await (await page.request.get('/api/v1/data')).json()).collections.users.find((u: any) => u.id === 'usr-6').d.stationId).toBe(id('غزة'));

  // The rest through the API, as an import would.
  const fresh = (await (await page.request.get('/api/v1/data')).json()).collections.users;
  const place: Record<string, string> = { 'usr-2': 'بيروت', 'usr-3': 'بيروت', 'usr-7': 'إسطنبول', 'usr-10': 'غزة' };
  const ops = fresh.filter((u: any) => place[u.id]).map((u: any) => ({ c: 'users', op: 'upsert', id: u.id, d: { ...u.d, stationId: id(place[u.id]) }, baseV: u.v }));
  const res = await (await page.request.post('/api/v1/data/sync', { headers: H, data: { ops } })).json();
  expect(res.results.every((r: any) => r.ok)).toBe(true);

  const reporter = fresh.find((u: any) => u.id === 'usr-6').d;
  const shiftOps = shiftNames.map((fullName, index) => {
    const userId = `usr-browser-shift-${index}`;
    return {
      c: 'users', op: 'upsert', id: userId,
      d: { ...reporter, id: userId, fullName, email: `browser-shift-${index}@example.test`, stationId: stations[index % stations.length].id },
    };
  });
  const shift = await page.request.post('/api/v1/data/sync', { headers: H, data: { ops: shiftOps } });
  expect(shift.ok()).toBe(true);
  expect((await shift.json()).results).toEqual(shiftOps.map(() => expect.objectContaining({ ok: true })));

  const completed = shiftOps.map((user, index) => {
    const cardId = `crd-browser-shift-${index}`;
    return { c: 'productionCards', op: 'upsert', id: cardId, d: {
      id: cardId, title: `تغطية المناوبة التجريبية ${index + 1}`, kind: 'REPORT', priority: 'URGENT', status: 'OPEN', log: [],
      steps: [
        { id: `${cardId}-gather`, type: 'gather', status: 'DONE', complexity: 1, assigneeId: user.id, spentMinutes: 5 },
        { id: `${cardId}-verify`, type: 'verify', status: 'DONE', complexity: 1, assigneeId: shiftOps[(index + 1) % shiftOps.length].id, spentMinutes: 5 },
      ],
    } };
  });
  const produced = await page.request.post('/api/v1/data/sync', { headers: H, data: { ops: completed } });
  expect(produced.ok()).toBe(true);
  expect((await produced.json()).results).toEqual(completed.map(() => expect.objectContaining({ ok: true })));
  expect(admin.errors).toEqual([]);
  await admin.close();
});

test('a chief editor creates a card across stations and the reporter hands it on from a phone', async ({ browser }) => {
  const editor = await signIn(browser, 'editor@akhbar.tv');
  await openNav(editor.page, 'التكليفات');
  await editor.page.getByRole('button', { name: 'تكليف حر', exact: true }).click();
  await editor.page.getByLabel('عنوان المادة *').fill(TITLE);
  await editor.page.getByLabel('نوع المادة').selectOption('REPORT');
  await editor.page.getByLabel('المطلوب إنجازه').fill('شهادة شاهد عيان مع صور الموقع، مدة دقيقتين.');
  await editor.page.getByLabel('مادة عاجلة').check();
  await editor.page.getByRole('button', { name: 'تقرير ميداني' }).click();
  const steps = editor.page.locator('ol > li');
  await expect(steps).toHaveCount(7);
  const users = (await (await editor.page.request.get('/api/v1/data')).json()).collections;
  const istanbul = users.settings[0].d.stations.find((s: any) => s.name === 'إسطنبول').id;
  await steps.nth(0).getByLabel('المكلف').selectOption('u:usr-6');
  await steps.nth(0).getByLabel('التعقيد').selectOption('3');
  await steps.nth(0).getByLabel('الوقت المقدر (دقيقة)').fill('120');
  await steps.nth(1).getByLabel('المكلف').selectOption('u:usr-3');
  await steps.nth(3).getByLabel('المكلف').selectOption(`s:${istanbul}`);
  let confirmWrite = () => {};
  const confirmation = new Promise<void>((resolve) => { confirmWrite = resolve; });
  const syncPath = '**/api/v1/data/sync';
  await editor.page.route(syncPath, async (route) => {
    if (route.request().postDataJSON().ops.some((op: any) => op.c === 'productionCards' && op.d?.title === TITLE)) await confirmation;
    await route.continue();
  });
  try {
    await editor.page.getByRole('button', { name: 'إنشاء التكليف', exact: true }).click();
    await expect(editor.page.getByRole('button', { name: 'جارٍ حفظ التكليف…' })).toBeDisabled();
    await expect(editor.page.getByLabel('عنوان المادة *')).toHaveValue(TITLE);
    await expect(editor.page.getByText('أُنشئ التكليف ووصل التنبيه للمعنيين')).toHaveCount(0);
  } finally {
    confirmWrite();
  }

  // The new card leads «كل البطاقات»; it has its own address, and Back returns to the list.
  await expect(editor.page.getByText('أُنشئ التكليف ووصل التنبيه للمعنيين')).toBeVisible();
  await editor.page.unroute(syncPath);
  await editor.page.getByRole('button', { name: new RegExp(TITLE) }).first().click();
  await expect(editor.page.getByRole('heading', { name: TITLE })).toBeVisible();
  await expect(editor.page).toHaveURL(/\/cards\/crd-/);
  await expect(editor.page.getByText('أُنجز 0 من 7')).toBeVisible();
  await editor.page.goBack();
  await expect(editor.page).toHaveURL(/\/cards$/);
  await expect(editor.page.getByRole('heading', { name: 'التكليفات' })).toBeVisible();
  expect(editor.errors).toEqual([]);
  await editor.close();

  // Field reporter on a phone: the assignment arrived, the step is under «مهامي».
  const reporter = await signIn(browser, 'reporter@akhbar.tv', { viewport: { width: 390, height: 844 } });
  await reporter.page.goto('/cards');
  await expect(reporter.page.getByText('لا مهام مفتوحة باسمك الآن')).toHaveCount(0);
  await reporter.page.getByRole('button', { name: new RegExp(TITLE) }).first().click();
  await expect(reporter.page.getByText('مهمتي')).toBeVisible();
  expect(await overflows(reporter.page)).toBe(false);
  await reporter.page.getByRole('button', { name: 'بدء العمل' }).click();
  await expect(reporter.page.getByText('بدأ العمل على المهمة')).toBeVisible();
  await reporter.page.getByRole('button', { name: 'تم الإنجاز' }).click();
  await reporter.page.getByLabel('ملاحظة التسليم: ما اكتمل وما ينقص؟').fill('رُفعت الشهادة مع صور الموقع. ينقص تأكيد اسم الشاهد.');
  await reporter.page.getByLabel('وقت هذه الجلسة (دقيقة)').fill('95');
  await reporter.page.getByRole('button', { name: 'تأكيد الإنجاز والتسليم' }).click();
  await expect(reporter.page.getByText('أُنجز 1 من 7')).toBeVisible();
  // Someone else's step offers the reporter no action.
  const second = reporter.page.locator('ol > li').nth(1);
  await expect(second.getByRole('button')).toHaveCount(0);
  await reporter.page.getByLabel('توثيق ما أنجزته').fill('المادة الخام على القرص المشترك');
  await reporter.page.getByRole('button', { name: 'توثيق' }).click();
  await expect(reporter.page.getByText('المادة الخام على القرص المشترك')).toBeVisible();
  expect(reporter.errors).toEqual([]);
  await reporter.close();

  // The next colleague was told what is complete and what is missing.
  const journalist = await signIn(browser, 'journalist@akhbar.tv');
  const notes = (await (await journalist.page.request.get('/api/v1/data')).json()).collections.notifications.map((r: any) => r.d).filter((n: any) => String(n.linkUrl).startsWith('/cards/'));
  expect(notes.some((n: any) => n.title.includes('وصلتك المادة') && n.message.includes('ينقص تأكيد اسم الشاهد'))).toBe(true);
  await journalist.page.goto(notes[0].linkUrl);
  await expect(journalist.page.getByRole('heading', { name: TITLE })).toBeVisible();
  await journalist.page.getByRole('button', { name: 'متعطلة' }).click();
  await journalist.page.getByLabel('ما سبب التعطل وما المطلوب لحله؟').fill('المصدر لا يرد على الهاتف');
  await journalist.page.getByRole('button', { name: 'تسجيل التعطل', exact: true }).click();
  await expect(journalist.page.getByText('سبب التعطل: المصدر لا يرد على الهاتف')).toBeVisible();
  expect(journalist.errors).toEqual([]);
  await journalist.close();
});

test('the editor follows the day, the workload, an employee record and the handover brief', async ({ browser }) => {
  for (const colorScheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme, bypassCSP: true });
    const page = await context.newPage();
    await page.goto('/');
    await page.fill('#login-email', 'editor@akhbar.tv');
    await page.fill('#login-password', 'Madar@Demo2026');
    await page.click('button[type=submit]');
    await expect(page.locator('main')).toBeVisible();

    await page.goto('/cards');
    await expect(page.getByRole('heading', { name: 'تحتاج قراراً' })).toBeVisible();
    await expect(page.getByText('السبب: التحقق: المصدر لا يرد على الهاتف')).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await page.getByRole('button', { name: new RegExp(TITLE) }).first().click();
    await expect(page.getByText('إسهام المحطات')).toBeVisible();
    expect(await violations(page)).toEqual([]);

    await page.goto('/workload');
    const stationsTable = page.getByRole('region', { name: /جدول مقارنة المحطات/ }).getByRole('table');
    // A colleague heading a department starts in their team's queue, even with reporting access.
    const reportsScope = page.getByRole('button', { name: 'الأعباء والأداء', exact: true });
    await expect(stationsTable.or(reportsScope).first()).toBeVisible();
    if (await reportsScope.isVisible()) await reportsScope.click();
    await expect(stationsTable.getByRole('rowheader', { name: 'غزة' })).toBeVisible();
    await expect(stationsTable.getByRole('rowheader', { name: 'عمّان' })).toBeVisible();
    expect(await violations(page)).toEqual([]);
    if (colorScheme === 'light') {
      const load = await downloadReport(page, /^متابعة-الفرق-.*\.csv$/);
      for (const value of ['غزة', 'عمّان', 'ليلى النجار', 'نقاط الحمل']) expect(load).toContain(`"${value}"`);
      for (const [index, name] of shiftNames.entries()) {
        expect(load).toContain(`"${name}","${shiftStations[index % shiftStations.length]}"`);
      }
      const station = page.getByLabel('المحطة', { exact: true });
      await station.selectOption({ label: 'عمّان' });
      const filtered = await downloadReport(page, /^متابعة-الفرق-.*\.csv$/);
      expect(filtered.match(/"مراسل المناوبة التجريبية \d+"/g)).toHaveLength(9);
      expect(filtered).toContain(`"${shiftNames[3]}","عمّان"`);
      await station.selectOption({ label: 'كل المحطات' });
      await page.getByRole('tab', { name: 'الإنتاج', exact: true }).click();
      const output = await downloadReport(page, /^الإنتاج-.*\.csv$/);
      expect(output).toContain('"مهام أنجزتها"');
      expect(output).toContain('"منها مشتركة","36"');
      for (const stationName of shiftStations) expect(output).toContain(`"${stationName}","18","18","18"`);
      await page.getByRole('tab', { name: 'الفرق والأعباء', exact: true }).click();
    }
    await page.getByRole('button', { name: /^المراسلون الميدانيون/ }).click();
    await page.getByRole('button', { name: 'ليلى النجار', exact: true }).click();
    await expect(page.getByRole('heading', { name: /ملف إنجاز: ليلى النجار/ })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(TITLE) })).toBeVisible();
    await expect(page.getByText('1 س 35 د').first()).toBeVisible();
    if (colorScheme === 'light') {
      const employee = await downloadReport(page, /^ملف-إنجاز-ليلى النجار\.csv$/);
      expect(employee).toMatch(new RegExp(`"${TITLE}","[0-9.]+","95"`));
    }
    expect(await violations(page)).toEqual([]);
    await page.getByRole('tab', { name: /تسليم المناوبة/ }).click();
    await expect(page.getByRole('heading', { name: /متعطل أو متأخر/ })).toBeVisible();
    await expect(page.getByText('المصدر لا يرد على الهاتف').first()).toBeVisible();
    await page.getByLabel('المحطة', { exact: true }).selectOption({ label: 'غزة' });
    await expect(page.getByText('ينقص تأكيد اسم الشاهد').first()).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await context.close();
  }
});

test('colleagues without supervision rights see only their own record', async ({ browser }) => {
  const reporter = await signIn(browser, 'reporter@akhbar.tv', { viewport: { width: 390, height: 844 } });
  await reporter.page.goto('/workload');
  await expect(reporter.page.getByRole('heading', { name: /ملف إنجاز: ليلى النجار/ })).toBeVisible();
  await expect(reporter.page.getByLabel('الموظف')).toHaveCount(0);
  await expect(reporter.page.getByText('توزيع الأعباء')).toHaveCount(0);
  expect(await overflows(reporter.page)).toBe(false);
  await reporter.page.goto('/cards');
  await expect(reporter.page.getByRole('button', { name: 'تكليف حر', exact: true })).toHaveCount(0);
  expect(await overflows(reporter.page)).toBe(false);
  expect(reporter.errors).toEqual([]);
  await reporter.close();
});
