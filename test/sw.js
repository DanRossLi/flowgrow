// Flowgrow test build service worker (LOU-315): lets the test page load offline after the first visit. It is its own service worker, with its own VERSION and cache, so the test page can be updated
// without touching the play page's. Bump VERSION whenever the files below change so old caches are dropped.
const VERSION = "t7";
const CACHE = `fgtest-${VERSION}`;
const LOCAL = ["./", "../flowgrow.config.js", "../flowgrow.js", "../flowgrow.css", "../play.css"];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(LOCAL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    // Only the test build's caches: the play page keeps its own, named "flowgrow-".
    for (const k of await caches.keys()) if (k.startsWith("fgtest-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // The page and its files: network first, so a new deploy shows at once; the cache is the offline fallback.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req, req.mode === "navigate" ? undefined : { cache: "no-cache" });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (_) {
      return (await cache.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? await cache.match("./") : null) || Response.error();
    }
  })());
});
