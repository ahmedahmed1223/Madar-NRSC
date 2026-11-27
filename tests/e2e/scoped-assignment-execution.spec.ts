import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('a scoped reporter confirms receipt and records a partial delivery visible to the manager', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const headers = { 'X-NRCS-Client': 'web' };
  const userPage = admin.page;
  try {
    await userPage.goto('/users');
    await userPage.getByPlaceholder(/ابحث بالاسم/).fill('reporter@akhbar.tv');
    await userPage.getByTitle('تعديل المستخدم').first().click();
    const form = userPage.getByRole('region', { name: /تعديل حساب/ });
    await form.getByRole('checkbox', { name: 'تخصيص دور مستقل لكل مسار' }).check();
    await form.getByLabel('دور مسار الأخبار').selectOption('PREPARER');
    await form.getByRole('button', { name: 'حفظ التعديلات' }).click();
    await expect.poll(async () => {
      const { collections } = await (await userPage.request.get('/api/v1/data')).json();
      return collections.users.find((row: { id: string }) => row.id === 'usr-6')?.d.workflowRoles;
    }).toEqual({ news: 'PREPARER' });

    const editor = await signIn(browser, 'editor@akhbar.tv');
    const reporter = await signIn(browser, 'reporter@akhbar.tv');
    const read = async () => (await (await editor.page.request.get('/api/v1/data')).json()).collections;
    try {
      const media = (await read()).media[0];
      const title = 'تغطية عاجلة بمهلة استلام';
      const id = 'browser-receipt-assignment';
      const programmeId = 'browser-excluded-programme';
      const card = {
        id, title, kind: 'NEWS', priority: 'URGENT', status: 'OPEN',
        ownerId: 'usr-2', dueAt: new Date(Date.now() + 3_600_000).toISOString(),
        mediaIds: [media.id], steps: [{ id: 'report-first', title: 'إفادة المراسل', type: 'gather',
          receiptMinutes: 30, status: 'TODO', complexity: 1, assigneeId: 'usr-6' }],
      };
      const stored = await editor.page.request.post('/api/v1/data/sync', { headers, data: { ops: [
        { c: 'productionCards', id, op: 'upsert', d: card },
        { c: 'productionCards', id: programmeId, op: 'upsert', d: { ...card, id: programmeId, kind: 'PROGRAM', steps: [] } },
      ] } });
      expect((await stored.json()).results.every((result: { ok: boolean }) => result.ok)).toBe(true);

      await reporter.page.goto(`/cards/${id}`);
      await expect(reporter.page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(reporter.page.getByText(/يلزم تأكيد الاستلام/)).toBeVisible();
      await reporter.page.getByRole('button', { name: 'بدء العمل', exact: true }).click();
      await expect(reporter.page.getByRole('status').filter({ hasText: 'يلزم تأكيد الاستلام' })).toBeVisible();
      await reporter.page.getByRole('button', { name: 'تأكيد الاستلام', exact: true }).click();
      await expect(reporter.page.getByRole('status').filter({ hasText: 'تأكد استلام المهمة' })).toBeVisible();
      await reporter.page.getByRole('button', { name: 'تسليم إفادة أولية', exact: true }).click();
      const form = reporter.page.getByRole('dialog', { name: 'تسليم إفادة أولية' });
      await form.getByLabel('الإفادة والمخرجات المتاحة').fill('الإفادة الأولية جاهزة مع المادة المصورة');
      await form.getByRole('button', { name: 'تسجيل التسليم الجزئي' }).click();
      await expect(reporter.page.getByRole('status').filter({ hasText: 'سُجّل التسليم الجزئي' })).toBeVisible();

      await editor.page.goto(`/cards/${id}`);
      await expect(editor.page.getByText('الإفادة الأولية جاهزة مع المادة المصورة', { exact: true })).toBeVisible();
      const saved = (await read()).productionCards.find((row: { id: string }) => row.id === id).d;
      expect(saved.steps[0].receiptConfirmedAt).toBeTruthy();
      expect(saved.log).toContainEqual(expect.objectContaining({ delivery: 'PARTIAL', mediaIds: [media.id], byId: 'usr-6' }));
      await reporter.page.goto(`/cards/${programmeId}`);
      const reporterData = await (await reporter.page.request.get('/api/v1/data')).json();
      expect(reporterData.collections.productionCards.some((row: { id: string }) => row.id === programmeId)).toBe(false);
      expect([...admin.errors, ...editor.errors, ...reporter.errors]).toEqual([]);
    } finally {
      await reporter.close();
      await editor.close();
    }
  } finally {
    await admin.close();
  }
});
