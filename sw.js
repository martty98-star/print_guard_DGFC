const CACHE = 'printguard-v2';
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png"
];
const URLS  = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.json'];
self.addEventListener('install',  e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(URLS).catch(()=>{})).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Neřeš non-GET (POST atd.) – ať se necacheuje API a sync
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Nikdy necacheuj Netlify Functions (API)
  if (url.pathname.startsWith('/.netlify/functions/')) {
    event.respondWith(fetch(req));
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req).then((networkResponse) => {
        // Pokud response není OK nebo je to opaque, vrať ji a necacheuj
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
          return networkResponse;
        }

        // DŮLEŽITÉ: clone před cache.put
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, responseToCache));

        return networkResponse;
      });
    })
  );
});
