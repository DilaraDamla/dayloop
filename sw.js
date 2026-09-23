// Minimal service worker — exists so the app is installable (a prerequisite
// for appearing in the OS share sheet via manifest.json's share_target, and
// for packaging as an Android app). DayLoop has no offline mode: every plan
// depends on live weather/places/routing data, so this worker does not cache
// the app. The one exception is offline.html, shown instead of the browser's
// own error page when a page navigation fails because the device is offline.
const OFFLINE_CACHE = 'dayloop-offline-v1';
const OFFLINE_URL = 'offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((cache) => cache.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== OFFLINE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  event.respondWith(fetch(event.request));
});
