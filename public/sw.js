/* Madar NRCS service worker: shows push notifications and opens the app on click.
 * Only the explicit offline-air shell is cached. Auth/API responses are never cached. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const OFFLINE_PREFIX = 'madar-offline-air-';
self.addEventListener('message', event => {
  if (event.data?.type !== 'prepare-offline-air' || !event.ports[0]) return;
  event.waitUntil((async () => {
    let cacheName;
    try {
      const response = await fetch('/offline-air-assets.json', { cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error('غلاف الأوفلاين غير متاح؛ يلزم بناء الإنتاج');
      const manifest = await response.json();
      if (!/^[a-f0-9]{24}$/.test(manifest.version) || !Array.isArray(manifest.assets) || manifest.assets.length > 100 || !manifest.assets.includes('/offline-air.html')) throw new Error('بيان الأوفلاين غير صالح');
      if (manifest.assets.some(url => typeof url !== 'string' || !(/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css|woff2?|png|svg)$/.test(url) || url === '/offline-air.html'))) throw new Error('أصل أوفلاين غير مسموح');
      cacheName = OFFLINE_PREFIX + manifest.version;
      const cache = await caches.open(cacheName);
      for (const url of manifest.assets) {
        if (!await cache.match(url)) {
          const asset = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'error' });
          if (!asset.ok) throw new Error('تعذر تنزيل أحد ملفات شاشة الأوفلاين');
          await cache.put(url, asset);
        }
        if (!await cache.match(url)) throw new Error('فشل التحقق من تخزين الغلاف');
      }
      await cache.put('/offline-air-complete', new Response(JSON.stringify(manifest)));
      const control = await caches.open('madar-offline-control');
      await control.put('/active-offline-air', new Response(cacheName));
      event.ports[0].postMessage({ ok: true, version: manifest.version });
    } catch (error) { event.ports[0].postMessage({ ok: false, error: error.message }); }
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET' || !(url.pathname === '/offline-air.html' || url.pathname.startsWith('/assets/'))) return;
  event.respondWith((async () => {
    const control = await caches.open('madar-offline-control');
    const active = await control.match('/active-offline-air');
    const current = active ? await active.text() : '';
    const names = (await caches.keys()).filter(name => name.startsWith(OFFLINE_PREFIX));
    names.sort((a, b) => a === current ? -1 : b === current ? 1 : 0);
    // Serve complete shells only; keep old asset hashes available for already-open sessions.
    for (const name of names) {
      const cache = await caches.open(name);
      if (!await cache.match('/offline-air-complete')) continue;
      const hit = await cache.match(url.pathname);
      if (hit) return hit;
    }
    return fetch(event.request);
  })());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'مدار', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'مدار';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      requireInteraction: !!data.urgent,
      dir: 'rtl',
      lang: 'ar',
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin) {
          client.postMessage({ type: 'open-link', url });
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
