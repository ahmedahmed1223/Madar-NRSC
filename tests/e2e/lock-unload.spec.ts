import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('reloading while the episode lock request is in flight leaves no lock behind', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  const me = (await (await page.request.get('/api/v1/auth/me')).json()).user.id;
  const locks = async () => ((await (await page.request.get('/api/v1/data')).json()).collections.editLocks || [])
    .filter((row: any) => row.d.userId === me && Date.parse(row.d.expiresAt) > Date.now()).map((row: any) => row.id);
  // The server grants the lock, but its answer is held so the page reloads before seeing it.
  let delayed = false;
  await page.route('**/api/v1/data/sync', async route => {
    if (delayed || !route.request().postData()?.includes('"editLocks"')) return route.continue();
    delayed = true;
    const response = await route.fetch();
    await new Promise(r => setTimeout(r, 1500));
    await route.fulfill({ response }).catch(() => undefined);
  });
  await page.goto('/episodes/ep-101');
  await expect.poll(() => delayed).toBe(true);
  await expect.poll(locks).toEqual(['episodes:ep-101']);
  await page.reload();
  await page.unroute('**/api/v1/data/sync');
  await page.goto('/');
  await expect.poll(locks, { timeout: 10_000 }).toEqual([]);
  await close();
});
