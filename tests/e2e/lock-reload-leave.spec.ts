import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('reloading an episode you hold and leaving at once releases the lock', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  const me = (await (await page.request.get('/api/v1/auth/me')).json()).user.id;
  const locks = async () => ((await (await page.request.get('/api/v1/data')).json()).collections.editLocks || [])
    .filter((row: any) => row.d.userId === me && Date.parse(row.d.expiresAt) > Date.now()).map((row: any) => row.id);
  await page.goto('/episodes/ep-101');
  await expect.poll(locks).toEqual(['episodes:ep-101']);
  // The reload skips React cleanup and the unload request is best-effort; the next load releases it.
  await page.reload();
  await openNav(page, 'الرئيسية');
  await expect.poll(locks, { timeout: 10_000 }).toEqual([]);
  await close();
});
