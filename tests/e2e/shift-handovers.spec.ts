import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('outgoing editor publishes and incoming editor explicitly receives without changing work', async ({ browser }) => {
  const outgoing = await signIn(browser, 'journalist@akhbar.tv');
  const incoming = await signIn(browser, 'editor@akhbar.tv');
  try {
    const data = await (await incoming.page.request.get('/api/v1/data')).json();
    const userId = data.collections.users.find((r: any) => r.d.email === 'editor@akhbar.tv').id;
    const news = data.collections.news[0];
    const id = `2026-10-11:newsroom:EVENING:${userId}`;
    const roster = await incoming.page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [{ c: 'roster', op: 'upsert', id, d: { id, date: '2026-10-11', departmentId: 'newsroom', shift: 'EVENING', userId, userName: 'Incoming editor' } }] } });
    expect((await roster.json()).results[0].ok).toBe(true);
    await outgoing.page.goto('/roster?tab=handover');
    await outgoing.page.getByRole('button', { name: 'إنشاء تسليم' }).click();
    await outgoing.page.getByLabel('عنوان التسليم').fill('Browser shift handover');
    await outgoing.page.getByLabel('تاريخ الوردية الصادرة').fill('2026-10-11');
    await outgoing.page.getByLabel('تاريخ الوردية المستلمة').fill('2026-10-11');
    await outgoing.page.getByLabel('الوردية المستلمة', { exact: true }).selectOption('EVENING');
    await outgoing.page.getByLabel('ملاحظات القسم').fill('Follow the checked references');
    await outgoing.page.getByLabel('اختيار مرجع').selectOption(`news:${news.id}`);
    await outgoing.page.getByRole('button', { name: 'إضافة المرجع' }).click();
    await outgoing.page.getByRole('button', { name: 'حفظ المسودة', exact: true }).click();
    await expect(outgoing.page.getByRole('status').filter({ hasText: 'حُفظت المسودة' })).toBeVisible();
    await outgoing.page.getByRole('button', { name: 'نشر التسليم', exact: true }).click();
    const confirmation = outgoing.page.getByRole('alertdialog');
    await expect(confirmation).toContainText('1');
    await confirmation.getByRole('button', { name: 'نشر التسليم', exact: true }).click();
    await expect(outgoing.page.getByRole('status').filter({ hasText: 'نُشر التسليم' })).toBeVisible();
    await incoming.page.goto('/roster?tab=handover');
    await incoming.page.getByRole('button', { name: 'Browser shift handover', exact: true }).click();
    await expect(incoming.page.getByText('لم يؤكد الاستلام', { exact: false }).first()).toBeVisible();
    await incoming.page.getByRole('button', { name: 'تأكيد الاستلام', exact: true }).click();
    await expect(incoming.page.getByRole('status').filter({ hasText: 'تأكد استلام الوردية' })).toBeVisible();
    const list = await (await incoming.page.request.get('/api/v1/shift-handovers')).json();
    const handover = list.rows.find((r: any) => r.d.title === 'Browser shift handover');
    expect(handover.receipts).toHaveLength(1);
    const after = await (await incoming.page.request.get('/api/v1/data')).json();
    expect(after.collections.news.find((r: any) => r.id === news.id).v).toBe(news.v);
    await incoming.page.getByRole('button', { name: news.d.title, exact: true }).click();
    await expect(incoming.page).toHaveURL(new RegExp(`/news/${news.id}$`));
    await incoming.page.goto('/roster/handover');
    await incoming.page.getByRole('button', { name: 'Browser shift handover', exact: true }).click();
    await incoming.page.getByRole('button', { name: 'إنشاء تصحيح' }).click();
    await expect(incoming.page.getByLabel('عنوان التسليم')).toHaveValue('تصحيح: Browser shift handover');
    await expect(incoming.page.getByLabel('عنوان التسليم')).toBeFocused();
  } finally { await outgoing.close(); await incoming.close(); }
});

for (const email of ['producer@akhbar.tv', 'crew@akhbar.tv']) test(`${email} can create a departmental draft`, async ({ browser }) => {
  const session = await signIn(browser, email);
  try {
    await session.page.goto('/roster?tab=handover');
    await session.page.getByRole('button', { name: 'إنشاء تسليم' }).click();
    await session.page.getByLabel('عنوان التسليم').fill(`Draft ${email}`);
    await session.page.getByRole('button', { name: 'حفظ المسودة', exact: true }).click();
    await expect(session.page.getByRole('status').filter({ hasText: 'حُفظت المسودة' })).toBeVisible();
    expect(session.errors).toEqual([]);
  } finally { await session.close(); }
});
