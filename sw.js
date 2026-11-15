/* Мой день — service worker: кэширует оболочку приложения для работы офлайн. */
const VERSION = 'moy-den-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // API calls and fonts go straight to the network.
  if (url.origin !== location.origin) return;
  // Stale-while-revalidate for the app shell.
  e.respondWith(caches.match(e.request).then(cached => {
    const fresh = fetch(e.request).then(res => { if (res && res.ok) caches.open(VERSION).then(c => c.put(e.request, res.clone())); return res; }).catch(() => cached);
    return cached || fresh;
  }));
});
