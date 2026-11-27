import { expect, test, type Page, type Route } from '@playwright/test';
import { openNav, signIn } from './helpers';

const episodeLockId = 'episodes:ep-101';

async function hasEpisodeLock(page: Page) {
  const { collections } = await (await page.request.get('/api/v1/data')).json();
  return collections.editLocks?.some((row: { id: string; d: { expiresAt: string } }) =>
    row.id === episodeLockId && Date.parse(row.d.expiresAt) > Date.now()) ?? false;
}

for (const serviceWorkers of ['block', 'allow'] as const) {
  const workerState = serviceWorkers === 'allow' ? 'with a service worker' : 'without a service worker';

  test(`reloading with an unanswered lock request releases the episode ${workerState}`, async ({ browser }) => {
    const { page, close } = await signIn(browser, 'editor@akhbar.tv', { serviceWorkers });
    if (serviceWorkers === 'allow') {
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    }

    // Let the server commit the lease and hold its response until the old document is gone.
    let allowResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => { allowResponse = resolve; });
    const syncUrl = '**/api/v1/data/sync';
    let intercepted = false;
    const holdLockResponse = async (route: Route) => {
      const { ops } = route.request().postDataJSON() ?? {};
      if (intercepted || !ops?.some((op: { c: string; op: string; id: string }) =>
        op.c === 'editLocks' && op.op === 'upsert' && op.id === episodeLockId)) return route.continue();
      intercepted = true;
      const response = await route.fetch();
      await responseGate;
      await route.fulfill({ response }).catch(() => undefined); // reload discarded the original request
    };

    await page.route(syncUrl, holdLockResponse);
    try {
      await page.goto('/episodes/ep-101');
      expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(serviceWorkers === 'allow');
      await expect.poll(() => hasEpisodeLock(page)).toBe(true);
      await page.reload();
      await page.unroute(syncUrl, holdLockResponse);
      await page.goto('/');
      await expect.poll(() => hasEpisodeLock(page)).toBe(false);
    } finally {
      allowResponse();
    }
    await close();
  });
}

test('reload releases an episode after the editor closes and its sync delete fails', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  await page.goto('/episodes/ep-101');
  await expect.poll(() => hasEpisodeLock(page)).toBe(true);

  let deleteFailed = false;
  await page.route('**/api/v1/data/sync', async route => {
    const { ops } = route.request().postDataJSON() ?? {};
    if (!ops?.some((op: { c: string; op: string; id: string }) =>
      op.c === 'editLocks' && op.op === 'delete' && op.id === episodeLockId)) return route.continue();
    await route.abort();
    deleteFailed = true;
  });

  await openNav(page, 'الرئيسية');
  await expect.poll(() => deleteFailed).toBe(true);
  expect(await hasEpisodeLock(page)).toBe(true);
  await page.reload();
  await expect.poll(() => hasEpisodeLock(page)).toBe(false);
  await close();
});
