/**
 * Vrooom Service Worker — offline-first caching.
 */

const CACHE_NAME = 'vrooom-v30';

const PRECACHE = [
  './',
  './index.html',
  './css/vars.css',
  './css/base.css',
  './css/components.css',
  './css/map.css',
  './js/app.js',
  './js/config.js',
  './js/lib/pwa-lifecycle.js',
  './js/lib/qr-scanner.js',
  './js/lib/pwa-install-overlay.js',
  './js/lib/pwa-pulse.js',
  './js/components/car-viewer/index.js',
  './js/components/car-viewer/scene.js',
  './js/components/car-viewer/car-loader.js',
  './js/components/car-viewer/controls.js',
  './js/components/car-viewer/interaction.js',
  './js/components/car-viewer/vibration.js',
  './js/components/car-viewer/headlights.js',
  './js/components/car-viewer/capture.js',
  './js/services/database.js',
  './js/services/nfc.js',
  './js/services/overpass.js',
  './js/services/playground.js',
  './js/services/playground-cache.js',
  './js/services/checkin.js',
  './js/services/badge.js',
  './js/services/badge-svg.js',
  './js/services/milestones.js',
  './js/utils/geo.js',
  './js/utils/distance.js',
  './js/utils/map.js',
  './js/vendor/jsQR.js',
  './data/conf-vroom.json',
  './data/conf-dodge.json',
  './manifest.json'
];

// Install — precache shell (wait for SKIP_WAITING message from overlay)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
  );
});

// Message handler — controlled update via pwa-install-overlay
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — cache-first for app shell, network-first for API calls
self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Browser extensions issue requests the Cache API refuses to store
  // ("Request scheme 'chrome-extension' is unsupported"), and the cross-origin
  // branch below would try to cache them and throw on every page load.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Never touch the badge-sync relay. It is polled until it changes, and the
  // cache-first branch below would happily serve the first empty 204 forever.
  if (url.pathname.startsWith('/api/')) return;

  // Network-first for Overpass API
  if (url.hostname.includes('overpass')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Network-first for CDN resources (tiles, libs)
  if (url.hostname !== location.hostname) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        fetch(event.request)
          .then(res => {
            if (res.ok) cache.put(event.request, res.clone());
            return res;
          })
          .catch(() => cache.match(event.request))
      )
    );
    return;
  }

  // Cache-first for app resources
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request)
        .then(res => {
          if (res.ok && res.status !== 206) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => new Response('Not found', { status: 404 }))
      )
  );
});
