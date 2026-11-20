import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('a target bulletin accumulates selected drafts from two source bulletins', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  const data = async () => (await page.request.get('/api/v1/data')).json();
  const { collections } = await data();
  const base = collections.bulletins[0].d;
  const prefix = `bul-copy-${Date.now()}`;
  const sourceIds = [`${prefix}-a`, `${prefix}-b`];
  const target = `${prefix}-dest`;
  const labels = ['افتتاحية النشرة الأولى', 'فقرة من النشرة الثانية'];
  const ops = [...sourceIds, target].map(id => ({
    c: 'bulletins', op: 'upsert', id, d: { ...base, id, title: id, status: 'PLANNING' },
  }));
  const stories = sourceIds.map((bulletinId, index) => {
    const id = `${bulletinId}-story`;
    return { c: 'bulletinStories', op: 'upsert', id, d: {
      id, bulletinId, rank: 1000, type: 'READER', slug: labels[index], script: `نص المصدر رقم ${index + 1}`, status: 'DRAFT',
    } };
  });
  const seed = await page.request.post('/api/v1/data/sync', {
    headers: { 'X-NRCS-Client': 'web' }, data: { ops: [...ops, ...stories] },
  });
  expect((await seed.json()).results).toEqual([...ops, ...stories].map(() => expect.objectContaining({ ok: true })));
  try {
    await page.goto(`/bulletins/${target}`);
    const form = page.locator('#form-page-root');
    await page.getByRole('button', { name: 'من نشرة أخرى', exact: true }).click();
    for (const [index, sourceId] of sourceIds.entries()) {
      await form.getByLabel('النشرة المصدر').selectOption(sourceId);
      await form.getByRole('checkbox', { name: new RegExp(labels[index]) }).check();
    }
    const preview = form.getByRole('region', { name: 'معاينة القصص المحددة' });
    await expect(preview.getByRole('listitem')).toHaveCount(2);
    await expect(preview).toContainText('المدة بعد الإضافة');
    await form.getByRole('button', { name: /إضافة.*للنشرة/ }).click();
    for (const label of labels) {
      await expect(page.getByRole('button', { name: `فتح ${label}`, exact: true })).toBeVisible();
    }
    await expect(form.getByLabel('النشرة المصدر')).not.toBeVisible();
    const current = (await data()).collections.bulletinStories;
    const copied = current.filter((row: any) => row.d.bulletinId === target).sort((a: any, b: any) => a.d.rank - b.d.rank);
    expect(copied.map((row: any) => row.d.slug)).toEqual(labels);
    for (const [index, row] of copied.entries()) {
      expect(row.id).not.toBe(stories[index].id);
      expect(row.d).toMatchObject({ status: 'DRAFT', script: stories[index].d.script, sourceStoryId: stories[index].id });
      expect(current.find((item: any) => item.id === stories[index].id).d.bulletinId).toBe(sourceIds[index]);
    }
    await page.reload();
    await page.getByRole('button', { name: 'من نشرة أخرى', exact: true }).click();
    await form.getByLabel('النشرة المصدر').selectOption(sourceIds[0]);
    await expect(form.getByRole('checkbox', { name: new RegExp(labels[0]) })).toBeDisabled();
    await form.getByRole('button', { name: 'إلغاء', exact: true }).click();
  } finally {
    await close();
  }
});
