// Sahar Love — service worker: notificaciones push y apertura rápida
const CACHE = 'sahar-v2';
const SHELL = ['/', '/index.html', '/i18n.js', '/manifest.webmanifest', '/icon-192.png', '/icon-180.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Archivos de la app: primero la red (para tener siempre la última versión),
// y si no hay conexión o el servidor está despertando, la copia guardada.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(e.request, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch (_) {
      return (await cache.match(e.request)) || (await cache.match('/')) || Response.error();
    }
  })());
});

self.addEventListener('push', (event) => {
  let data = { title: 'Sahar 💗', body: '❤️' };
  try { data = Object.assign(data, event.data.json()); } catch (_) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: data.vibrate || [200, 100, 200],
      tag: data.tag || 'sahar-' + Date.now(),
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('/');
    })
  );
});
