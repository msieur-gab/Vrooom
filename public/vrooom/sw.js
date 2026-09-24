/**
 * Vrooom Service Worker — offline-first caching.
 */

const CACHE_NAME = 'vrooom-v35';

const PRECACHE = [
  './',
  './index.html',
  './css/vars.css',
  './css/base.css',
  './css/components.css',
  './css/map.css',
  './js/app.js',
  '../shared/config.js',
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
  '../shared/badge-svg.js',
  '../shared/milestones.js',
  './js/utils/geo.js',
  './js/utils/distance.js',
  './js/utils/map.js',
  './js/vendor/jsQR.js',
  './data/conf-vroom.json',
  './data/conf-dodge.json',
  './manifest.json'
];

// The app's own address, with or without index.html. Other pages in the
// folder (print.html) are not the app and keep their own URL. The page is
// served from the './' entry: a host may redirect index.html to the folder,
// and a browser refuses a redirected response when opening a page.
const APP_PAGE = new URL('./', self.location).href;
const APP_PAGES = [new URL(APP_PAGE).pathname, new URL('./index.html', self.location).pathname];

async function rangeFromCache(request) {
  const cache = await caches.open(CACHE_NAME);
  let full = await cache.match(request.url);
  if (!full) {
    try {
      full = await fetch(request.url); // no Range header: the whole file, 200
    } catch {
      return new Response('', { status: 504 });
    }
    if (!full.ok) return full;
    await cache.put(request.url, full.clone());
  }

  const body = await full.arrayBuffer();
  const [, from, to] = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range')) || [];
  const size = body.byteLength;
  let start = from ? Number(from) : 0;
  let end = to ? Math.min(Number(to), size - 1) : size - 1;
  if (!from && to) { start = Math.max(size - Number(to), 0); end = size - 1; } // bytes=-N: the last N

  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': full.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1)
    }
  });
}

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

  // Opening the app — from the home screen, or a car's tag with ?car=<id>.
  // The cache holds the page without a query, so an exact match missed every
  // tag URL and a tag tapped offline got "Not found". Whatever the query, the
  // page is the same: serve the saved one.
  if (event.request.mode === 'navigate' && APP_PAGES.includes(url.pathname)) {
    event.respondWith(
      caches.match(APP_PAGE).then(cached => cached || fetch(event.request))
    );
    return;
  }

  // Audio asks for byte ranges and gets 206 Partial Content, which the
  // cache-first branch below refuses to store — so no sound was ever
  // available offline, even after playing. Cache the whole file once and
  // answer every range from it.
  if (url.hostname === location.hostname && event.request.headers.has('range')) {
    event.respondWith(rangeFromCache(event.request));
    return;
  }

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
