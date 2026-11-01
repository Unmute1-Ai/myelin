/*
 * PRIMER service worker — the offline app shell (spec §6.14).
 *
 * Honesty rules, in code:
 *  - The shell is cached; learner data is not. Pages are network-first with
 *    no content cache, so an offline visit lands on the explicit offline
 *    state (/offline.html) — never on a stale page wearing yesterday's data
 *    as today's.
 *  - Cross-origin requests (the API service) are left untouched: the browser
 *    default is network-only, which is exactly right for learner data.
 *  - Bump VERSION whenever the precached shell changes; old caches are
 *    dropped on activation.
 */
const VERSION = "primer-shell-v1";
const PRECACHE = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  // Cross-origin (API service, CDNs) passes through untouched — the browser
  // default is network-only, and learner data must never come from a cache.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Pages: fresh or nothing. No content cache, so the offline fallback is
    // the explicit offline state — the app never shows a stale shell with old
    // learner data pretending to be current.
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match("/offline.html")
          .then(
            (cached) =>
              cached ??
              new Response("You are offline.", {
                status: 503,
                headers: { "Content-Type": "text/plain" },
              }),
          ),
      ),
    );
    return;
  }

  if (PRECACHE.includes(url.pathname)) {
    // Shell assets: cache-first. They change only when VERSION is bumped,
    // which also invalidates the old cache below.
    event.respondWith(
      caches.match(url.pathname).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});
