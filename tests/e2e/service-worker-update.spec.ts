import { expect, test } from '@playwright/test';

test('replaces a saved app release with the complete current build', async ({ page }) => {
  await page.goto('/icon.svg');

  const seeded = await page.evaluate(async () => {
    const oldCacheName = `madar-app-${'0'.repeat(24)}`;
    const oldFiles = ['/assets/previous-release.js', '/assets/previous-release.css'];
    const oldCache = await caches.open(oldCacheName);
    for (const path of oldFiles) {
      await oldCache.put(path, new Response(`old release: ${path}`));
    }

    const control = await caches.open('madar-control-app');
    await control.put('/active-app', new Response(oldCacheName));
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;

    return { oldCacheName, oldFiles, hasActiveWorker: !!registration.active };
  });

  expect(seeded.hasActiveWorker, 'The service worker must activate before the update is requested').toBe(true);

  const result = await page.evaluate(async ({ oldCacheName, oldFiles }) => {
    const manifestResponse = await fetch('/app-assets.json', { cache: 'no-store' });
    if (!manifestResponse.ok) throw new Error(`Could not load the built app manifest: ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    const expectedCacheName = `madar-app-${manifest.version}`;
    const registration = await navigator.serviceWorker.ready;
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
      oldReleaseCaches,
      oldFilesStillCached,
    };
  }, seeded);

  expect(result.activeCacheName, `Expected the new build cache to become active; active cache was ${result.activeCacheName || '(none)'}`).toBe(result.expectedCacheName);
  expect(result.completionMarker, `The new build cache was not marked complete for ${result.version}`).toBe(result.version);
  expect(result.missingFiles, `New build files missing from ${result.expectedCacheName}: ${result.missingFiles.join(', ')}`).toEqual([]);
  expect(result.oldFilesStillCached, `Previous release files remain cached: ${result.oldFilesStillCached.join(', ')}`).toEqual([]);
  expect(result.oldReleaseCaches, `Previous release caches were not removed: ${result.oldReleaseCaches.join(', ')}`).toEqual([]);
});
