/* Madar NRCS service worker.
 * - Shows push notifications and opens the app on click.
 * - Keeps the app on the device so screens open without a connection: the page shell
 *   (index.html, network-first) and the built JS/CSS/font files under /assets/ (cache-first;
 *   their names carry a content hash, so a cached copy is never stale).
 * - Keeps the explicit offline-air shell working as before.
 * Auth and API responses (/api/*) are never cached. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  await self.clients.claim();
})()));

const OFFLINE_PREFIX = 'madar-offline-air-';
/** One cache per build: `madar-app-<version from /app-assets.json>`. */
const APP_PREFIX = 'madar-app-';
/** Used before the first build manifest is known (development, or a manifest that failed). */
const APP_RUNTIME = APP_PREFIX + 'runtime';
/** Remembers which build cache is current. Not under APP_PREFIX, so cleanup never removes it. */
const APP_CONTROL = 'madar-control-app';
const SHELL_KEY = '/index.html';
const THEME_KEY = '/theme-init.js';
const OFFLINE_CONTROL = 'madar-offline-control';
/** A navigation slower than this falls back to the cached shell (weak field connections). */
const NAVIGATION_TIMEOUT_MS = 4000;
const MAX_APP_ASSETS = 400;
const APP_ASSET_RE = /^\/assets\/[A-Za-z0-9_.-]+\.(js|css|woff2?|png|svg|jpg|webp)$/;

async function cachePointer(controlName, key) {
  const control = await caches.open(controlName);
  const response = await control.match(key);
  return response ? response.text() : '';
}

function activeAppCacheName() {
  return cachePointer(APP_CONTROL, '/active-app');
}

async function promoteCache({ controlName, activeKey, previousKey, prefix, name }) {
  const control = await caches.open(controlName);
  const oldActive = await cachePointer(controlName, activeKey);
  if (oldActive && oldActive !== name) await control.put(previousKey, new Response(oldActive));
  await control.put(activeKey, new Response(name));
  const keep = new Set([name, await cachePointer(controlName, previousKey)]);
  const obsolete = (await caches.keys()).filter(candidate => candidate.startsWith(prefix) && !keep.has(candidate));
  await Promise.all(obsolete.map(candidate => caches.delete(candidate)));
}

let precaching = null;
let lastManifestCheck = 0;

