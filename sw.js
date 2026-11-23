// Flowgrow service worker: lets the game load offline after the first visit.
// Bump VERSION whenever cached files change so old caches are dropped.
const VERSION = "v31";
const CACHE = `flowgrow-${VERSION}`;
const LOCAL = ["./", "./play/", "./flowgrow.config.js", "./flowgrow.js", "./flowgrow.css", "./play.css", "./fonts/fonts.css", "./fonts/mplus-rounded-500.woff2", "./fonts/mplus-rounded-700.woff2", "./fonts/mplus-rounded-800.woff2", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./elevation/", "./elevation/foothills/", "./elevation/ridges/", "./elevation/terraces/", "./vendor/three.r128.min.js", "./flowgrow.look3d.js", "./flowgrow.look3d.art.js", "./flowgrow.look3d.sky.js", "./flowgrow.look3d.example.js", "./art/pile/river.webp", "./art/pile/green.webp", "./art/pile/prairie.webp", "./art/pile/marsh.webp", "./art/pile/trees.webp"];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(LOCAL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    // Only this game's caches: Flow Tile shares this address and keeps its own, named "flowtile-".
    for (const k of await caches.keys()) if (k.startsWith("flowgrow-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // The page: network first so new deploys show up, cache when offline.
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (_) {
        return (await cache.match(req, { ignoreSearch: true })) || (await cache.match("./")) || Response.error();
      }
    })());
    return;
  }

  // Our own files (flowgrow.js, play.css, icons): network first, like the page, so a deploy never pairs a new page with
  // an old script. The cache is only the offline fallback.
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req, { cache: "no-cache" });
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (_) {
        return (await cache.match(req, { ignoreSearch: true })) || Response.error();
      }
    })());
    return;
  }
});
