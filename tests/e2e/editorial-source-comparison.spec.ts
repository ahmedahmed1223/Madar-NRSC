import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
test.use({ actionTimeout: 15_000 });

test('source comparison never overwrites copy without confirmation and undo protects later edits', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const producer = await signIn(browser, 'producer@akhbar.tv');
  const data = await (await admin.page.request.get('/api/v1/data')).json();
  const token = String(Date.now());
  const newsId = `comparison-news-${token}`, bulletinId = `comparison-bulletin-${token}`, storyId = `comparison-story-${token}`;
  const sync = async (ops: any[]) => {
    const response = await admin.page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops } });
    const result = await response.json();
    expect(result.results.every((r: any) => r.ok), JSON.stringify(result.results)).toBe(true);
  };
  try {
    await sync([{ c: 'news', op: 'upsert', id: newsId, d: { ...data.collections.news[0].d, id: newsId, title: 'خبر مقارنة مستقل', summary: 'نص المصدر الأول', status: 'DRAFT' } }]);
    const created = await (await admin.page.request.get('/api/v1/data')).json();
    const source = created.collections.news.find((r: any) => r.id === newsId);
    await sync([
      { c: 'bulletins', op: 'upsert', id: bulletinId, d: { ...data.collections.bulletins[0].d, id: bulletinId, title: 'نشرة مقارنة مستقلة', status: 'PLANNING' } },
      { c: 'bulletinStories', op: 'upsert', id: storyId, d: { ...data.collections.bulletinStories[0].d, id: storyId, bulletinId, slug: 'قصة المقارنة', type: 'READER', newsId, newsUpdatedAt: source.d.updatedAt, newsSourceSnapshot: 'نص المصدر الأول', script: 'نص النشرة المحلي', status: 'DRAFT' } },
    ]);
    await producer.page.goto(`/bulletins/${bulletinId}`);
    await producer.page.getByRole('button', { name: 'فتح قصة المقارنة', exact: true }).click();
    await sync([{ c: 'news', op: 'upsert', id: newsId, baseV: source.v, d: { ...source.d, summary: 'نص المصدر الأحدث', updatedAt: new Date().toISOString() } }]);
    const form = producer.page.getByTestId('story-editor');
    const script = form.locator('textarea').first();
    await form.getByRole('button', { name: 'تحديث النص من الخبر', exact: true }).click();
    await expect(script).toHaveValue('نص النشرة المحلي');
    await expect(form.getByRole('region', { name: 'مقارنة نص الخبر' })).toContainText('نص المصدر الأحدث');
    await form.getByRole('button', { name: 'استبدال النص من الخبر', exact: true }).click();
    await producer.page.getByRole('alertdialog').getByRole('button', { name: 'استبدال النص', exact: true }).click();
    await expect(script).toHaveValue('نص المصدر الأحدث');
    await script.fill('تعديلات بعد الاستبدال');
    await form.getByRole('button', { name: 'تراجع عن تحديث النص', exact: true }).click();
    await producer.page.getByRole('alertdialog').getByRole('button', { name: 'إلغاء', exact: true }).click();
    await expect(script).toHaveValue('تعديلات بعد الاستبدال');
    await form.getByRole('button', { name: 'تراجع عن تحديث النص', exact: true }).click();
    await producer.page.getByRole('alertdialog').getByRole('button', { name: 'استعادة النص', exact: true }).click();
    await expect(script).toHaveValue('نص النشرة المحلي');
    await form.getByRole('button', { name: 'إغلاق', exact: true }).click();
  } finally { await producer.close(); await admin.close(); }
});
