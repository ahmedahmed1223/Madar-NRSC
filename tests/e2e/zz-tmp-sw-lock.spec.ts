import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('sw: reloading while the episode lock request is in flight leaves no lock behind', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js', { scope: '/' }); await navigator.serviceWorker.ready; });
  await page.reload();
  console.log('controlled', await page.evaluate(() => !!navigator.serviceWorker.controller));
  const me = (await (await page.request.get('/api/v1/auth/me')).json()).user.id;
  const locks = async () => ((await (await page.request.get('/api/v1/data')).json()).collections.editLocks || [])
    .filter((row: any) => row.d.userId === me && Date.parse(row.d.expiresAt) > Date.now()).map((row: any) => row.id);
  page.on('request', r => { if (r.url().includes('/locks/release') || r.url().includes('/data/sync')) console.log('REQ', r.url(), r.postData()?.slice(0, 120)); });
  page.on('requestfailed', r => { if (r.url().includes('/api/')) console.log('FAILED', r.url(), r.failure()?.errorText); });
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
  console.log('reload');
  await page.reload();
  await page.unroute('**/api/v1/data/sync');
  console.log('goto /');
  await page.goto('/');
  await expect.poll(locks, { timeout: 10_000 }).toEqual([]);
  await close();
});
