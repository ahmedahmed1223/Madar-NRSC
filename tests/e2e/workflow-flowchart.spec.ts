import { expect, test } from '@playwright/test';
import { openSettingsSection, signIn } from './helpers';

test('workflow graphs follow rules and connect template and assignment nodes to their management controls', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  try {
    await page.goto('/settings');
    await openSettingsSection(page, 'قوائم الإنتاج');
    const panel = page.getByRole('region', { name: 'سير عمل المهام والتكليفات' });
    const graph = page.getByRole('region', { name: 'مخطط سير عمل المهام' });
    await expect(graph).toBeVisible();
    await page.screenshot({ path: 'test-results/workflow-status-desktop-light.png', animations: 'disabled' });
    const review = panel.getByRole('checkbox', { name: 'اشتراط المراجعة قبل إكمال المهمة' });
    const originalReview = await review.isChecked();
    await review.setChecked(false);
    await expect(graph.getByTestId('workflow-edge-TODO-COMPLETED')).toHaveCount(1);
    await review.setChecked(true);
    await expect(graph.getByTestId('workflow-edge-TODO-COMPLETED')).toHaveCount(0);
    await expect(graph.getByTestId('workflow-edge-IN_REVIEW-COMPLETED')).toHaveCount(1);
    await review.setChecked(originalReview);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await graph.getByRole('button', { name: 'القائمة', exact: true }).click();
    await page.getByRole('button', { name: /المظهر:/ }).first().click();
    await page.getByRole('menuitemradio', { name: /^ليلي/ }).click();
    await page.screenshot({ path: 'test-results/workflow-status-mobile-dark.png', fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 900 });

    const card = { id: 'workflow-graph-card', title: 'تكليف مخطط الاختبار', kind: 'REPORT', priority: 'NORMAL', status: 'OPEN', log: [], steps: [
      { id: 'first', type: 'gather', status: 'TODO', complexity: 1 },
      { id: 'second', type: 'edit', status: 'TODO', complexity: 1 },
    ] };
    const created = await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [{ c: 'productionCards', id: card.id, op: 'upsert', d: card }] } });
    expect((await created.json()).results[0].ok).toBe(true);
    await page.goto('/cards');
    await page.getByRole('tab', { name: /القوالب/ }).click();
    await page.getByRole('region', { name: 'قوالب سير العمل' }).getByRole('button', { name: 'تعديل', exact: true }).first().click();
    const templateGraph = page.getByRole('region', { name: 'مخطط قالب سير العمل' });
    await expect(templateGraph).toBeVisible();
    const stepNodes = templateGraph.locator('button[data-workflow-node^="step:"]');
    const firstId = await stepNodes.first().getAttribute('data-workflow-node');
    const secondId = await stepNodes.nth(1).getAttribute('data-workflow-node');
    await stepNodes.nth(1).click();
    const editor = templateGraph.getByRole('group', { name: 'تحرير الخطوة في المخطط' });
    await editor.getByLabel('اسم الخطوة في المخطط').fill('تحرير عاجل');
    await expect(stepNodes.nth(1)).toContainText('تحرير عاجل');
    const dependency = editor.getByRole('group', { name: 'التبعيات المطلوبة' }).getByRole('combobox').first();
    await dependency.selectOption('');
    const outgoing = templateGraph.getByTestId(`workflow-node-${firstId}-output`);
    const incoming = templateGraph.getByTestId(`workflow-node-${secondId}-input`);
    await outgoing.scrollIntoViewIfNeeded();
    const from = await outgoing.boundingBox();
    const to = await incoming.boundingBox();
    expect(from).not.toBeNull();
    expect(to).not.toBeNull();
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(dependency).toHaveValue('DONE');
    await dependency.selectOption('PARTIAL');
    await expect(templateGraph.getByTestId(`workflow-edge-${firstId}-${secondId}`)).toHaveCount(1);
    await expect(templateGraph.getByRole('list', { name: 'تبعيات الخطوة' })).toContainText('بعد إفادة');
    await stepNodes.first().click();
    await editor.getByRole('group', { name: 'التبعيات المطلوبة' }).getByRole('combobox').first().selectOption('DONE');
    await expect(templateGraph.getByRole('alert')).toContainText('توجد حلقة');
    await expect(templateGraph.getByTestId(`workflow-edge-${secondId}-${firstId}`)).toHaveCount(0);
    await stepNodes.nth(1).click();
    await templateGraph.getByRole('button', { name: 'إدارة الخطوة', exact: true }).click();
    await expect(page.getByLabel('نوع المهمة 2', { exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'إلغاء', exact: true }).click();

    await page.goto(`/cards/${card.id}`);
    const cardGraph = page.getByRole('region', { name: 'مخطط تنفيذ التكليف' });
    await expect(cardGraph).toBeVisible();
    await page.screenshot({ path: 'test-results/workflow-card-desktop-dark.png', animations: 'disabled' });
    await cardGraph.locator('button[data-workflow-node^="step:"]').first().click();
    await cardGraph.getByRole('button', { name: 'إدارة الخطوة', exact: true }).click();
    await expect(page.getByTestId(`card-step-${card.steps[0].id}`)).toBeFocused();
  } finally {
    await close();
  }
});
