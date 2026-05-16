// LipoLand CRM — service worker
// Версія міняється при кожному релізі щоб старі кеші чистились.
const CACHE = 'lipoland-v1';
const PRECACHE = ['/favicon.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch strategy:
// - API / non-GET → network-only (нічого не кешуємо)
// - HTML-навігація (document) → network-first з fallback на кеш
// - Статика (картинки/css/js) → cache-first з оновленням у фоні (stale-while-revalidate)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // HTML navigation
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/app')))
    );
    return;
  }

  // Static assets — stale-while-revalidate
  if (url.pathname.match(/\.(png|jpg|jpeg|svg|webp|ico|css|js|woff2?|webmanifest)$/)) {
    event.respondWith(
      caches.open(CACHE).then((c) =>
        c.match(req).then((cached) => {
          const fetchPromise = fetch(req)
            .then((res) => {
              if (res.ok) c.put(req, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
  }
});

// ===== Push notifications =====
self.addEventListener('push', (event) => {
  let data = { title: 'LipoLand', body: 'Нове сповіщення' };
  if (event.data) {
    try { data = Object.assign(data, event.data.json()); }
    catch (_) {
      try { data.body = event.data.text(); } catch (__) {}
    }
  }
  const options = {
    body: data.body,
    icon: '/favicon.png',
    badge: '/favicon.png',
    tag: data.tag || 'lipoland-default',
    data: { url: data.url || '/app' },
    requireInteraction: !!data.requireInteraction,
    actions: data.actions || [],
    vibrate: [80, 40, 80]
  };
  event.waitUntil(self.registration.showNotification(data.title || 'LipoLand', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/app';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes(url.split('#')[0]) && 'focus' in c) {
          c.focus();
          if (url.includes('#') && 'navigate' in c) c.navigate(url).catch(() => {});
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// Allow page to ask SW to skip waiting after update
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
