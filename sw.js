// Офлайн-кэш: оболочка приложения + база города. Меняй VERSION при каждом обновлении.
const VERSION = 'tropa-v4';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/parser.js', 'js/planner.js', 'js/prices.js',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'data/tokyo.json', 'data/tokyo_michelin.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== 'tiles').map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // тайлы карты: из кэша, если уже видели (чтобы карта работала без сети в знакомых местах)
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    e.respondWith(caches.open('tiles').then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin) return;
  // своё: сначала сеть (свежие правки), при офлайне — кэш
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
