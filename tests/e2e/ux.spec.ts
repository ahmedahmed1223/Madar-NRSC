import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { openNav, signIn } from './helpers';

test('empty required fields explain themselves in Arabic', async ({ page }) => {
  await page.goto('/');
  await page.click('button[type=submit]');
  const message = await page.locator('#login-email').evaluate((el: HTMLInputElement) => el.validationMessage);
  expect(message).toBe('هذا الحقل مطلوب.');
  await expect(page.locator('#login-email')).toHaveAttribute('aria-invalid', 'true');
  await page.fill('#login-email', 'not-an-email');
  await page.click('button[type=submit]');
  expect(await page.locator('#login-email').evaluate((el: HTMLInputElement) => el.validationMessage)).toContain('بريداً إلكترونياً صحيحاً');
});

test('chat lives in the top bar; panels close with Esc and when the screen changes', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'editor@akhbar.tv');
  const chatButton = page.locator('header button[aria-label^="المحادثة الداخلية"]');
  await chatButton.click();
  const drawer = page.getByRole('dialog', { name: 'المحادثة الداخلية بين الأقسام' });
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  await chatButton.click();
  await expect(drawer).toBeVisible();
  await openNav(page, 'المهام');
  await expect(drawer).toHaveCount(0);

  await page.getByRole('button', { name: /^الإشعارات/ }).click();
  await expect(page.getByText('مركز الإشعارات التحريرية')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('مركز الإشعارات التحريرية')).toHaveCount(0);
  expect(errors).toEqual([]);
  await close();
});

test('the mobile messages screen opens the department drawer and sends to its chosen channel', async ({ browser }) => {
  const sender = await signIn(browser, 'editor@akhbar.tv', { viewport: { width: 390, height: 844 }, bypassCSP: true });
  const receiver = await signIn(browser, 'producer@akhbar.tv', { viewport: { width: 1440, height: 900 }, bypassCSP: true });
  const text = `رسالة تجريبية بين الأقسام ${Date.now()}`;
  try {
    await openNav(sender.page, 'المراسلات');
    await sender.page.getByRole('button', { name: 'محادثة الأقسام', exact: true }).click();
    const drawer = sender.page.getByRole('dialog', { name: 'المحادثة الداخلية بين الأقسام' });
    await expect(drawer).toBeVisible();
    const senderChannel = drawer.getByLabel('قناة المحادثة');
    await senderChannel.selectOption('general');
    await drawer.getByRole('textbox', { name: 'نص الرسالة' }).fill(text);
    await senderChannel.selectOption('field');
    await expect(drawer.getByRole('textbox', { name: 'نص الرسالة' })).toHaveValue('');
    const fieldText = `رسالة لقسم المراسلين ${Date.now()}`;
    await drawer.getByRole('textbox', { name: 'نص الرسالة' }).fill(fieldText);
    await drawer.getByRole('button', { name: 'إرسال الرسالة' }).click();
    await expect(drawer.getByRole('status')).toHaveText('أُرسلت الرسالة');
    await senderChannel.selectOption('general');
    await expect(drawer.getByRole('textbox', { name: 'نص الرسالة' })).toHaveValue(text);
    await drawer.getByRole('button', { name: 'إرسال الرسالة' }).click();
    await expect(drawer.getByRole('status')).toHaveText('أُرسلت الرسالة');
    await receiver.page.getByRole('button', { name: /^المحادثة الداخلية/ }).click();
    const received = receiver.page.getByRole('dialog', { name: 'المحادثة الداخلية بين الأقسام' });
    const receiverChannel = received.getByLabel('قناة المحادثة');
    const fieldOption = receiverChannel.locator('option[value="field"]');
    await expect(fieldOption).toContainText('غير مقروء');
    await receiverChannel.selectOption('general');
    await expect(received.getByText(text, { exact: true })).toBeVisible();
    await expect(receiverChannel.locator('option[value="general"]')).not.toContainText('غير مقروء');
    await expect(fieldOption).toContainText('غير مقروء');
    await receiverChannel.selectOption('field');
    await expect(received.getByText(fieldText, { exact: true })).toBeVisible();
    await expect(fieldOption).not.toContainText('غير مقروء');
    expect((await drawer.boundingBox())?.width).toBeLessThanOrEqual(390);
    const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
    for (const [fixture, dark] of [[sender, false], [receiver, true]] as const) {
      await fixture.page.evaluate(night => document.documentElement.classList.toggle('dark', night), dark);
      await fixture.page.addScriptTag({ content: axe });
      const panel = fixture.page.getByRole('dialog', { name: 'المحادثة الداخلية بين الأقسام' });
      const violations = await panel.evaluate(async element => (await (window as any).axe.run(element, {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'],
      })).violations.map((violation: any) => violation.id));
      expect(violations).toEqual([]);
      await fixture.page.screenshot({ path: test.info().outputPath(dark ? 'intercom-desktop-dark.png' : 'intercom-mobile-light.png') });
    }
    await received.getByRole('button', { name: 'فتح القناة', exact: true }).click();
    await expect(receiver.page).toHaveURL(/\/messages\/field$/);
    await expect(received).not.toBeVisible();
  } finally {
    await receiver.close();
    await sender.close();
  }
});

test('reduce motion stops pulsing; badges never blink when the device asks for less motion', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'editor@akhbar.tv');
  await page.getByRole('button', { name: /^المظهر/ }).click();
  await page.getByRole('menuitemcheckbox', { name: /تقليل الحركة/ }).click();
  await expect(page.locator('html')).toHaveClass(/reduce-motion/);
  const animation = await page.evaluate(() => {
    const el = document.createElement('span');
    el.className = 'animate-pulse';
    document.body.appendChild(el);
    return getComputedStyle(el).animationName;
  });
  expect(animation).toBe('none');
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/reduce-motion/);
  await close();

  // The operating-system setting alone must not turn the pulse into rapid flicker.
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const p2 = await ctx.newPage();
  await p2.goto('/');
  const style = await p2.evaluate(() => {
    const el = document.createElement('span');
    el.className = 'animate-pulse';
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    return { name: cs.animationName, count: cs.animationIterationCount };
  });
  expect(style.name).toBe('none');
  await ctx.close();
  expect(errors).toEqual([]);
});

test('news status tabs: one bar with counts, arrow keys move between statuses', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'الأخبار');
  const tabs = page.getByRole('tablist', { name: 'تصفية الأخبار حسب الحالة' });
  await expect(tabs.getByRole('tab', { name: /الكل/ })).toHaveAttribute('aria-selected', 'true');
  await tabs.getByRole('tab', { name: /قيد المراجعة/ }).click();
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.getByRole('tab', { name: /مُعاد للتعديل/ })).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.getByRole('tab', { name: /مُعاد للتعديل/ })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tabs.getByRole('tab', { name: /الكل/ })).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
  await close();
});
