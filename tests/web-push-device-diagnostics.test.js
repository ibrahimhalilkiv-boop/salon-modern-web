const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('salon-web-push.js', 'utf8');
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');
const elements = new Map();
const rows = new Map();
const writes = [];
const toasts = [];
let localSubscription = null;
let subscribeError = null;
let subscribeCount = 0;
let unsubscribed = 0;
const makeSubscription = endpoint => ({
  endpoint,
  toJSON: () => ({ endpoint, keys: { p256dh: 'fixture-public', auth: 'fixture-auth' } }),
  unsubscribe: async () => { unsubscribed++; if (localSubscription?.endpoint === endpoint) localSubscription = null; return true; },
});
const registration = {
  scope: 'https://fixture.test/', active: {},
  pushManager: {
    getSubscription: async () => localSubscription,
    subscribe: async () => {
      subscribeCount++;
      if (subscribeError) throw subscribeError;
      localSubscription = makeSubscription(`https://fcm.googleapis.com/fcm/send/current-${subscribeCount}`);
      return localSubscription;
    },
  },
};
const query = () => {
  const filters = {};
  return {
    select() { return this; },
    update(values) { this.values = values; return this; },
    eq(field, value) {
      filters[field] = value;
      if (field === 'user_id' && this.values) {
        writes.push({ ...filters, ...this.values });
        const row = rows.get(filters.endpoint);
        if (row && row.user_id === value) row.active = this.values.active;
        return Promise.resolve({ error: null });
      }
      return this;
    },
    async maybeSingle() {
      const row = rows.get(filters.endpoint);
      return { data: row?.user_id === filters.user_id ? row : null, error: null };
    },
  };
};
const context = {
  window: { PushManager: function () {}, Notification: function () {}, enterApp() {}, logout() {}, addEventListener() {} },
  navigator: { platform: 'fixture', userAgent: 'fixture', serviceWorker: { ready: Promise.resolve(registration), getRegistration: async () => registration, addEventListener() {} } },
  Notification: { permission: 'granted' },
  document: { hidden: true, addEventListener() {}, getElementById: id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', disabled: false, hidden: false });
    return elements.get(id);
  } },
  location: { href: 'https://fixture.test/salon-modern.html' },
  currentUser: { id: 'user-a' },
  salonDb: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user-a' }, access_token: 'fixture-token' } } }), onAuthStateChange() {} },
    rpc: async (_name, args) => {
      const previous = rows.get(args.p_endpoint);
      const id = previous?.id || `00000000-0000-4000-8000-${String(rows.size + 1).padStart(12, '0')}`;
      rows.set(args.p_endpoint, { id, user_id: 'user-a', active: args.p_active });
      return { data: id, error: null };
    },
    from: () => query(),
  },
  fetch: async () => ({ ok: true, json: async () => ({ publicKey }) }),
  atob: input => Buffer.from(input, 'base64').toString('binary'),
  caches: { open: async () => ({ match: async () => null }) },
  showAppToast: (...args) => toasts.push(args),
  setInterval() {}, setTimeout() {},
  URL, URLSearchParams, Date, Uint8Array, console,
};
vm.runInNewContext(source, context);

(async () => {
  subscribeError = Object.assign(new Error('Registration failed - push service error'), { name: 'AbortError' });
  await context.window.SalonWebPush.enable();
  assert.match(elements.get('webPushError').textContent, /PushManager\.subscribe · AbortError: Registration failed - push service error/);
  assert.equal(rows.size, 0, 'Failed browser subscription never reaches Supabase');
  assert.equal(toasts.at(-1)[0], 'Bildirimler açılamadı');

  subscribeError = null;
  localSubscription = makeSubscription('https://fcm.googleapis.com/fcm/send/this-device');
  rows.set(localSubscription.endpoint, { id: '00000000-0000-4000-8000-000000000001', user_id: 'user-a', active: true });
  rows.set('https://fcm.googleapis.com/fcm/send/other-device', { id: '00000000-0000-4000-8000-000000000002', user_id: 'user-a', active: true });
  await context.window.SalonWebPush.renew();
  assert.equal(unsubscribed, 1);
  assert.equal(subscribeCount, 2);
  assert.equal(rows.get('https://fcm.googleapis.com/fcm/send/this-device').active, false);
  assert.equal(rows.get('https://fcm.googleapis.com/fcm/send/other-device').active, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].endpoint, 'https://fcm.googleapis.com/fcm/send/this-device');
  assert.equal(writes[0].user_id, 'user-a');
  assert.equal(elements.get('webPushServerSub').textContent, 'Aktif');
  console.log('PASS real browser error visible; renewal changes only this device');
})().catch(error => { console.error(error); process.exitCode = 1; });
