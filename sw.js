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
self.addEventListener('fetch', e => {
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(caches.match(e.request).then(cached => {
    if (cached) return cached;
    return fetch(e.request).then(res => {
      if (res?.status===200 && res.type==='basic') caches.open(CACHE).then(c=>c.put(e.request,res.clone()));
      return res;
    });
  }).catch(() => e.request.mode==='navigate' ? caches.match('/index.html') : new Response('Offline',{status:503})));
});
