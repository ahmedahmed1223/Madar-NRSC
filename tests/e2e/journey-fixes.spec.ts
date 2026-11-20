import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('task draft survives browser Back and an immediate reload without saving a record', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'المهام');
  await page.getByRole('button', { name: 'تكليف بمهمة', exact: true }).click();
  await page.locator('#task-title-input').fill('مسودة مهمة محمية');
  await page.goBack();
  await page.getByRole('button', { name: 'تكليف بمهمة', exact: true }).click();
  await expect(page.locator('#task-title-input')).toHaveValue('مسودة مهمة محمية');
  page.removeAllListeners('dialog');
  page.on('dialog', dialog => void dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: 'تكليف بمهمة', exact: true }).click();
  await expect(page.locator('#task-title-input')).toHaveValue('مسودة مهمة محمية');
  await close();
});

test('task list actions have task-specific accessible names and fit a scroll region on mobile', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'المهام');
  await page.getByRole('button', { name: 'قائمة', exact: true }).click();
  await expect(page.getByRole('button', { name: /^تعديل المهمة:/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^حذف المهمة:/ }).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('region', { name: 'قائمة المهام' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await close();
});

test('task creation preserves the draft on refusal and a later status move waits for confirmation', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  const path = '**/api/v1/data/sync';
  const title = `مهمة لتجربة الحفظ ${Date.now()}`;
  const bootstrap = async () => (await (await page.request.get('/api/v1/data')).json());
  let release = () => {};
  let proposedId = '';
  try {
    await openNav(page, 'المهام');
    await page.getByRole('button', { name: 'قائمة', exact: true }).click();
    await page.getByRole('button', { name: 'تكليف بمهمة', exact: true }).click();
    await page.locator('#task-title-input').fill(title);
    const data = await bootstrap();
    await page.route(path, async route => {
      const ops = route.request().postDataJSON().ops;
      const task = ops.find((op: any) => op.c === 'tasks' && op.d?.title === title);
      if (!task) return route.continue();
      proposedId = task.id;
      await route.fulfill({ json: { rev: data.rev, dbId: data.dbId, results: ops.map((op: any) => ({
        c: op.c, id: op.id, ok: false, code: 'CONFLICT', message: 'رفض مؤقت للاختبار',
      })) } });
    });
    await page.getByRole('button', { name: 'حفظ المهمة', exact: true }).click();
    await expect(page.locator('#form-page-root').getByRole('alert')).toContainText('لم يؤكد الخادم');
    await expect(page.locator('#task-title-input')).toHaveValue(title);
    await page.unroute(path);
    await page.getByRole('button', { name: 'حفظ المهمة', exact: true }).click();
    await expect(page.locator('#task-title-input')).not.toBeVisible();
    expect((await bootstrap()).collections.tasks.filter((row: any) => row.d.title === title)).toEqual([
      expect.objectContaining({ id: proposedId }),
    ]);
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(path, async route => {
      if (route.request().postDataJSON().ops.some((op: any) => op.c === 'tasks' && op.id === proposedId)) await gate;
      await route.continue();
    });
    const status = page.getByLabel(`حالة المهمة: ${title}`, { exact: true });
    await status.selectOption('IN_PROGRESS');
    await expect(status).toBeDisabled();
    await expect(page.getByText('بانتظار تأكيد نقل المهمة', { exact: true })).toBeVisible();
    expect((await bootstrap()).collections.tasks.find((row: any) => row.id === proposedId).d.status).toBe('TODO');
    release();
    await expect(status).toBeEnabled();
    await expect(status).toHaveValue('IN_PROGRESS');
    expect((await bootstrap()).collections.tasks.find((row: any) => row.id === proposedId).d.status).toBe('IN_PROGRESS');
  } finally {
    release();
    await page.unroute(path);
    await close();
  }
});

test('on-air defaults to a current show rather than yesterday and warns on past selection', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'producer@akhbar.tv');
  await openNav(page, 'وضع الهواء');
  const select = page.getByLabel('الحلقة أو النشرة');
  const initialId = await select.inputValue();
  const oldId = await select.locator('option').evaluateAll(options => options.find(option => option.textContent?.includes('المشهد السياسي'))?.getAttribute('value'));
  expect(oldId).toBeTruthy();
  expect(initialId).not.toBe(oldId);
  await select.selectOption(oldId!);
  await expect(page.getByRole('alert')).toContainText('موعد سابق');
  expect(errors).toEqual([]);
  await close();
});

test('episode brief and script survive tab changes and reload; templates append and undo', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'producer@akhbar.tv');
  await openNav(page, 'الحلقات');
  await page.getByRole('button', { name: 'فتح مساحة العمل', exact: true }).last().click();
  const briefToggle = page.getByRole('button', { name: /ملخص الحلقة \(الفكرة/ });
  if (await briefToggle.getAttribute('aria-expanded') === 'false') await briefToggle.click();
  await page.getByLabel('فكرة الحلقة', { exact: true }).fill('فكرة محمية عند تبديل التبويب');
  await page.getByRole('button', { name: 'سكريبت المقدمة والأوتوكيو', exact: true }).click();
  const script = page.locator('#intro-script-textarea');
  await script.fill('النص الأصلي الذي يجب ألا يستبدل');
  await page.getByRole('button', { name: /نشرة الأخبار الرئيسية/ }).click();
  await expect(script).toHaveValue(/^النص الأصلي الذي يجب ألا يستبدل/);
  await page.getByRole('button', { name: 'تراجع عن تعديل النص' }).click();
  await expect(script).toHaveValue('النص الأصلي الذي يجب ألا يستبدل');
  await page.getByRole('button', { name: /^تحضير الحلقة/ }).click();
  if (await briefToggle.getAttribute('aria-expanded') === 'false') await briefToggle.click();
  await expect(page.getByLabel('فكرة الحلقة', { exact: true })).toHaveValue('فكرة محمية عند تبديل التبويب');
  page.removeAllListeners('dialog');
  page.on('dialog', dialog => void dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: 'سكريبت المقدمة والأوتوكيو', exact: true }).click();
  await expect(script).toHaveValue('النص الأصلي الذي يجب ألا يستبدل');
  expect(errors).toEqual([]);
  await close();
});

test('news button save stays in the editor like Ctrl+S and offers explicit save-and-close', async ({ browser }) => {
  const { page, errors, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'الأخبار');
  await page.locator('button[title="تحرير الخبر"]').first().click();
  await page.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click();
  await expect(page.locator('#news-headline-input')).toBeVisible();
  await expect(page.locator('header')).not.toContainText('متصل ومحفوظ');
  await page.getByRole('button', { name: 'حفظ وإغلاق', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'الأخبار', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await close();
});
