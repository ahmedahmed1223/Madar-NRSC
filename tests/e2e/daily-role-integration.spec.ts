import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('a crew handover alert opens the exact record and reading does not acknowledge it', async ({ browser }) => {
  const editor = await signIn(browser, 'editor@akhbar.tv');
  const crew = await signIn(browser, 'crew@akhbar.tv', { viewport: { width: 390, height: 900 } });
  const id = 'daily-role-alert-handover';
  const path = `/api/v1/shift-handovers/${id}`;
  const date = '2026-10-12';
  const headers = { 'X-NRCS-Client': 'web' };

  try {
    const { user } = await (await crew.page.request.get('/api/v1/auth/me')).json();
    const rosterId = `${date}:newsroom:EVENING:${user.id}`;
    const roster = await editor.page.request.post('/api/v1/data/sync', { headers, data: { ops: [{
      c: 'roster', op: 'upsert', id: rosterId,
      d: { id: rosterId, date, departmentId: 'newsroom', shift: 'EVENING', userId: user.id, userName: user.fullName },
    }] } });
    expect((await roster.json()).results[0].ok).toBe(true);

    const created = await editor.page.request.post('/api/v1/shift-handovers', { headers, data: {
      id, schemaVersion: 1, departmentId: 'newsroom', sourceDate: date, sourceShift: 'MORNING',
      recipientDate: date, recipientShift: 'EVENING', title: 'تسليم الوردية من الإشعار', note: '', references: [],
    } });
    expect(created.ok()).toBe(true);
    const draft = (await created.json()).row;
    const published = await editor.page.request.post(`${path}/publish`, { headers, data: { baseV: draft.v } });
    expect(published.ok()).toBe(true);

    const { collections } = await (await crew.page.request.get('/api/v1/data')).json();
    const target = `/roster/handover/${id}`;
    expect(collections.notifications.some((row: { d: { linkUrl?: string } }) => row.d.linkUrl === target)).toBe(true);
    await crew.page.goto(target);
    await expect(crew.page.getByRole('dialog', { name: 'تسليم الوردية من الإشعار' })).toBeVisible();
    await expect(crew.page).toHaveURL(new RegExp(`${target}$`));
    expect((await (await crew.page.request.get(path)).json()).row.receipts).toEqual([]);

    await crew.page.getByRole('button', { name: 'تأكيد الاستلام', exact: true }).click();
    await expect(crew.page.getByRole('status').filter({ hasText: 'تأكد استلام الوردية' })).toBeVisible();
    const receipt = (await (await crew.page.request.get(path)).json()).row.receipts;
    expect(receipt.map((row: { userId: string }) => row.userId)).toEqual([user.id]);
  } finally {
    await crew.close();
    await editor.close();
  }
});

test('the direct system monitor link keeps the existing permission boundary', async ({ browser }) => {
  const administrator = await signIn(browser, 'admin@akhbar.tv');
  const reporter = await signIn(browser, 'reporter@akhbar.tv');
  try {
    await administrator.page.goto('/settings/monitor');
    await expect(administrator.page.getByRole('region', { name: 'مراقبة النظام' })).toBeVisible();
    await expect(administrator.page).toHaveURL(/\/settings\/monitor$/);
    await administrator.page.getByRole('navigation', { name: 'أقسام الإعدادات' }).getByRole('button', { name: /المؤسسة والفريق/ }).click();
    await expect(administrator.page).toHaveURL(/\/settings$/);
    await administrator.page.goBack();
    await expect(administrator.page.getByRole('region', { name: 'مراقبة النظام' })).toBeVisible();

    await reporter.page.goto('/settings/monitor');
    await expect(reporter.page.locator('main')).toBeVisible();
    await expect(reporter.page.getByRole('region', { name: 'مراقبة النظام' })).toHaveCount(0);
    expect((await reporter.page.request.get('/api/v1/admin/overview')).status()).toBe(403);
  } finally {
    await reporter.close();
    await administrator.close();
  }
});
