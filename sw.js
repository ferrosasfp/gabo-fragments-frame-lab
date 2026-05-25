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
const VERSION = "v2";
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

  const url = new URL(req.url);

  // Same-origin: app shell + immutable fragment artworks → cache-first.
  if (url.origin === self.location.origin) {
    const isFragment = url.pathname.startsWith("/fragments/");
    event.respondWith(cacheFirst(req, isFragment ? RUNTIME_CACHE : SHELL_CACHE));
    return;
  }

  // Cross-origin: only the pinned jsdelivr CDN is allowed by connect-src, so it
  // is the only cross-origin we may fetch+cache from here (three.js, gif.js).
  // Everything else (e.g. Google Fonts) MUST pass through untouched — the
  // browser loads it under the correct CSP directive (style-src / font-src);
  // re-fetching it from the SW would be governed by connect-src and get blocked.
  if (url.hostname === "cdn.jsdelivr.net") {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
  }
  // else: no respondWith() → default browser handling (offline degrades to the
  // system-font fallbacks already declared in the CSS font stacks).
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
