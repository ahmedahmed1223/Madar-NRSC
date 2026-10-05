import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('episode editing is read-only for a colleague until the owner leaves the workspace', async ({ browser }) => {
  const owner = await signIn(browser, 'producer@akhbar.tv');
  const colleague = await signIn(browser, 'editor@akhbar.tv');
  const ownerId = (await (await owner.page.request.get('/api/v1/auth/me')).json()).user.id;
  try {
    await openNav(owner.page, 'الحلقات');
    await owner.page.getByRole('button', { name: 'فتح مساحة العمل', exact: true }).last().click();
    const path = new URL(owner.page.url()).pathname;
    const episodeId = path.split('/').pop()!;
    await expect.poll(async () => {
      const data = await (await owner.page.request.get('/api/v1/data')).json();
      return data.collections.editLocks.some((row: any) => row.id === `episodes:${episodeId}` && row.d.userId === ownerId);
    }).toBe(true);
    await colleague.page.goto(path);
    await expect(colleague.page.getByText(/هذه الحلقة قيد التحرير الآن لدى/)).toBeVisible();
    await openNav(owner.page, 'الرئيسية');
    await expect.poll(async () => {
      const data = await (await owner.page.request.get('/api/v1/data')).json();
      return data.collections.editLocks.some((row: any) => row.id === `episodes:${episodeId}` && row.d.userId === ownerId);
    }).toBe(false);
    await colleague.page.reload();
    await expect(colleague.page.getByText(/هذه الحلقة قيد التحرير الآن لدى/)).toHaveCount(0);
    expect(owner.errors).toEqual([]);
    expect(colleague.errors).toEqual([]);
  } finally {
    await owner.close();
    await colleague.close();
  }
});
