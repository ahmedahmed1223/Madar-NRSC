import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('workflow settings wait for server confirmation and reuse production configuration screens', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { viewport: { width: 390, height: 900 } });
  let releaseSave: () => void = () => {};
  const respond = new Promise<void>(resolve => { releaseSave = resolve; });
  try {
    await page.route('**/api/v1/data/sync', async route => {
      const ops = route.request().postDataJSON()?.ops || [];
      if (!ops.some((op: { c: string; d?: { taskWorkflow?: unknown } }) => op.c === 'settings' && op.d?.taskWorkflow)) return route.continue();
      const response = await route.fetch();
      await respond;
      await route.fulfill({ response });
    });
    await page.goto('/settings');
    const production = page.getByLabel('قسم الإعدادات', { exact: true });
    await production.selectOption('production');
    const panel = page.getByRole('region', { name: 'سير عمل المهام والتكليفات' });
    const review = panel.getByRole('checkbox', { name: 'اشتراط المراجعة قبل إكمال المهمة' });
    const blocked = panel.getByRole('checkbox', { name: 'اشتراط توضيح سبب التعطل' });
    const reopen = panel.getByRole('checkbox', { name: 'قصر إعادة الفتح على مديري المهام' });
    const rules = [review, blocked, reopen];
    const original = await Promise.all(rules.map(rule => rule.isChecked()));
    for (const [index, rule] of rules.entries()) await rule.setChecked(!original[index]);
    const save = panel.getByRole('button', { name: 'حفظ قواعد سير العمل' });
    await save.click();
    await expect(panel.getByRole('status')).toHaveText('بانتظار تأكيد الخادم');
    await expect(save).toBeDisabled();
    releaseSave();
    await expect(panel.getByRole('status')).toHaveText('حُفظت قواعد سير العمل');

    await page.reload();
    for (const [index, rule] of rules.entries()) await expect(rule).toBeChecked({ checked: !original[index] });
    for (const [index, rule] of rules.entries()) await rule.setChecked(original[index]);
    await save.click();
    await expect(panel.getByRole('status')).toHaveText('حُفظت قواعد سير العمل');

    await panel.getByRole('button', { name: 'إعداد أنواع خطوات التكليفات' }).click();
    await expect(page.getByText('أنواع خطوات التكليفات', { exact: true })).toBeVisible();
    await production.selectOption('production');
    await panel.getByRole('button', { name: 'فتح التكليفات والقوالب' }).click();
    await expect(page).toHaveURL(/\/cards$/);
    const cardViews = page.getByRole('combobox', { name: 'التكليفات', exact: true });
    await cardViews.selectOption('TEMPLATES');
    await expect(cardViews).toHaveValue('TEMPLATES');
  } finally {
    releaseSave();
    await close();
  }
});