/** Downloads every file of the current build once, then makes that build's cache the active one. */
function precacheApp() {
  precaching ??= (async () => {
    lastManifestCheck = Date.now();
    const response = await fetch('/app-assets.json', { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) return; // development server: nothing to precache
    const manifest = await response.json();
    if (!/^[a-f0-9]{24}$/.test(manifest.version) || !Array.isArray(manifest.assets) || manifest.assets.length > MAX_APP_ASSETS) return;
    if (manifest.assets.some((url) => typeof url !== 'string' || !APP_ASSET_RE.test(url))) return;
    const name = APP_PREFIX + manifest.version;
    const cache = await caches.open(name);
    if (name === await activeAppCacheName() && await cache.match('/app-complete') && await cache.match(THEME_KEY)) return;
    const queue = [...manifest.assets];
    // A few at a time, so a phone on a weak link is not flooded.
    const worker = async () => {
      for (let url = queue.shift(); url; url = queue.shift()) {
        if (await cache.match(url)) continue;
        const runtime = await caches.open(APP_RUNTIME);
        const known = await runtime.match(url);
        if (known) { await cache.put(url, known); continue; }
        const asset = await fetch(url, { credentials: 'omit', redirect: 'error' });
        if (!asset.ok) throw new Error('asset ' + url);
        await cache.put(url, asset);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    // Only publish a cache when all files needed to open it are present.
    for (const url of [SHELL_KEY, THEME_KEY]) {
      const file = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'error' });
      if (!file.ok) throw new Error('asset ' + url);
      await cache.put(url, file);
    }
    // Older workers copied a cumulative set of historical files into the active cache.
    const files = new Set([...manifest.assets, SHELL_KEY, THEME_KEY, '/app-complete']);
    for (const request of await cache.keys()) {
      if (!files.has(new URL(request.url).pathname)) await cache.delete(request);
    }
    await cache.put('/app-complete', new Response(manifest.version));
    await promoteCache({ controlName: APP_CONTROL, activeKey: '/active-app', previousKey: '/previous-app', prefix: APP_PREFIX, name });
  })().catch(() => undefined).finally(() => { precaching = null; });
  return precaching;
}

/** After a fresh page load, check (at most every few minutes) whether a new build is out. */
function refreshAppIfStale() {
  if (Date.now() - lastManifestCheck < 5 * 60_000) return Promise.resolve();
  return precacheApp();
}

async function cachedShell() {
  const active = await activeAppCacheName();
  for (const name of [active, APP_RUNTIME].filter(Boolean)) {
    const hit = await (await caches.open(name)).match(SHELL_KEY);
    if (hit) return hit;
  }
  return null;
}

const OFFLINE_PAGE = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>مدار — غير متصل</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;padding:16px;text-align:center}p{max-width:28rem;line-height:1.8}</style></head>
<body><div><p><strong>غير متصل</strong></p><p>لم يُحفظ مدار على هذا الجهاز بعد. سيفتح تلقائياً عند عودة الاتصال.</p></div>
<script>addEventListener('online',()=>location.reload())</script></body></html>`;

/** Network first (fresh deployments win); the cached shell when offline or the network is too slow. */
async function navigationResponse(event) {
  const network = fetch(event.request).then((response) => {
    if (response.ok && (response.headers.get('content-type') || '').includes('text/html')) {
      const copy = response.clone();
      event.waitUntil((async () => {
        if (!await activeAppCacheName()) await (await caches.open(APP_RUNTIME)).put(SHELL_KEY, copy);
        await refreshAppIfStale();
      })().catch(() => undefined));
    }
    return response;
  });
  network.catch(() => undefined); // may settle after the cached shell was already served
  const timeout = new Promise((resolve) => setTimeout(resolve, NAVIGATION_TIMEOUT_MS, null));
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    const shell = await cachedShell();
    return shell || await network;
  } catch {
    const shell = await cachedShell();
    if (shell) return shell;
    return new Response(OFFLINE_PAGE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
}

/** Offline-air shells first (as before), then the app caches, then the network (and keep a copy). */
async function assetResponse(event, url) {
  const request = event.request;
  const active = await cachePointer(OFFLINE_CONTROL, '/active-offline-air');
  const previous = await cachePointer(OFFLINE_CONTROL, '/previous-offline-air');
  const names = [...new Set([active, previous].filter(Boolean))];
  // Serve complete shells only; keep old asset hashes available for already-open sessions.
  for (const name of names) {
    const cache = await caches.open(name);
    if (!await cache.match('/offline-air-complete')) continue;
    const hit = await cache.match(url.pathname);
    if (hit) return hit;
  }
  if (url.pathname === '/offline-air.html') return fetch(request);
  const appNames = [await activeAppCacheName(), await cachePointer(APP_CONTROL, '/previous-app'), APP_RUNTIME].filter(Boolean);
  for (const name of appNames) {
    const hit = await (await caches.open(name)).match(url.pathname);
    if (hit) return hit;
  }
  const response = await fetch(request);
  if (!await activeAppCacheName() && response.ok && response.type === 'basic' && APP_ASSET_RE.test(url.pathname)) {
    const copy = response.clone();
    event.waitUntil((async () => {
      const runtime = await caches.open(APP_RUNTIME);
      await runtime.put(url.pathname, copy);
      const files = (await runtime.keys()).filter(entry => APP_ASSET_RE.test(new URL(entry.url).pathname));
      for (const entry of files.slice(0, Math.max(0, files.length - MAX_APP_ASSETS))) await runtime.delete(entry);
    })().catch(() => undefined));
  }
  return response;
}

self.addEventListener('message', event => {
  if (event.data?.type !== 'precache-app') return;
  event.waitUntil(precacheApp());
});

let preparingAir = null;
function prepareOfflineAir() {
  preparingAir ??= (async () => {
      const response = await fetch('/offline-air-assets.json', { cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error('غلاف الأوفلاين غير متاح؛ يلزم بناء الإنتاج');
      const manifest = await response.json();
      if (!/^[a-f0-9]{24}$/.test(manifest.version) || !Array.isArray(manifest.assets) || manifest.assets.length > 100 || !manifest.assets.includes('/offline-air.html')) throw new Error('بيان الأوفلاين غير صالح');
      if (manifest.assets.some(url => typeof url !== 'string' || !(/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css|woff2?|png|svg)$/.test(url) || url === '/offline-air.html'))) throw new Error('أصل أوفلاين غير مسموح');
      const cacheName = OFFLINE_PREFIX + manifest.version;
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
      await promoteCache({ controlName: OFFLINE_CONTROL, activeKey: '/active-offline-air', previousKey: '/previous-offline-air', prefix: OFFLINE_PREFIX, name: cacheName });
      return manifest.version;
  })().finally(() => { preparingAir = null; });
  return preparingAir;
}

self.addEventListener('message', event => {
  if (event.data?.type !== 'prepare-offline-air' || !event.ports[0]) return;
  const port = event.ports[0];
  event.waitUntil(prepareOfflineAir().then(
    version => port.postMessage({ ok: true, version }),
    error => port.postMessage({ ok: false, error: error.message }),
  ));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/offline-air.html' || url.pathname === THEME_KEY || url.pathname.startsWith('/assets/')) {
    event.respondWith(assetResponse(event, url));
    return;
  }
  // Page loads of the app itself (any client route); other files (manifest, icons, JSON) go to the network.
  if (request.mode === 'navigate' && !/\.[a-z0-9]+$/i.test(url.pathname)) event.respondWith(navigationResponse(event));
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
