import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('login lists the real demo accounts and signs in with one click', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  const list = page.getByRole('list', { name: 'حسابات التجربة' });
  await expect(list.getByRole('button', { name: /ماجد الحربي — طاقم فني/ })).toBeVisible();
  await list.getByRole('button', { name: /سارة عبد العزيز/ }).click();
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByText('سارة عبد العزيز').first()).toBeVisible();
  await context.close();
});

test('unified search works with the keyboard only', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'editor@akhbar.tv');
  await page.keyboard.press('Control+k');
  const box = page.getByRole('combobox', { name: /بحث في الأخبار/ });
  await expect(box).toBeFocused();
  await box.fill('القمة');
  await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible();
  await expect(page.getByRole('listbox')).not.toContainText('PUBLISHED');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'البحث الموحد' })).toHaveCount(0);
  // Escape closes from any element in the dialog.
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'البحث الموحد' })).toHaveCount(0);
  expect(errors).toEqual([]);
  await close();
});

test('empty stories cannot be sent for review; proofreading fixes common slips', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'journalist@akhbar.tv');
  await openNav(page, 'الأخبار');
  await page.getByRole('button', { name: 'إنشاء خبر جديد' }).click();
  await page.fill('#news-headline-input', 'اعلن الوزير الى الصحفيين');
  await page.getByRole('button', { name: /إرسال للمراجعة/ }).first().click();
  await expect(page.getByRole('alert').filter({ hasText: 'نص الخبر فارغ' })).toBeVisible();
  // Proofread title + summary.
  await page.getByRole('button', { name: /^تدقيق/ }).first().click();
  await page.getByRole('button', { name: /إصلاح الكل/ }).click();
  await expect(page.locator('#news-headline-input')).toHaveValue('أعلن الوزير إلى الصحفيين');
  expect(errors).toEqual([]);
  await close();
});

test('bulletin approval chain: editor then managing editor; copy stories to another bulletin', async ({ browser }) => {
  const producer = await signIn(browser, 'producer@akhbar.tv');
  await openNav(producer.page, 'النشرات');
  const data = await (await producer.page.request.get('/api/v1/data')).json();
  const bulletin = data.collections.bulletins.find((row: any) => row.d.title.startsWith('نشرة الثامنة'));
  expect(bulletin).toBeTruthy();
  await producer.page.getByLabel('التاريخ', { exact: true }).fill(bulletin.d.date);
  await producer.page.locator('button[aria-label^="فتح نشرة الثامنة"]').first().click();
  await producer.page.getByRole('button', { name: /بيانات النشرة|تعديل النشرة/ }).first().click();
  const form = producer.page.locator('#form-page-root');
  await form.getByRole('button', { name: 'محرر النشرة ثم مدير التحرير' }).click();
  await form.getByRole('button', { name: /^حفظ/ }).last().click();
  await expect(producer.page.getByText(/مسار الاعتماد: .*← مدير التحرير/)).toBeVisible();

  // Copy two stories to a new bulletin.
  await producer.page.getByRole('button', { name: 'نسخ إلى نشرة أخرى' }).click();
  const copy = producer.page.locator('#form-page-root');
  await expect(copy.getByLabel('النشرة الهدف')).toBeVisible();
  expect(producer.errors).toEqual([]);
  await producer.close();
});
