const CACHE_NAME = "printguard-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {

  const req = event.request;
  const url = new URL(req.url);

  // nikdy necacheuj API (Netlify functions)
  if (url.pathname.startsWith("/.netlify/functions/")) {
    event.respondWith(fetch(req));
    return;
  }

  // pouze GET requesty
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => {

      if (cached) {
        return cached;
      }

      return fetch(req).then((networkResponse) => {

        // response není validní
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }

        const responseClone = networkResponse.clone();

        caches.open(CACHE_NAME).then((cache) => {
          cache.put(req, responseClone);
        });

        return networkResponse;

      });

    })
  );

});