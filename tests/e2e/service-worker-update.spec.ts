import { browserBuildDir } from './buildDir';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test('replaces a saved app release with the complete current build', async ({ page }) => {
  await page.goto('/icon.svg');

  const seeded = await page.evaluate(async () => {
    const oldCacheName = `madar-app-${'0'.repeat(24)}`;
    const obsoleteCacheName = `madar-app-${'1'.repeat(24)}`;
    await caches.open(obsoleteCacheName);
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
    await control.put('/previous-app', new Response(obsoleteCacheName));
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

    const retainedPreviousCaches = (await caches.keys()).filter(name => name.startsWith('madar-app-') && name !== expectedCacheName);
    const copiedOldFiles = [];
    for (const oldFile of oldFiles) if (await currentCache.match(oldFile)) copiedOldFiles.push(oldFile);

    return {
      version: manifest.version,
      expectedCacheName,
      activeCacheName,
      completionMarker,
      missingFiles,
      previousReleaseResponses,
      retainedPreviousCaches,
      copiedOldFiles,
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
  expect(result.copiedOldFiles, 'The active build should contain only its own assets').toEqual([]);
  expect(result.retainedPreviousCaches, 'Only the immediately previous release may remain cached').toEqual([seeded.oldCacheName]);
});

test('refreshes the release when an open app visits another page after a build changes', async ({ page }) => {
  const manifestPath = path.join(browserBuildDir, 'app-assets.json');
  const newManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: string; assets: string[] };
  const oldVersion = '0'.repeat(24);
  const oldCacheName = `madar-app-${oldVersion}`;
  expect(newManifest.version).not.toBe(oldVersion);

  // This tab was opened by the previous release. Seed its completed cache in this browser
  // instead of changing the build files shared by the other isolated browser specs.
  await page.route('**/saved-release-preview', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Previous release</title><p>Previous release</p>',
  }));
  await page.goto('/saved-release-preview');
  await page.evaluate(async ({ name, version }) => {
    const oldCache = await caches.open(name);
    await oldCache.put('/app-complete', new Response(version));
    const control = await caches.open('madar-control-app');
    await control.put('/active-app', new Response(name));
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
  }, { name: oldCacheName, version: oldVersion });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.unroute('**/saved-release-preview');

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
    oldCacheName,
  });

  expect(result.activeCacheName, 'The open app did not activate the new release after navigation').toBe(result.expectedCacheName);
  expect(result.completionMarker).toBe(newManifest.version);
  expect(result.missingFiles, `New release files missing: ${result.missingFiles.join(', ')}`).toEqual([]);
  expect(result.oldCacheStillExists, 'An already-open previous release keeps its own cache').toBe(true);
});
