// Minimal service worker — exists only so the app is installable (a
// prerequisite for appearing in the OS share sheet via manifest.json's
// share_target). DayLoop has no offline mode: every plan depends on live
// weather/places/routing data, so this worker intentionally does not cache
// anything and just passes requests straight through to the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => { event.respondWith(fetch(event.request)); });
