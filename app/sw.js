const VER = "v3";
const SHELL = `vescdash-shell-${VER}`;
const RUNTIME = `vescdash-rt-${VER}`;
const TILES = `vescdash-tiles-${VER}`;
const TILE_MAX = 600;

const SHELL_FILES = [
  "./", "./index.html", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/maskable-512.png", "./icons/apple-touch-icon.png"
];
const CDN_FILES = [
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js",
  "https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600&family=DM+Mono:wght@400;500&display=swap"
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(SHELL_FILES);
    const rt = await caches.open(RUNTIME);
    await Promise.all(CDN_FILES.map(async u => {
      try { await rt.put(u, await fetch(u, { mode: "no-cors" })); } catch (_) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keep = [SHELL, RUNTIME, TILES];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never cache routing / geocoding
  if (url.hostname.includes("osrm.org") || url.hostname.includes("nominatim")) return;

  // App shell
  if (url.origin === location.origin) {
    // Navigation (HTML) : réseau d'abord, pour que les mises à jour soient visibles dès l'ouverture
    if (req.mode === "navigate") {
      e.respondWith((async () => {
        const cache = await caches.open(SHELL);
        try {
          const r = await fetch(req, { cache: "reload" });
          if (r.ok) cache.put(req, r.clone());
          return r;
        } catch (_) {
          return (await cache.match(req, { ignoreSearch: true })) || (await cache.match("./index.html")) || Response.error();
        }
      })());
      return;
    }
    // Autres fichiers locaux (icônes, manifest…) : stale-while-revalidate
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || (await cache.match("./index.html")) || Response.error();
    })());
    return;
  }

  // Map tiles: cache-first, bounded
  if (url.hostname.endsWith("tile.openstreetmap.org")) {
    e.respondWith((async () => {
      const cache = await caches.open(TILES);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const r = await fetch(req);
        cache.put(req, r.clone()); trim(TILES, TILE_MAX);
        return r;
      } catch (_) { return Response.error(); }
    })());
    return;
  }

  // Leaflet, fonts & other CDN assets: cache-first
  if (/(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const r = await fetch(req);
        cache.put(req, r.clone());
        return r;
      } catch (_) { return Response.error(); }
    })());
  }
});
