import { chromium, expect, test } from '@playwright/test';

test('production PWA is installable and displays an Arabic web push notification', async ({ baseURL }) => {
  // Keep the test isolated while using a regular profile. Incognito disallows PWA installation.
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
    baseURL,
    permissions: ['notifications'],
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  try {
    await page.goto('/');
    const origin = new URL(page.url()).origin;
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.json');
    const manifestResponse = await page.request.get('/manifest.json');
    expect(manifestResponse.ok()).toBe(true);
    const manifest = await manifestResponse.json();
    expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone', lang: 'ar' });
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '/icon-192.png', sizes: '192x192' }),
      expect.objectContaining({ src: '/icon-512.png', sizes: '512x512' }),
    ]));

    let registrationId: string | undefined;
    session.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
      registrationId = registrations.find(entry => entry.scopeURL === origin + '/' && !entry.isDeleted)?.registrationId ?? registrationId;
    });
    await session.send('ServiceWorker.enable');
    await expect.poll(() => registrationId).toBeTruthy();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await expect.poll(async () => (await session.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([]);
    await expect.poll(() => page.evaluate(() => Notification.permission)).toBe('granted');

    const notification = {
      title: 'تكليف عاجل',
      body: 'مادة تجريبية للتحقق من تنبيه المتصفح',
      tag: 'madar-pwa-test',
      url: '/tasks',
    };
    await session.send('ServiceWorker.deliverPushMessage', {
      origin,
      registrationId: registrationId!,
      data: JSON.stringify(notification),
    });
    await expect.poll(() => page.evaluate(async (tag) => {
      const registration = await navigator.serviceWorker.ready;
      return (await registration.getNotifications({ tag })).map(({ title, body, lang, dir, data }) => ({ title, body, lang, dir, url: data.url }));
    }, notification.tag)).toEqual([
      { title: notification.title, body: notification.body, lang: 'ar', dir: 'rtl', url: notification.url },
    ]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
