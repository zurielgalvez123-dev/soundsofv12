/* SoundsOfV12 service worker — offline shell + fast repeat loads */
var CACHE = 'v12-v1';
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
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy).catch(function(){}); });
        return res;
      }).catch(function () { return caches.match('index.html'); });
    })
  );
});
