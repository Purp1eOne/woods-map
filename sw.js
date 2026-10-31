/* Woods Map service worker: app shell works offline, USGS map tiles are cached. */
const SHELL = 'woods-shell-v2';
const TILES = 'woods-tiles-v1';
const SHELL_FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'lib/leaflet.js',
  'lib/leaflet.css',
  'lib/images/layers.png',
  'lib/images/layers-2x.png',
  'lib/images/marker-icon.png',
  'lib/images/marker-icon-2x.png',
  'lib/images/marker-shadow.png',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('woods-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // USGS tiles: cache first, then network (and remember what you looked at).
  if (url.hostname === 'basemap.nationalmap.gov' || url.hostname === 'gis.dnr.state.mn.us') {
    e.respondWith(
      caches.open(TILES).then(async (cache) => {
        const hit = await cache.match(req, { ignoreVary: true });
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch (err) {
          return new Response('', { status: 504, statusText: 'Offline' });
        }
      })
    );
    return;
  }

  // App files: network first so updates arrive, cache as the offline fallback.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
    );
  }
  // Everything else (OpenStreetMap street tiles) goes straight to the network.
});
