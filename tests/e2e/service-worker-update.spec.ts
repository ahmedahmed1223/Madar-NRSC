import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

test('refreshes the release when an open app visits another page after a build changes', async ({ page }) => {
  const manifestPath = path.resolve('dist/app-assets.json');
  const builtManifest = await readFile(manifestPath, 'utf8');
  const newManifest = JSON.parse(builtManifest) as { version: string; assets: string[] };
  const oldManifest = {
    version: '0'.repeat(24),
    assets: ['/assets/previous-release.js', '/assets/previous-release.css'],
  };
  expect(newManifest.version).not.toBe(oldManifest.version);

  await writeFile(manifestPath, JSON.stringify(oldManifest));
  try {
    await page.goto('/icon.svg');

    const oldRelease = await page.evaluate(async () => {
      const manifestResponse = await fetch('/app-assets.json', { cache: 'no-store' });
      if (!manifestResponse.ok) throw new Error(`Could not load the old app manifest: ${manifestResponse.status}`);
      const manifest = await manifestResponse.json();
      const oldCacheName = `madar-app-${manifest.version}`;
      const oldCache = await caches.open(oldCacheName);
      for (const path of manifest.assets) {
        await oldCache.put(path, new Response(`old release: ${path}`));
      }
      await oldCache.put('/app-complete', new Response(manifest.version));

      const control = await caches.open('madar-control-app');
      await control.put('/active-app', new Response(oldCacheName));
      return { version: manifest.version, oldCacheName };
    });
    expect(oldRelease.version).toBe(oldManifest.version);

    // The app opens with its saved old release while the old manifest is still served.
    await page.goto('/');
    const openedApp = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      if (!registration.active) throw new Error('The service worker did not activate');
      const response = await fetch('/app-assets.json', { cache: 'no-store' });
      const manifest = await response.json();
      return {
        manifestVersion: manifest.version,
        hasController: !!navigator.serviceWorker.controller,
        activeCacheName: await (await caches.open('madar-control-app')).match('/active-app').then(hit => hit?.text()),
      };
    });

    expect(openedApp.manifestVersion).toBe(oldManifest.version);
    expect(openedApp.hasController, 'The open app must be controlled before the build changes').toBe(true);
    expect(openedApp.activeCacheName).toBe(oldRelease.oldCacheName);

    // Simulate the next build becoming available without closing the running app.
    await writeFile(manifestPath, builtManifest);
    await page.goto('/login');

    const result = await page.evaluate(async ({ expectedVersion, expectedAssets, oldCacheName }) => {
      const expectedCacheName = `madar-app-${expectedVersion}`;
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
        if (activeCacheName === expectedCacheName && completionMarker === expectedVersion) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const currentCache = await caches.open(expectedCacheName);
      const missingFiles: string[] = [];
      for (const asset of expectedAssets) {
        if (!await currentCache.match(asset)) missingFiles.push(asset);
      }

      return {
        expectedCacheName,
        activeCacheName,
        completionMarker,
        missingFiles,
        oldCacheStillExists: (await caches.keys()).includes(oldCacheName),
      };
    }, {
      expectedVersion: newManifest.version,
      expectedAssets: newManifest.assets,
      oldCacheName: oldRelease.oldCacheName,
    });

    expect(result.activeCacheName, 'The open app did not activate the new release after navigation').toBe(result.expectedCacheName);
    expect(result.completionMarker).toBe(newManifest.version);
    expect(result.missingFiles, `New release files missing: ${result.missingFiles.join(', ')}`).toEqual([]);
    expect(result.oldCacheStillExists, 'The previous release cache should be removed after activation').toBe(false);
  } finally {
    await writeFile(manifestPath, builtManifest);
  }
});
