const CACHE_NAME = 'salon-modern-shell-pwa-v115';
const PUSH_RECEIPT_CACHE = 'salon-modern-push-receipts-v1';
const shownReminders = new Set();
let reminderDisplayQueue = Promise.resolve();
const APP_SHELL = [
  './',
  './salon-modern.html',
  './manifest.webmanifest',
  './salon_brand_logo.jpg',
  './salon-icon-192.png',
  './salon-icon-512.png',
  './supabase-2.49.1.js',
  './whatsapp-messages-2.4.5.js?v=113',
  './manual-whatsapp-thank-you-2.4.6.js?v=114',
  './smart-customer-analysis-1.7.0.js',
  './salon-phase2-1.8.0.js?v=112',
  './salon-assistant-2.0.0.js',
  './salon-voice-2.1.0.js',
  './salon-finance-2.3.0.js?v=98',
  './appointment-list-management-2.4.4.js?v=113',
  './salon-ui-2.3.12.js',
  './salon-performance-2.3.14.js',
  './salon-debt-visibility-2.3.15.js',
  './salon-ui-fixes-2.3.16.js',
  './appointment-management-2.3.26.js?v=90',
  './salon-web-push.js?v=110',
  './salon-menu-order.js?v=109',
  './pwa-stability-2.3.20.js?v=104',
  './pwa-recovery-2.3.21.js?v=81',
  './pwa-device-session-2.3.22.js?v=96',
  './pwa-back-navigation-2.3.23.js',
  './pwa-desktop-layout-2.3.24.js',
  './pwa-auth-contact-cleanup-2.3.25.js',
  './appointment-cancel-button-2.3.27.js?v=90',
  './appointment-debt-warning-2.3.28.js',
  './debt-account-groups-2.3.29.js'
  ,'./appointment-form-actions-2.3.30.js?v=98'
  ,'./booking-requests-admin-2.4.0.js?v=100'
  ,'./booking-schedule-admin-2.4.1.js?v=96'
  ,'./booking-schedule-controls-2.4.3.js?v=100'
  ,'./randevu/'
  ,'./randevu/booking.css'
  ,'./randevu/booking.js'
  ,'./randevu/durum/'
  ,'./randevu/durum/manage.js?v=94'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'SALON_REMINDER_FALLBACK' && event.source?.url) {
    const source = new URL(event.source.url);
    const app = new URL('./salon-modern.html', self.registration.scope);
    if (source.origin === app.origin && source.pathname === app.pathname &&
        event.data.data?.kind === 'appointment_reminder' && event.data.data.notificationId) {
      event.waitUntil(displayReminder(event.data.data, 'foreground-fallback'));
    }
  }
});

function receiptUrl(id) {
  return new URL('./__salon_push_receipts__/' + encodeURIComponent(id), self.registration.scope).href;
}

async function readReceipt(id) {
  try {
    const response = await (await caches.open(PUSH_RECEIPT_CACHE)).match(receiptUrl(id));
    return response ? await response.json() : {};
  } catch (error) { console.warn('[salon-push] receipt read failed', error); return null; }
}

async function writeReceipt(data, record) {
  try {
    // Device-only diagnostic metadata; never store customer text or credentials.
    await (await caches.open(PUSH_RECEIPT_CACHE)).put(receiptUrl(data.notificationId), new Response(JSON.stringify({
      notificationId: data.notificationId, appointmentId: data.appointmentId || '',
      reminderFor: data.reminderFor || '', ...record
    }), { headers: { 'Content-Type': 'application/json' } }));
  } catch (error) { console.warn('[salon-push] receipt write failed', error); }
}

function displayReminder(data, source) {
  const task = reminderDisplayQueue.catch(() => {}).then(async () => {
    const record = await readReceipt(data.notificationId) || {};
    record.lastReceivedAt = new Date().toISOString();
    if (source === 'push') record.pushReceivedAt = record.pushReceivedAt || record.lastReceivedAt;
    record.lastSource = source;
    if (source === 'foreground-fallback') {
      const boundary = await readReceipt('__enabled__');
      // Older versions did not record display. Do not replay pre-upgrade
      // reminders that the user might already have seen and dismissed.
      if (!boundary?.firstEnabledAt || !data.createdAt || Date.parse(data.createdAt) < Date.parse(boundary.firstEnabledAt)) return;
    }
    const tag = 'salon-' + data.notificationId;
    if (record.shownAt || shownReminders.has(data.notificationId)) {
      await writeReceipt(data, record); return;
    }
    try {
      // Also recognize notifications displayed by the previous worker version.
      let visible = [];
      try {
        if (self.registration.getNotifications) visible = await self.registration.getNotifications({ tag });
      } catch (error) { console.warn('[salon-push] visible notification lookup failed', error); }
      if (!visible.length) await displayNotification({ ...data, tag });
      shownReminders.add(data.notificationId);
      record.shownAt = new Date().toISOString();
      record.shownBy = visible.length ? 'existing-notification' : source;
      record.lastError = null;
      await writeReceipt(data, record);
    } catch (error) {
      record.failedAt = new Date().toISOString();
      record.lastError = String(error?.name || 'showNotification failed');
      await writeReceipt(data, record);
      throw error; // Failure must remain retryable, never marked as displayed.
    }
  });
  reminderDisplayQueue = task;
  return task;
}

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (_) { try { data = { body: event.data ? event.data.text() : '' }; } catch (_) { data = {}; } }
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
  event.waitUntil(data.kind === 'appointment_reminder' && data.notificationId
    ? displayReminder(data, 'push') : displayNotification(data));
});

async function displayNotification(data) {
  // Contract: dispatcher sends title/body and routing metadata at the top level.
  // Showing a notification must not depend on a page, login or network request.
  const title = typeof data.title === 'string' && data.title ? data.title : 'Salon Modern';
  const body = typeof data.body === 'string' && data.body ? data.body : 'Yeni bir bildiriminiz var.';
  const tag = typeof data.tag === 'string' && data.tag ? data.tag : 'salon-' + (data.notificationId || Date.now());
    try {
      await self.registration.showNotification(title, {
        body, icon: './salon-icon-192.png', badge: './salon-icon-192.png', tag, renotify: false, data
      });
    } catch (error) {
      console.error('[salon-push] showNotification failed', data.notificationId || '', error);
      // Retry with only essential options; retain click routing and dedup tag.
      try { await self.registration.showNotification(title, { body, tag, data }); }
      catch (fallbackError) {
        console.error('[salon-push] fallback failed', data.notificationId || '', fallbackError);
        throw fallbackError;
      }
    }
}

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
    readReceipt('__enabled__').then(async boundary => {
      if (!boundary?.firstEnabledAt) await writeReceipt({ notificationId: '__enabled__' }, { firstEnabledAt: new Date().toISOString() });
      return caches.keys();
    })
      .then(keys => Promise.all(keys.filter(key => key.startsWith('salon-modern-shell-pwa-') && key !== CACHE_NAME).map(key => caches.delete(key))))
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
