const CACHE_NAME = 'salon-modern-shell-v2.3.19';
const APP_SHELL = [
  './salon-modern.html',
  './salon_brand_logo.jpg',
  './supabase-2.49.1.js',
  './smart-customer-analysis-1.7.0.js',
  './salon-phase2-1.8.0.js',
  './salon-assistant-2.0.0.js',
  './salon-voice-2.1.0.js',
  './salon-finance-2.3.0.js',
  './salon-ui-2.3.12.js',
  './salon-performance-2.3.14.js',
  './salon-debt-visibility-2.3.15.js',
  './salon-ui-fixes-2.3.16.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
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
          caches.open(CACHE_NAME).then(cache => cache.put('./salon-modern.html', copy));
          return response;
        })
        .catch(() => caches.match('./salon-modern.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok && requestUrl.origin === self.location.origin) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});
