// Burn Log Service Worker — offline caching
const CACHE_NAME = "burnlog-v9";

const APP_SHELL = [
  "./",
  "./index.html",
  "./tripwire.html",
  "./css/style.css",
  "./js/config.js",
  "./js/presets.js",
  "./js/db.js",
  "./js/claude.js",
  "./js/ui.js",
  "./js/charts.js",
  "./js/app.js",
  "./js/tripwire.js",
  "./manifest.json",
  "./icons/icon.svg"
];

const CDN_ASSETS = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  "https://cdn.jsdelivr.net/npm/chart.js",
  "https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation",
  "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap"
];

// Install — cache app shell
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache local files (fail silently for missing ones)
      for (const url of APP_SHELL) {
        try { await cache.add(url); } catch (err) {
          console.warn("SW: couldn't cache", url, err);
        }
      }
      // Cache CDN assets (best-effort)
      for (const url of CDN_ASSETS) {
        try { await cache.add(url); } catch (err) {
          console.warn("SW: couldn't cache CDN", url, err);
        }
      }
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
// - Supabase/Claude API calls: network only (no caching)
// - Google Fonts woff2 files: cache-first (they're immutable)
// - Everything else: network-first with cache fallback
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Skip non-GET
  if (e.request.method !== "GET") return;

  // API calls — always network, never cache
  if (url.hostname.includes("supabase.co") || url.hostname.includes("anthropic.com")) {
    return;
  }

  // Font files — cache-first (immutable)
  if (url.hostname === "fonts.gstatic.com") {
    e.respondWith(
      caches.match(e.request).then((cached) =>
        cached || fetch(e.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          return response;
        })
      )
    );
    return;
  }

  // Everything else — network-first, fall back to cache
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
