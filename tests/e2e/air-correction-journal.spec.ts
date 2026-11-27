import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

const headers = { 'X-NRCS-Client': 'web' };

test('the controller sees deferred material and saves an aired correction request in AsRun', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const { page } = admin;
  try {
    const id = `air-correction-${Date.now()}`;
    const title = `نشرة التصحيح ${id}`;
    const aired = { id: `${id}-aired`, title: 'المادة التي أُذيعت' };
    const deferred = { id: `${id}-deferred`, title: 'مادة مؤجلة للمناوبة التالية' };
    const initial = await (await page.request.get('/api/v1/data')).json();
    const sync = async (ops: object[]) => {
      const response = await page.request.post('/api/v1/data/sync', { headers, data: { ops } });
      expect(response.ok()).toBe(true);
      const { results } = await response.json();
      expect(results).toHaveLength(ops.length);
      for (const result of results) expect(result.ok, result.message || result.code).toBe(true);
      return results;
    };

    const editorId = initial.collections.users.find((row: { d: { email?: string } }) => row.d.email === 'admin@akhbar.tv')?.id;
    expect(editorId).toBeTruthy();
    const [, { row: draft }] = await sync([
      { c: 'bulletins', op: 'upsert', id, d: { ...initial.collections.bulletins[0].d, id, title, editorId, status: 'PLANNING', approvalSteps: [] } },
      ...[aired, deferred].map((story, index) => ({
        c: 'bulletinStories', op: 'upsert', id: story.id,
        d: { id: story.id, bulletinId: id, slug: story.title, script: 'نص اختباري معتمد للبث', type: 'READER',
          status: 'DRAFT', rank: (index + 1) * 1000, floated: story.id === deferred.id },
      })),
    ]);
    const [{ row: submitted }] = await sync([{ c: 'bulletinStories', op: 'upsert', id: aired.id, baseV: draft.v, d: { ...draft.d, status: 'READY' } }]);
    const [{ row: approved }] = await sync([{ c: 'bulletinStories', op: 'upsert', id: aired.id, baseV: submitted.v, d: { ...submitted.d, status: 'APPROVED' } }]);
    expect(approved.d.status).toBe('APPROVED');
    const live = { id, episodeId: id, status: 'LIVE', currentSegmentId: aired.id };
    await sync([{ c: 'onAir', op: 'upsert', id, d: live }]);
    const running = await (await page.request.get('/api/v1/data')).json();
    const version = running.collections.onAir.find((row: { id: string; v: number }) => row.id === id)?.v;
    expect(version).toBeGreaterThan(0);
    await sync([{ c: 'onAir', op: 'upsert', id, baseV: version, d: { ...live, status: 'ENDED' } }]);

    const openRun = async () => {
      await page.getByRole('tab', { name: 'سجل البث الفعلي' }).click();
      const run = page.getByRole('region', { name: new RegExp(title) });
      await expect(run).toBeVisible();
      return run;
    };
    await page.goto(`/on-air/${id}`);
    const run = await openRun();
    await expect(run.getByRole('table').getByText(aired.title, { exact: true })).toBeVisible();
    const omissions = run.getByRole('region', { name: 'مواد لم تُذع' });
    await expect(omissions.getByText(deferred.title, { exact: true })).toBeVisible();
    await expect(omissions.getByText('مؤجلة', { exact: true })).toBeVisible();

    await run.getByText('يلزم تصحيح على الهواء', { exact: true }).click();
    await expect(run.getByLabel('الفقرة المذاعة')).toHaveValue(aired.id);
    await expect(run.getByRole('option', { name: deferred.title })).toHaveCount(0);
    const reason = 'تصحيح اسم الموقع قبل النشرة التالية';
    await run.getByLabel('سبب طلب التصحيح').fill(reason);
    await run.getByRole('button', { name: 'سجّل طلب التصحيح', exact: true }).click();
    await expect(run.getByRole('status')).toHaveText('سُجّل طلب التصحيح في أرشيف البث.');
    await expect(run.getByRole('region', { name: 'طلبات التصحيح على الهواء' }).getByText(reason, { exact: true })).toBeVisible();

    await page.reload();
    const reopened = await openRun();
    await expect(reopened.getByRole('region', { name: 'طلبات التصحيح على الهواء' }).getByText(reason, { exact: true })).toBeVisible();
  } finally {
    await admin.close();
  }
});
