/* Panel tətbiqi: yalnız quraşdırma üçün. Məlumat və səhifələr həmişə şəbəkədən gəlir (köhnə versiya göstərilməsin). */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(function () {
      return new Response('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;padding:32px;text-align:center"><h2>İnternet yoxdur</h2><p>Bağlantı bərpa olunanda yenidən cəhd edin.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }));
  }
});
