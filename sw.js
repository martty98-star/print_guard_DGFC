const CACHE_NAME = "printguard-v7.0.3";

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

  console.log("[SW] push event received", {
    hasData: Boolean(event.data),
    title,
    url,
  });

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { url },
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
    }).then(() => {
      console.log("[SW] notification shown", { title, url });
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const rawTargetPath = event.notification?.data?.url || "/";
  let targetUrl = self.location.origin + "/";

  try {
    targetUrl = new URL(rawTargetPath, self.location.origin).href;
  } catch (error) {
    console.warn("[SW] invalid notification target url", {
      rawTargetPath,
      error: error && error.message ? error.message : String(error),
    });
  }

  console.log("[SW] notificationclick start", { targetUrl });

  event.waitUntil((async () => {
    try {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      for (const client of clients) {
        if (!client) {
          continue;
        }

        try {
          if (typeof client.navigate === "function") {
            await client.navigate(targetUrl);
          }
        } catch (error) {
          console.warn("[SW] client navigate failed", {
            targetUrl,
            error: error && error.message ? error.message : String(error),
          });
        }

        if (typeof client.focus === "function") {
          try {
            await client.focus();
            console.log("[SW] notificationclick reused existing client", { targetUrl });
            return;
          } catch (error) {
            console.warn("[SW] client focus failed", {
              targetUrl,
              error: error && error.message ? error.message : String(error),
            });
          }
        }
      }

      try {
        await self.clients.openWindow(targetUrl);
        console.log("[SW] notificationclick opened new window", { targetUrl });
      } catch (error) {
        console.warn("[SW] openWindow failed", {
          targetUrl,
          error: error && error.message ? error.message : String(error),
        });
      }
    } catch (error) {
      console.warn("[SW] notificationclick handler failed", {
        targetUrl,
        error: error && error.message ? error.message : String(error),
      });
    }
  })());
});
