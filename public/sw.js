// Service worker for GATA GADGETS.
// Two responsibilities:
// 1. Push notifications (login/logout alerts, discount approvals) — unchanged.
// 2. Making the app installable as a PWA. Deliberately does NOT cache app pages
//    (receipts, dashboard, reports are live business data and must always come
//    from the network), only the small set of static assets that rarely change.
// Bump this whenever the cached asset list itself changes — it forces old cached
// entries to be discarded on the next activate.
const CACHE_NAME = 'gata-gadgets-static-v2';
const STATIC_ASSETS = [
  '/css/style.css',
  '/img/logo.jpg',
  '/img/icon-192.png',
  '/img/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !STATIC_ASSETS.includes(url.pathname)) {
    return; // let the browser handle everything else normally (network)
  }
  // Network-first: always serve the current file when online (so CSS/JS/image edits show up
  // immediately on next load), and only fall back to the last cached copy when offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'GATA GADGETS', body: 'You have a new notification.' };
  if (event.data) {
    try { data = event.data.json(); } catch (e) { data.body = event.data.text(); }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'GATA GADGETS', {
      body: data.body || '',
      icon: '/img/logo.jpg',
      badge: '/img/logo.jpg'
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
