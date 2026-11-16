/* Моя жиза — service worker.
 * С интернетом всегда отдаёт свежую версию приложения, без интернета — сохранённую. */
const VERSION = 'moy-den-v15';
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Запросы к ИИ и шрифтам идут напрямую в сеть.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = (await cache.match(e.request, { ignoreSearch: true }))
      || (e.request.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    // Сначала сеть (мимо HTTP-кэша), чтобы обновления приходили сразу.
    const fresh = fetch(e.request.url, { cache: 'no-cache' }).then(res => {
      if (res && res.ok) cache.put(e.request, res.clone());
      return res;
    });
    if (!cached) return fresh;
    fresh.catch(() => {});
    const timeout = new Promise(resolve => setTimeout(() => resolve(null), 4000));
    try {
      const res = await Promise.race([fresh, timeout]);
      if (res && res.ok) return res;
    } catch (err) { /* нет сети — отдаём сохранённое */ }
    return cached;
  })());
});
