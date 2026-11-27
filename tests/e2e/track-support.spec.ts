import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('news requester sends a support request to a programme manager and sees the recorded decision', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const owner = await signIn(browser, 'journalist@akhbar.tv');
  const chief = await signIn(browser, 'producer@akhbar.tv');
  const preparer = await signIn(browser, 'media@akhbar.tv');
  const headers = { 'X-NRCS-Client': 'web' };
  const getData = async () => (await (await admin.page.request.get('/api/v1/data')).json()).collections;
  const users = (await getData()).users as { id: string; v: number; d: any }[];
  const fixtures = [
    { email: 'journalist@akhbar.tv', roles: { news: 'PREPARER' } },
    { email: 'producer@akhbar.tv', roles: { programmes: 'MANAGER' } },
    { email: 'media@akhbar.tv', roles: { programmes: 'PREPARER' } },
  ].map(({ email, roles }) => ({ row: users.find(row => row.d.email === email)!, roles }));
  const write = async (ops: object[]) => {
    const reply = await admin.page.request.post('/api/v1/data/sync', { headers, data: { ops } });
    expect((await reply.json()).results).toEqual(ops.map(() => expect.objectContaining({ ok: true })));
  };
  const title = 'مساندة إعداد المقابلة الميدانية';
  try {
    await write(fixtures.map(({ row, roles }) => ({ c: 'users', op: 'upsert', id: row.id, baseV: row.v,
      d: { ...row.d, stationId: fixtures[0].row.d.stationId, workflowRoles: roles } })));
    const id = 'crd-browser-source-track';
    await write([{ c: 'productionCards', op: 'upsert', id, d: { id, title: 'تكليف المقابلة الميدانية', kind: 'REPORT',
      priority: 'NORMAL', status: 'OPEN', ownerId: fixtures[0].row.id, steps: [{ id: 'prepare', status: 'TODO', type: 'gather', complexity: 1 }] } }]);
    await owner.page.goto('/requests');
    await owner.page.getByRole('button', { name: 'طلب جديد' }).click();
    await owner.page.getByRole('radio', { name: 'مساندة إعداد البرامج' }).click();
    await owner.page.getByLabel('التكليف الأصلي').selectOption(id);
    await owner.page.getByLabel('مدير إعداد المسار المستلم').selectOption(fixtures[1].row.id);
    await owner.page.locator('#request-title').fill(title);
    await owner.page.getByRole('button', { name: 'إرسال الطلب' }).click();
    await expect(owner.page.getByText('أُرسل طلب المساندة إلى مدير الإعداد')).toBeVisible();
    const requests = (await (await owner.page.request.get('/api/v1/data')).json()).collections.requests;
    const requestId = requests.find((row: any) => row.d.title === title).id;
    const path = `/requests/${requestId}`;
    await chief.page.goto(path);
    await chief.page.getByLabel('إعادة توجيه المساندة').selectOption(fixtures[2].row.id);
    await chief.page.getByRole('button', { name: 'تأكيد إعادة التوجيه' }).click();
    await expect(chief.page.getByText('أُعيد توجيه طلب المساندة', { exact: true })).toBeVisible();
    await preparer.page.goto(path);
    await preparer.page.getByRole('button', { name: 'استلام الطلب' }).click();
    await expect(preparer.page.getByText('استلمت الطلب', { exact: true })).toBeVisible();
    await preparer.page.getByRole('button', { name: 'تم الإنجاز' }).click();
    await preparer.page.getByRole('alertdialog').getByRole('button', { name: 'تأكيد الإنجاز' }).click();
    await expect(preparer.page.getByText('أُنجز الطلب', { exact: true })).toBeVisible();
    await owner.page.goto(path);
    await owner.page.getByText('سجل المساندة', { exact: true }).click();
    await expect(owner.page.getByText(new RegExp('أُعيد التوجيه إلى ' + fixtures[2].row.d.fullName))).toBeVisible();
    await expect(owner.page.getByText('منجز', { exact: true })).toBeVisible();
  } finally {
    const current = (await getData()).users;
    await write(fixtures.map(({ row }) => ({ c: 'users', op: 'upsert', id: row.id, d: row.d, baseV: current.find((entry: any) => entry.id === row.id).v })));
    await Promise.all([owner.close(), chief.close(), preparer.close(), admin.close()]);
  }
});
