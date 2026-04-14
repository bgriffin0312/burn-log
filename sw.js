// Service worker — full implementation in Session 6
const CACHE_NAME = "burnlog-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Pass-through for now — offline caching added in Session 6
self.addEventListener("fetch", (e) => {
  e.respondWith(fetch(e.request));
});
