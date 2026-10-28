/*
 * Step 7 — the installable app's service worker. Deliberately small:
 *  - the app's own static files (/_next/static, /icons) are cached once and served from the cache;
 *  - a page is fetched from the network, and the last good copy is kept so a page already opened
 *    (the site Home, a capture screen) still opens with no signal;
 *  - anything that is not a same-origin GET is never touched, so API calls, uploads and sign-in
 *    always go to the network. Unsent photos and forms wait in IndexedDB (the upload queue), not here.
 */
const VERSION = 'rukna-v1';
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC).then((cache) => cache.addAll([OFFLINE, '/icons/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        if (res.ok) caches.open(STATIC).then((cache) => cache.put(request, res.clone()));
        return res;
      })),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && !url.pathname.startsWith('/login')) caches.open(PAGES).then((cache) => cache.put(request, res.clone()));
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match(OFFLINE))),
    );
  }
});
