import { expect, type Browser, type Page } from '@playwright/test';
import { openNav, signIn } from './helpers';

const title = 'حلقة مناوبة تجريبية';
const script = 'نفتح هذه الحلقة بسؤال عن استعدادات الاستديو وتنسيق تسليم المواد.';
const assignment = 'تجهيز افتتاحية الحلقة التجريبية';
const blocker = 'تأخرت نسخة الافتتاحية';
const data = async (page: Page) => (await (await page.request.get('/api/v1/data')).json()).collections;

export async function prepareProgram(browser: Browser) {
  const manager = await signIn(browser, 'admin@akhbar.tv');
  const reporter = await signIn(browser, 'reporter@akhbar.tv', { viewport: { width: 390, height: 844 } });
  const { page } = manager;
  try {
    await openNav(page, 'الحلقات');
    await page.getByRole('button', { name: 'إعداد حلقة جديدة' }).click();
    await page.getByRole('radio', { name: /حلقة فارغة/ }).click();
    await page.locator('#episode-title-input').fill(title);
    await page.getByLabel('مقدمة ووصف الحلقة').fill('فكرة الحلقة هي عرض تجربة تسليم المواد إلى الاستديو.');
    await page.getByLabel('تاريخ البث المقرر').fill('2037-01-15');
    await page.getByLabel('المدة (دقيقة)', { exact: true }).fill('1');
    await page.getByRole('button', { name: 'بدء إعداد الحلقة' }).click();
    let episodeId = '';
    await expect.poll(async () => {
      episodeId = (await data(page)).episodes.find((row: any) => row.d.title === title)?.id;
      return episodeId;
    }).toBeTruthy();

    await openNav(page, 'التكليفات');
    await page.getByRole('button', { name: 'تكليف حر', exact: true }).click();
    await page.getByLabel('عنوان المادة *').fill(assignment);
    await page.getByLabel('نوع المادة', { exact: true }).selectOption('PROGRAM');
    await page.getByLabel(/المادة في غرفة الأخبار/).selectOption(`episode:${episodeId}`);
    const removeStep = page.getByRole('button', { name: 'حذف المهمة', exact: true });
    while (await removeStep.count() > 1) await removeStep.last().click();
    await page.getByLabel('المكلف', { exact: true }).selectOption('u:usr-6');
    await page.getByRole('button', { name: 'إنشاء التكليف', exact: true }).click();
    await expect(page.getByText('أُنشئ التكليف ووصل التنبيه للمعنيين')).toBeVisible();
    const matches = (await data(page)).productionCards.filter((row: any) => row.d.title === assignment);
    expect(matches).toHaveLength(1);
    const cardId = matches[0].id;
    await reporter.page.goto(`/cards/${cardId}`);
    await reporter.page.getByRole('button', { name: 'متعطلة', exact: true }).click();
    await reporter.page.getByLabel('ما سبب التعطل وما المطلوب لحله؟').fill(blocker);
    await reporter.page.getByRole('button', { name: 'تسجيل التعطل' }).click();
    await page.goto('/cards');
    await page.getByRole('tab', { name: /متابعة اليوم/ }).click();
    await expect(page.getByText(new RegExp(blocker)).first()).toBeVisible();
    await page.getByRole('button', { name: new RegExp(assignment) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/cards/${cardId}$`));
    await page.getByRole('button', { name: 'إعادة الإسناد', exact: true }).click();
    await page.getByLabel(/^إسناد «/).selectOption('usr-3');
    await page.getByRole('button', { name: 'تأكيد الإسناد' }).click();
    await expect.poll(async () => (await data(page)).productionCards.find((row: any) => row.id === cardId).d.steps[0])
      .toMatchObject({ assigneeId: 'usr-3', status: 'IN_PROGRESS' });
    const assignee = await signIn(browser, 'journalist@akhbar.tv');
    try {
      await assignee.page.goto(`/cards/${cardId}`);
      await expect(assignee.page.getByText('مهمتي', { exact: true })).toBeVisible();
      await assignee.page.getByRole('button', { name: 'تم الإنجاز' }).click();
      await assignee.page.getByLabel('ملاحظة التسليم: ما اكتمل وما ينقص؟').fill('النص جاهز للكنترول.');
      await assignee.page.getByRole('button', { name: 'تأكيد الإنجاز والتسليم' }).click();
      await expect.poll(async () => (await data(page)).productionCards.find((row: any) => row.id === cardId).d.steps[0].status).toBe('DONE');
    } finally { await assignee.close(); }

    await page.goto(`/episodes/${episodeId}`);
    const status = page.getByLabel('حالة الحلقة', { exact: true });
    await status.selectOption('READY_FOR_BROADCAST');
    await expect(page.getByRole('alertdialog')).toContainText('لا يمكن اعتماد حلقة بلا فقرات للبث');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'مراجعة الرانداون', exact: true }).click();
    await page.getByRole('button', { name: 'إضافة فقرة', exact: true }).click();
    await page.locator('#segment-title-input').fill('افتتاحية الحلقة');
    await page.getByRole('button', { name: 'مقدمة / شارة', exact: true }).click();
    await page.locator('#segment-duration-input').fill('01:00');
    await page.locator('#segment-script-textarea').fill(script);
    await page.getByRole('button', { name: 'إضافة إلى الرانداون' }).click();
    await expect.poll(async () => (await data(page)).episodes.find((row: any) => row.id === episodeId).d.rundown[0]?.scriptText).toBe(script);
    const syncPath = '**/api/v1/data/sync';
    let release = () => {};
    const confirmation = new Promise<void>((resolve) => { release = resolve; });
    await page.route(syncPath, async (route) => {
      if (route.request().postDataJSON().ops.some((op: any) => op.c === 'episodes' && op.id === episodeId && op.d?.status === 'READY_FOR_BROADCAST')) {
        await confirmation;
      }
      await route.continue();
    });
    try {
      await status.selectOption('READY_FOR_BROADCAST');
      await expect(status).toBeDisabled();
      await expect(status).toHaveAttribute('aria-busy', 'true');
    } finally { release(); }
    await expect.poll(async () => (await data(page)).episodes.find((row: any) => row.id === episodeId).d.status).toBe('READY_FOR_BROADCAST');
    await expect(status).toBeEnabled();
    await page.unroute(syncPath);
    expect([...manager.errors, ...reporter.errors]).toEqual([]);
    return episodeId;
  } finally { await Promise.all([manager.close(), reporter.close()]); }
}

export async function airProgram(browser: Browser, control: Page, episodeId: string) {
  const presenter = await signIn(browser, 'presenter@akhbar.tv');
  const crew = await signIn(browser, 'crew@akhbar.tv');
  try {
    await openNav(control, 'وضع الهواء');
    await control.getByLabel('الحلقة أو النشرة', { exact: true }).selectOption(episodeId);
    await control.getByRole('button', { name: 'بدء البث', exact: true }).click();
    await expect.poll(async () => (await data(control)).onAir.find((row: any) => row.id === episodeId)?.d.status).toBe('LIVE');
    await Promise.all([presenter, crew].map(async ({ page }) => {
      await openNav(page, 'شاشة الاستديو');
      await page.getByLabel('الحلقة', { exact: true }).selectOption(episodeId);
      await page.getByRole('radio', { name: 'نص المذيع', exact: true }).check();
      await expect(page.getByRole('region', { name: 'نص المذيع على الهواء' })).toContainText(script);
    }));
    await control.getByRole('button', { name: 'إنهاء البث', exact: true }).click();
    await control.getByRole('alertdialog').getByRole('button', { name: 'تأكيد', exact: true }).click();
    await expect.poll(async () => (await data(control)).episodes.find((row: any) => row.id === episodeId)?.d.status).toBe('BROADCASTED');
    expect([...presenter.errors, ...crew.errors]).toEqual([]);
  } finally { await Promise.all([presenter.close(), crew.close()]); }
}
