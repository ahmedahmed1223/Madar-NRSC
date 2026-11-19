import { expect, test } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'fs';
import { signIn } from './helpers';

/** The rail ordered by role with folding sections, the interactive tours and the administrator's setup. */
const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

test('the rail follows each role, folds its sections and remembers the fold', async ({ browser }) => {
  const reporter = await signIn(browser, 'reporter@akhbar.tv');
  const nav = reporter.page.locator('aside nav[aria-label="التنقل"]');
  const sections = nav.locator('[role="group"]');
  await expect(sections.first()).toHaveAttribute('aria-label', 'عملي');
  await expect(sections.nth(1)).toHaveAttribute('aria-label', 'غرفة الأخبار');
  // The rail calls the agency feeds «المصادر».
  await expect(nav.getByRole('button', { name: /^المصادر/ })).toBeVisible();
  // Folding hides the items and keeps the header; the choice survives a reload.
  // A folded header also shows what waits inside, so its name grows a count.
  const header = nav.getByRole('button', { name: /^غرفة الأخبار/ });
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(nav.getByRole('button', { name: /^المصادر/ })).toHaveCount(0);
  await reporter.page.reload();
  await expect(nav.getByRole('button', { name: /^غرفة الأخبار/ })).toHaveAttribute('aria-expanded', 'false');
  // The section of the open screen always shows.
  await reporter.page.goto('/news');
  await expect(nav.getByRole('button', { name: /^الأخبار/ })).toHaveAttribute('aria-current', 'page');
  expect(reporter.errors).toEqual([]);
  await reporter.close();

  const director = await signIn(browser, 'director@akhbar.tv');
  const directorSections = director.page.locator('aside nav[aria-label="التنقل"] [role="group"]');
  await expect(directorSections.nth(1)).toHaveAttribute('aria-label', 'المتابعة والإدارة');
  await director.close();
});

test('a colleague takes a tour from the help screen and leaves it with Escape', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'journalist@akhbar.tv', { bypassCSP: true });
  await page.goto('/help');
  const tours = page.getByRole('region', { name: 'جولات تفاعلية' });
  await tours.getByRole('button', { name: /جولة البداية/ }).click();
  const card = page.getByRole('dialog', { name: 'أهلاً في «مدار»' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'التالي' })).toBeFocused();
  await card.getByRole('button', { name: 'التالي' }).click();
  const rail = page.getByRole('dialog', { name: 'القائمة مرتبة حسب دورك' });
  await expect(rail).toBeVisible();
  // The window is drawn around the rail.
  const hole = await page.locator('.tour-hole').boundingBox();
  const aside = await page.locator('aside nav[aria-label="التنقل"]').boundingBox();
  expect(hole && aside && hole.x <= aside.x && hole.y <= aside.y + 1).toBeTruthy();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('dialog', { name: 'أين أنت الآن' })).toBeVisible();
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => (await (window as any).axe.run(document.querySelector('[aria-labelledby="tour-step-title"]'), { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v: any) => v.id));
  expect(violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.tour-hole')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // A screen tour opens its screen.
  await page.goto('/help');
  await page.getByRole('region', { name: 'جولات تفاعلية' }).getByRole('button', { name: /غرفة الأخبار/ }).click();
  await expect(page).toHaveURL(/\/news$/);
  await expect(page.getByRole('dialog', { name: 'الخبر بحسب مرحلته' })).toBeVisible();
  await page.getByRole('button', { name: 'إنهاء الجولة' }).click();
  expect(errors).toEqual([]);
  await close();
});

test('the administrator sets the system up from the quick-setup wizard', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'admin@akhbar.tv');
  const banner = page.getByRole('region', { name: 'الإعداد السريع' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: /الإعداد السريع|متابعة الإعداد/ }).click();
  const steps = page.getByRole('navigation', { name: 'خطوات الإعداد' });
  await expect(steps).toBeVisible();

  // Organization.
  await steps.getByRole('button', { name: /المؤسسة/ }).click();
  await page.getByLabel('اسم المؤسسة *').fill('شبكة مدار الإخبارية');
  await page.getByLabel('المنطقة الزمنية للمحطة').selectOption('Asia/Gaza');
  await page.getByRole('button', { name: 'حفظ والمتابعة' }).click();
  await expect(page.getByText('حُفظت بيانات المؤسسة.')).toBeVisible();
  await expect.poll(async () => (await (await page.request.get('/api/v1/data')).json()).collections.settings[0].d.organizationName).toBe('شبكة مدار الإخبارية');

  // A colleague with a role, a station and a first password; they can sign in with it.
  await steps.getByRole('button', { name: /الفريق/ }).click();
  await page.getByLabel('الاسم الكامل *').fill('منى الخطيب');
  await page.getByLabel('البريد الإلكتروني *').fill('mona.setup@akhbar.tv');
  await page.getByLabel('الدور').selectOption('MONTAGE');
  await page.getByLabel('المحطة').selectOption({ label: 'غزة' });
  const password = await page.getByLabel('كلمة المرور الأولى').inputValue();
  await page.getByRole('button', { name: 'إضافة الزميل' }).click();
  await expect(page.getByText('أُضيف الحساب')).toBeVisible();
  // Signed in from another browser, so the administrator stays signed in here.
  const other = await browser.newContext();
  const login = await other.request.post('/api/v1/auth/login', { headers: { 'X-NRCS-Client': 'web' }, data: { email: 'mona.setup@akhbar.tv', password } });
  expect(login.status()).toBe(200);
  await other.close();

  // Finish.
  await steps.getByRole('button', { name: /الانتهاء/ }).click();
  await page.getByRole('button', { name: 'إنهاء الإعداد' }).click();
  await expect(page.getByText('اكتمل الإعداد.')).toBeVisible();
  await page.getByRole('button', { name: 'رجوع' }).click();
  await expect(page.getByRole('region', { name: 'الإعداد السريع' })).toHaveCount(0);
  expect(errors).toEqual([]);
  await close();
});
