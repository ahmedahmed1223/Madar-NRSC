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
  page.context().on('request', r => { if (r.url().includes('/api/')) console.log('CTXREQ', r.method(), r.url().replace('http://localhost:3994',''), r.serviceWorker() ? 'sw' : 'page'); });
  page.context().on('response', async r => { if (r.url().includes('/locks/release')) console.log('RELEASE RESP', r.status(), await r.text().catch(()=>'?')); });
  page.on('console', m => { if (m.text().startsWith('DBG')) console.log(m.text().slice(0,200)); });
  await page.addInitScript(() => {
    console.log('DBG start held=' + sessionStorage.getItem('nrcs-held-locks') + ' ctrl=' + !!navigator.serviceWorker?.controller + ' url=' + location.pathname);
    const orig = window.fetch.bind(window);
    window.fetch = (input: any, init?: any) => {
      const url = String(input?.url || input);
      const p = orig(input, init);
      if (url.includes('/locks/release')) { console.log('DBG release sent keepalive=' + !!init?.keepalive); p.then(r => r.clone().text()).then(t => console.log('DBG release resp ' + t), e => console.log('DBG release err ' + e)); }
      return p;
    };
    addEventListener('pagehide', () => console.log('DBG pagehide held=' + sessionStorage.getItem('nrcs-held-locks')));
  });
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
  console.log('held-locks', await page.evaluate(() => sessionStorage.getItem('nrcs-held-locks')), 'delayedDone?');
  console.log('status', await page.evaluate(() => document.body.innerText.match(/(قفل|تحرير|يحرر)[^\n]{0,60}/g)?.slice(0,5)));
  console.log('reload');
  await page.reload();
  await page.unroute('**/api/v1/data/sync');
  console.log('goto /');
  await page.goto('/');
  await expect.poll(locks, { timeout: 10_000 }).toEqual([]);
  await close();
});
