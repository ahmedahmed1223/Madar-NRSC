import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('creates a programme and starts a new episode from its confirmed template', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { viewport: { width: 390, height: 844 } });
  const name = `برنامج المناوبة ${Date.now()}`;
  const syncPath = '**/api/v1/data/sync';
  const collections = async () => (await (await page.request.get('/api/v1/data')).json()).collections;
  let release = () => {};
  try {
    await openNav(page, 'البرامج');
    await page.getByRole('button', { name: 'إضافة برنامج جديد', exact: true }).click();
    await page.locator('#program-name-input').fill(name);
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(syncPath, async route => {
      if (route.request().postDataJSON().ops.some((op: any) => op.c === 'programs' && op.d?.name === name)) await gate;
      await route.continue();
    });
    await page.getByRole('button', { name: 'إنشاء البرنامج', exact: true }).click();
    await expect(page.getByRole('button', { name: 'بانتظار تأكيد الخادم…' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('#program-name-input')).toHaveValue(name);
    release();
    await expect(page.locator('#program-name-input')).not.toBeVisible();
    await page.unroute(syncPath);
    const program = (await collections()).programs.find((row: any) => row.d.name === name);
    expect(program).toBeTruthy();
    await page.goto(`/programs/${program.id}`);
    const programSections = page.getByRole('combobox', { name: 'أقسام البرنامج' });
    await programSections.selectOption('episodes');
    await expect(page.getByRole('heading', { name: 'حلقات البرنامج وجداول الرانداون' })).toBeInViewport();
    await page.screenshot({ path: 'test-results/workdesk-after-390-program.png' });
    await page.setViewportSize({ width: 320, height: 844 });
    const switcher = (await page.locator('#program-switcher-select').boundingBox())!;
    expect(switcher.x).toBeGreaterThanOrEqual(0);
    expect(switcher.x + switcher.width).toBeLessThanOrEqual(320);
    await page.getByRole('button', { name: 'البحث السريع (Ctrl + K)', exact: true }).click({ trial: true });
    await page.screenshot({ path: 'test-results/ui-review/program-320.png' });
    await page.setViewportSize({ width: 1440, height: 844 });
    await page.getByRole('tab', { name: 'قالب الرانداون المعياري' }).click();
    await expect(page.getByRole('tab', { name: 'قالب الرانداون المعياري' })).toHaveAttribute('aria-selected', 'true');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(programSections).toHaveValue('template');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    const startEpisode = async (title: string, structure: RegExp, day: string) => {
      await openNav(page, 'الحلقات');
      await page.getByRole('button', { name: 'إعداد حلقة جديدة', exact: true }).click();
      await page.getByLabel('البرنامج التابع له *').selectOption(program.id);
      await page.getByRole('radio', { name: structure }).click();
      await page.locator('#episode-title-input').fill(title);
      await page.getByLabel('تاريخ البث المقرر').fill(day);
      await page.getByLabel('وقت البدء', { exact: true }).fill('11:30');
      await page.getByRole('button', { name: 'بدء إعداد الحلقة', exact: true }).click();
      await expect.poll(async () => (await collections()).episodes.some((row: any) => row.d.title === title)).toBe(true);
      return (await collections()).episodes.find((row: any) => row.d.title === title);
    };
    const first = await startEpisode(`${name} الأولى`, /حلقة فارغة/, '2037-03-02');
    await expect(page.locator('#episode-title-input')).toBeHidden();
    await page.getByRole('button', { name: first.d.title, exact: true }).click();
    await expect(page).toHaveURL(`/episodes/${first.id}`);
    await page.getByRole('button', { name: 'مراجعة الرانداون', exact: true }).click();
    await page.getByRole('button', { name: 'إضافة فقرة', exact: true }).click();
    await page.locator('#segment-title-input').fill('افتتاحية ثابتة');
    await page.getByRole('button', { name: 'مقدمة / شارة', exact: true }).click();
    await page.locator('#segment-duration-input').fill('01:00');
    const fixedIntro = 'نص الافتتاحية الثابت للبرنامج.';
    await page.locator('#segment-script-textarea').fill(fixedIntro);
    await page.getByRole('button', { name: 'إضافة إلى الرانداون' }).click();
    await page.getByRole('button', { name: /^تحضير الحلقة/ }).click();
    await page.getByRole('button', { name: 'حفظ البنية كقالب للبرنامج', exact: true }).click();
    await expect(page.getByText(/حُفظت البنية/)).toBeVisible();
    const second = await startEpisode(`${name} الثانية`, /من قالب البرنامج/, '2037-03-09');
    expect(second.d.programId).toBe(program.id);
    expect(second.d.rundown).toHaveLength(1);
    expect(second.d.rundown[0]).toMatchObject({ title: 'افتتاحية ثابتة', durationSeconds: 60, scriptText: fixedIntro });
    expect(second.d.rundown[0].id).not.toBe((await collections()).episodes.find((row: any) => row.id === first.id).d.rundown[0].id);
  } finally {
    release();
    await page.unroute(syncPath);
    await close();
  }
});
