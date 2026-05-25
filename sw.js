/* Frame Lab — service worker.
 *
 * Offline app shell + runtime caching. Bump VERSION to invalidate caches on
 * a new release (old caches are purged on activate).
 *
 *   - app shell (html/js/css/svg/genesis/icons) ........ precached on install
 *   - fragments/<id>.webp (immutable artworks) ......... cache-first on demand
 *   - same-origin static ............................... cache-first
 *   - CDN (three.js, gif.js, Google Fonts) ............. cache-first on demand
 *   - navigations ...................................... network-first, shell fallback
 */
const VERSION = "v1";
const SHELL_CACHE = `gabo-shell-${VERSION}`;
const RUNTIME_CACHE = `gabo-runtime-${VERSION}`;

const SHELL = [
  "/",
  "/index.html",
  "/app.js",
  "/puzzle.js",
  "/nav.js",
  "/styles.css",
  "/logo.svg",
  "/opensea.svg",
  "/x.svg",
  "/apechain.svg",
  "/genesis-bg.webp",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Page navigations: network-first so updates land fast; cached shell offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/index.html").then((r) => r || caches.match("/"))
      )
    );
    return;
  }

  // Everything else: cache-first (immutable artworks + pinned CDN libs).
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFragment = sameOrigin && url.pathname.startsWith("/fragments/");
  const cacheName = (sameOrigin && !isFragment) ? SHELL_CACHE : RUNTIME_CACHE;
  event.respondWith(cacheFirst(req, cacheName));
});

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    // Store successful same-origin and opaque (no-cors CDN) responses.
    if (res && (res.ok || res.type === "opaque")) {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    const fallback = await caches.match(req);
    if (fallback) return fallback;
    throw err;
  }
}
