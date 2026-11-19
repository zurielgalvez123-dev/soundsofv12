/* SoundsOfV12 service worker — offline shell + fast repeat loads */
// Bump CACHE to purge every visitor's stored copy. v1 was cache-first for
// everything and never bumped, so returning visitors kept the launch-day
// pages after every deploy.
var CACHE = 'v12-v3';
var CORE = [
  './', 'index.html', 'music.html', 'live.html', 'videos.html',
  'raris.html', 'shop.html', 'blog.html', 'about.html', 'book.html',
  'assets/css/style.css', 'assets/js/main.js', 'assets/js/app.js',
  'assets/img/mark.svg', 'manifest.webmanifest'
];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE).catch(function(){}); }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // Songs stream straight from the network: caching 80 MB of mp3s per
  // visitor is wasteful, and a cached whole-file answer breaks seeking.
  if (/\.mp3$/.test(url.pathname)) return;
  // Pages, CSS and JS go network-first so a deploy reaches everyone on the
  // next load; the cache is only the offline fallback. Images stay
  // cache-first for fast repeat loads.
  var fresh = e.request.mode === 'navigate' || /\.(html|css|js|json|webmanifest)$/.test(url.pathname) || url.pathname.slice(-1) === '/';
  if (fresh) {
    e.respondWith(
      fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy).catch(function(){}); });
        return res;
      }).catch(function () {
        return caches.match(e.request).then(function (hit) { return hit || caches.match('index.html'); });
      })
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy).catch(function(){}); });
        return res;
      });
    })
  );
});
