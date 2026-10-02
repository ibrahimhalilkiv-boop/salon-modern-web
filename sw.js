const CACHE_NAME = 'salon-modern-shell-pwa-v99';
const APP_SHELL = [
  './',
  './salon-modern.html',
  './manifest.webmanifest',
  './salon_brand_logo.jpg',
  './salon-icon-192.png',
  './salon-icon-512.png',
  './supabase-2.49.1.js',
  './smart-customer-analysis-1.7.0.js',
  './salon-phase2-1.8.0.js',
  './salon-assistant-2.0.0.js',
  './salon-voice-2.1.0.js',
  './salon-finance-2.3.0.js?v=98',
  './appointment-list-management-2.4.4.js?v=91',
  './salon-ui-2.3.12.js',
  './salon-performance-2.3.14.js',
  './salon-debt-visibility-2.3.15.js',
  './salon-ui-fixes-2.3.16.js',
  './appointment-management-2.3.26.js?v=89',
  './salon-web-push.js?v=96',
  './pwa-stability-2.3.20.js?v=96',
  './pwa-recovery-2.3.21.js?v=81',
  './pwa-device-session-2.3.22.js?v=96',
  './pwa-back-navigation-2.3.23.js',
  './pwa-desktop-layout-2.3.24.js',
  './pwa-auth-contact-cleanup-2.3.25.js',
  './appointment-cancel-button-2.3.27.js',
  './appointment-debt-warning-2.3.28.js',
  './debt-account-groups-2.3.29.js'
  ,'./appointment-form-actions-2.3.30.js?v=98'
  ,'./booking-requests-admin-2.4.0.js?v=96'
  ,'./booking-schedule-admin-2.4.1.js?v=96'
  ,'./booking-schedule-controls-2.4.3.js?v=96'
  ,'./randevu/'
  ,'./randevu/booking.css'
  ,'./randevu/booking.js'
  ,'./randevu/durum/'
  ,'./randevu/durum/manage.js?v=94'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Salon Modern', {
    body: data.body || 'Yeni bir bildiriminiz var.', icon: './salon-icon-192.png', badge: './salon-icon-192.png',
    tag: data.tag || ('salon-' + (data.notificationId || Date.now())), renotify: false, data
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = new URL('./salon-modern.html', self.registration.scope);
  for (const [key, value] of Object.entries({date:data.appointmentDate,appointment:data.appointmentId||data.appointment_id,kind:data.kind||data.type,notification:data.notificationId})) {
    if (value) targetUrl.searchParams.set(key, String(value));
  }
  const target = targetUrl.href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    for (const client of clients) {
      const url = new URL(client.url);
      if (url.origin === targetUrl.origin && url.pathname === targetUrl.pathname) {
        client.postMessage({ type: 'SALON_NOTIFICATION_OPEN', data });
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then(clients => Promise.all(clients.map(client => client.postMessage({ type: 'SALON_SHELL_UPDATED', cache: CACHE_NAME }))))
  );
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (requestUrl.hostname.endsWith('.supabase.co')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          const fallbackKey = requestUrl.pathname.includes('/randevu/durum')
            ? './randevu/durum/'
            : requestUrl.pathname.includes('/randevu')
              ? './randevu/'
              : requestUrl.pathname.endsWith('/')
                ? './'
                : './salon-modern.html';
          caches.open(CACHE_NAME).then(cache => cache.put(fallbackKey, copy));
          return response;
        })
        .catch(() => requestUrl.pathname.includes('/randevu/durum')
          ? caches.match('./randevu/durum/')
          : requestUrl.pathname.includes('/randevu')
            ? caches.match('./randevu/')
            : requestUrl.pathname.endsWith('/')
              ? caches.match('./')
              : caches.match('./salon-modern.html'))
    );
    return;
  }

  const isCodeOrManifest = /\.(?:html?|js|css|webmanifest)$/i.test(requestUrl.pathname);
  if (isCodeOrManifest) {
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok && requestUrl.origin === self.location.origin) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request)));
    return;
  }

  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok && requestUrl.origin === self.location.origin) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    }
    return response;
  })));
});
