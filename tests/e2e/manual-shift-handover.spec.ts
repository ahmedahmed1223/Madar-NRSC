import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('hands an open assignment to a named colleague outside the roster', async ({ browser }) => {
  const outgoing = await signIn(browser, 'journalist@akhbar.tv');
  const incoming = await signIn(browser, 'editor@akhbar.tv');
  try {
    const { page } = incoming;
    const recipientId = (await (await page.request.get('/api/v1/auth/me')).json()).user.id;
    const cardId = 'crd-manual-handover';
    const card = { id: cardId, title: 'متابعة تقرير النشرة الليلية', kind: 'REPORT', status: 'OPEN', priority: 'NORMAL',
      steps: [{ id: 'gather', type: 'gather', complexity: 1, status: 'BLOCKED', dueAt: '2035-12-12T14:00:00Z', blockedReason: 'انتظار نسخة المقابلة' }],
      log: [{ id: 'field', kind: 'NOTE', text: 'اكتمل التصوير الميداني' }] };
    const sync = await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' },
      data: { ops: [{ c: 'productionCards', op: 'upsert', id: cardId, d: card }] } });
    expect((await sync.json()).results[0].ok).toBe(true);
    await outgoing.page.goto('/roster/handover');
    await outgoing.page.getByRole('button', { name: 'إنشاء تسليم' }).click();
    await outgoing.page.getByLabel('عنوان التسليم').fill('تسليم فردي للمحرر المناوب');
    await outgoing.page.getByLabel('تاريخ الوردية المستلمة').fill('2035-12-12');
    await outgoing.page.getByLabel('مستلم التسليم').selectOption(recipientId);
    await outgoing.page.getByLabel('اختيار مرجع').selectOption(`productionCards:${cardId}`);
    await outgoing.page.getByRole('button', { name: 'إضافة المرجع' }).click();
    await outgoing.page.getByRole('button', { name: 'حفظ المسودة' }).click();
    await outgoing.page.getByRole('button', { name: 'نشر التسليم', exact: true }).click();
    await outgoing.page.getByRole('alertdialog').getByRole('button', { name: 'نشر التسليم' }).click();
    await expect(outgoing.page.getByText('نُشر التسليم على الخادم')).toBeVisible();
    await page.goto('/roster/handover');
    await page.getByRole('button', { name: 'تسليم فردي للمحرر المناوب' }).click();
    await expect(page.getByText('اكتمل التصوير الميداني')).toBeVisible();
    await expect(page.getByText('أقرب موعد', { exact: false })).toBeVisible();
    await expect(page.getByText('انتظار نسخة المقابلة', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'تأكيد الاستلام' }).click();
    await expect(page.getByText('تأكد استلام الوردية على الخادم')).toBeVisible();
    await page.getByRole('button', { name: card.title }).click();
    await expect(page).toHaveURL(new RegExp(`/cards/${cardId}$`));
  } finally {
    await outgoing.close();
    await incoming.close();
  }
});
