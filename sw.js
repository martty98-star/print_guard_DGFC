const CACHE_NAME = "printguard-v4.1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key.startsWith("printguard-"))
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
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

function getPushPayload(event) {
  if (!event.data) {
    return {};
  }

  try {
    return event.data.json() || {};
  } catch (error) {
    return {};
  }
}

self.addEventListener("push", (event) => {
  const payload = getPushPayload(event);
  const title = typeof payload.title === "string" && payload.title.trim()
    ? payload.title.trim()
    : "PrintGuard";
  const body = typeof payload.body === "string" && payload.body.trim()
    ? payload.body.trim()
    : "Nová událost.";
  const url = typeof payload.url === "string" && payload.url.trim()
    ? payload.url.trim()
    : "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { url },
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetPath = event.notification?.data?.url || "/";
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (!client || typeof client.focus !== "function") {
          continue;
        }

        return Promise.resolve(
          typeof client.navigate === "function" ? client.navigate(targetUrl) : client
        ).catch(() => client).then(() => client.focus());
      }

      return self.clients.openWindow(targetUrl);
    })
  );
});
