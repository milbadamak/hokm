// Hokm service worker — relative paths (works on any GitHub Pages base path,
// including a project subpath). Cache-first with version bump; precache is
// resilient (per-request cache, so a missing icon does not void the whole SW).
const CACHE_NAME = 'hokm-rebuild-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './src/app.js',
  './src/rules.js',
  './src/knowledge.js',
  './src/risk.js',
  './src/decision.js',
  './src/ai.js',
  './src/advisor.js',
  './src/game.js',
  './src/storage.js',
  './src/vendor/lz-string.min.js',
  './fonts/vazirmatn-500-latin.woff2',
  './fonts/vazirmatn-500-arabic.woff2',
  './fonts/vazirmatn-700-latin.woff2',
  './fonts/vazirmatn-700-arabic.woff2',
  './fonts/vazirmatn-900-latin.woff2',
  './fonts/vazirmatn-900-arabic.woff2',
  './fonts/lalezar-400-latin.woff2',
  './fonts/lalezar-400-arabic.woff2',
  './icon-192.png',
  './icon-512.png',
  './favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // addAll is all-or-nothing; per-URL keeps the SW installable if one asset 404s
      await Promise.allSettled(ASSETS.map((a) => cache.add(a)));
      return self.skipWaiting();
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html'))),
  );
});
