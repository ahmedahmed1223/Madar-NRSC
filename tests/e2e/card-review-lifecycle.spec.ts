import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('a programme writer resubmits work returned by the reviewer with a new deadline', async ({ browser }) => {
  const editor = await signIn(browser, 'editor@akhbar.tv');
  const writer = await signIn(browser, 'journalist@akhbar.tv');
  const id = 'browser-programme-review';
  const url = '/cards/' + id;
  const card = {
    id, kind: 'PROGRAM', title: 'مراجعة محاور الحلقة', ownerId: 'usr-2', status: 'OPEN', priority: 'NORMAL',
    steps: [
      { id: 'copy', type: 'edit', status: 'IN_PROGRESS', complexity: 1, assigneeId: 'usr-3', reviewerId: 'usr-2' },
      { id: 'translation', type: 'translate', status: 'TODO', complexity: 1, optional: true },
    ],
  };
  try {
    const saved = await editor.page.request.post('/api/v1/data/sync', {
      headers: { 'X-NRCS-Client': 'web' },
      data: { ops: [{ c: 'productionCards', op: 'upsert', d: card, id }] },
    });
    expect((await saved.json()).results[0]).toMatchObject({ ok: true });
    const submit = async (note: string) => {
      await writer.page.goto(url);
      await writer.page.getByRole('button', { name: 'إرسال للمراجعة', exact: true }).click();
      await writer.page.getByLabel('ملاحظة التسليم: ما اكتمل وما ينقص؟', { exact: true }).fill(note);
      await writer.page.getByRole('button', { name: 'إرسال المخرجات للمراجعة' }).click();
      await expect(writer.page.getByText(note, { exact: true })).toBeVisible();
    };
    await submit('محاور المقابلة الأولى');
    await editor.page.goto(url);
    await expect(editor.page.getByRole('button', { name: 'إغلاق بعد البث' })).toBeDisabled();
    await editor.page.getByRole('button', { name: 'إعادة الخطوة للتعديل' }).click();
    await editor.page.getByLabel('سبب الإعادة', { exact: true }).fill('أضف سؤال المتابعة');
    await editor.page.getByLabel('الموعد الجديد', { exact: true }).fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 16));
    await editor.page.getByRole('button', { name: 'تأكيد الإعادة' }).click();
    await expect(editor.page.getByText('أُعيدت الخطوة للتعديل بالموعد الجديد', { exact: true })).toBeVisible();
    await submit('أضفت سؤال المتابعة إلى المحاور');
    await editor.page.goto(url);
    await expect(editor.page.getByText('محاور المقابلة الأولى', { exact: true })).toBeVisible();
    await expect(editor.page.getByText('أضفت سؤال المتابعة إلى المحاور', { exact: true })).toBeVisible();
    await editor.page.getByRole('button', { name: 'قبول المخرجات' }).click();
    await expect(editor.page.getByRole('button', { name: 'إغلاق بعد البث' })).toBeEnabled();
    expect([...editor.errors, ...writer.errors]).toEqual([]);
  } finally {
    await Promise.all([editor.close(), writer.close()]);
  }
});
