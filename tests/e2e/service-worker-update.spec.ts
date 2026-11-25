import { expect, test } from '@playwright/test';

test('replaces a saved app release with the complete current build', async ({ page }) => {
  await page.goto('/icon.svg');

  const seeded = await page.evaluate(async () => {
    const oldCacheName = `madar-app-${'0'.repeat(24)}`;
    const oldFiles = ['/assets/previous-release.11111111.js', '/assets/previous-release.22222222.css'];
    const oldBodies = [
      'window.previousReleaseLoaded = true;',
      'body { --previous-release-style: loaded; }',
    ];
    const oldCache = await caches.open(oldCacheName);
    for (const [index, path] of oldFiles.entries()) {
      await oldCache.put(path, new Response(oldBodies[index]));
    }

    const control = await caches.open('madar-control-app');
    await control.put('/active-app', new Response(oldCacheName));
    return { oldCacheName, oldFiles, oldBodies };
  });

  await page.route('**/previous-release-tab', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head>
      <link rel="stylesheet" href="${seeded.oldFiles[1]}">
      <script src="${seeded.oldFiles[0]}"></script>
    </head><body>Previous release tab</body></html>`,
  }));
  await page.route('**/assets/previous-release.*', route => {
    const path = new URL(route.request().url()).pathname;
    const body = seeded.oldBodies[seeded.oldFiles.indexOf(path)];
    return route.fulfill({
      status: body ? 200 : 404,
      contentType: path.endsWith('.css') ? 'text/css' : 'text/javascript',
      body: body || '',
    });
  });
  await page.goto('/previous-release-tab');

  await expect.poll(() => page.evaluate(() => ({
    scriptLoaded: (window as Window & { previousReleaseLoaded?: boolean }).previousReleaseLoaded === true,
    styleLoaded: getComputedStyle(document.body).getPropertyValue('--previous-release-style').trim() === 'loaded',
  }))).toEqual({ scriptLoaded: true, styleLoaded: true });
  await page.unroute('**/assets/previous-release.*');
  await page.unroute('**/previous-release-tab');

  const result = await page.evaluate(async ({ oldCacheName, oldFiles, oldBodies }) => {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
    }

    const manifestResponse = await fetch('/app-assets.json', { cache: 'no-store' });
    if (!manifestResponse.ok) throw new Error(`Could not load the built app manifest: ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    const expectedCacheName = `madar-app-${manifest.version}`;
    registration.active?.postMessage({ type: 'precache-app' });

    const deadline = performance.now() + 25_000;
    let activeCacheName = '';
    let completionMarker = '';
    while (performance.now() < deadline) {
      const control = await caches.open('madar-control-app');
      const activeResponse = await control.match('/active-app');
      activeCacheName = activeResponse ? await activeResponse.text() : '';
      const currentCache = await caches.open(expectedCacheName);
      const marker = await currentCache.match('/app-complete');
      completionMarker = marker ? await marker.text() : '';
      if (activeCacheName === expectedCacheName && completionMarker === manifest.version) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const previousReleaseResponses = await Promise.all(oldFiles.map(async (path, index) => {
      const response = await fetch(path, { cache: 'no-store' });
      return {
        path,
        status: response.status,
        body: await response.text(),
      };
    }));
    const currentCache = await caches.open(expectedCacheName);
    const missingFiles: string[] = [];
    for (const path of manifest.assets) {
      if (!await currentCache.match(path)) missingFiles.push(path);
    }

    const cacheNames = await caches.keys();
    const oldReleaseCaches = cacheNames.filter(name => name.startsWith('madar-app-') && name !== expectedCacheName);
    const oldFilesStillCached: string[] = [];
    for (const cacheName of oldReleaseCaches) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        const path = new URL(request.url).pathname;
        if (oldFiles.includes(path)) oldFilesStillCached.push(`${cacheName}: ${path}`);
      }
    }

    return {
      version: manifest.version,
      expectedCacheName,
      activeCacheName,
      completionMarker,
      missingFiles,
      previousReleaseResponses,
      oldReleaseCaches,
      oldFilesStillCached,
    };
  }, seeded);

  expect(result.activeCacheName, `Expected the new build cache to become active; active cache was ${result.activeCacheName || '(none)'}`).toBe(result.expectedCacheName);
  expect(result.completionMarker, `The new build cache was not marked complete for ${result.version}`).toBe(result.version);
  expect(result.missingFiles, `New build files missing from ${result.expectedCacheName}: ${result.missingFiles.join(', ')}`).toEqual([]);
  expect(result.previousReleaseResponses, 'The open previous-release tab must still be able to fetch its hashed files').toEqual(
    seeded.oldFiles.map((path, index) => ({
      path,
      status: 200,
      body: seeded.oldBodies[index],
    })),
  );
  expect(result.oldFilesStillCached, `Previous release files remain cached: ${result.oldFilesStillCached.join(', ')}`).toEqual([]);
  expect(result.oldReleaseCaches, `Previous release caches were not removed: ${result.oldReleaseCaches.join(', ')}`).toEqual([]);
});
