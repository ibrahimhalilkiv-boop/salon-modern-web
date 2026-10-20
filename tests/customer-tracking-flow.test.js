const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const token = '00000000-0000-4000-8000-000000000001';
const operation = '00000000-0000-4000-8000-000000000002';
let handler, rpcCalls = [];
let request = { status: 'approved', scheduled_at: '2026-10-21T15:00:00+03:00', customer_revision: 0,
  appointment: { id: 'a1', client_name: 'Test Müşteri', service_name: 'Kesim', service_id: 's1',
    employee_id: 'e1', scheduled_at: '2026-10-21T15:00:00+03:00', duration_minutes: 30,
    online_protection_minutes: 30, amount: 500, status: 'confirmed', employee: { full_name: 'Çalışan' } } };
const db = {
  from() { return { select() { return this; }, eq() { return this; }, maybeSingle() { return this; },
    async returns() { return { data: request, error: null }; } }; },
  async rpc(name, args) { rpcCalls.push({ name, args }); return { data: { status: args.p_action === 'cancel' ? 'cancelled' : 'approved' }, error: null }; },
};
const source = fs.readFileSync('supabase/functions/customer-booking-request/index.ts', 'utf8').replace(/^import[^\n]+\n/, '');
const clock = new Date('2026-10-20T12:00:00+03:00').getTime();
class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
const context = vm.createContext({ createClient: () => db, Deno: { env: { get: () => '' }, serve: fn => { handler = fn; } },
  Request, Response, URL, Intl, Date: TestDate, crypto, TextEncoder, console });
vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' }), context);
const get = async action => handler(new Request('https://test/?action=' + action + '&token=' + token + '&date=2026-10-22'));
const post = async (action, extra = {}) => handler(new Request('https://test/?action=customer-' + action, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token, operation, revision: 0, date: '2026-10-22', time: '16:00', ...extra }),
}));

(async () => {
  let response = await get('status'), data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.status, 'approved');
  assert.equal(data.appointment.canManage, true);
  assert.equal(data.appointment.service, 'Kesim');
  assert.equal((await post('update')).status, 200);
  assert.equal(rpcCalls.at(-1).name, 'manage_customer_online_booking');
  assert.equal(rpcCalls.at(-1).args.p_action, 'update');
  assert.equal((await post('cancel')).status, 200);
  assert.equal(rpcCalls.at(-1).args.p_action, 'cancel');
  for (const field of ['employeeId', 'serviceId', 'appointmentId']) {
    assert.equal((await post('update', { [field]: 'other' })).status, 400);
  }
  const callsBeforeCutoff = rpcCalls.length;
  request.appointment.scheduled_at = '2026-10-20T13:59:00+03:00';
  data = await (await get('status')).json();
  assert.equal(data.appointment.canManage, false);
  assert.equal((await post('update')).status, 409);
  assert.equal((await post('cancel')).status, 409);
  assert.equal(rpcCalls.length, callsBeforeCutoff);
  for (const status of ['completed', 'cancelled', 'no_show']) {
    request.appointment.status = status;
    data = await (await get('status')).json();
    assert.equal(data.status, status);
    assert.equal(data.appointment.canManage, false);
  }
  assert.equal((await handler(new Request('https://test/?action=status&token=invalid'))).status, 400);
  const html = fs.readFileSync('randevu/index.html', 'utf8');
  const booking = fs.readFileSync('randevu/booking.js', 'utf8');
  const manage = fs.readFileSync('randevu/durum/manage.js', 'utf8');
  assert.match(html, /id="copyTrackingLink"/);
  assert.match(booking, /trackingLink'\)\.value=link/);
  assert.match(booking, /new URL\('durum\/\?token='/);
  assert.match(manage, /completed:'Randevunuz tamamlandı'/);
  assert.match(manage, /no_show:'Randevuya gelmediniz'/);
  console.log('PASS customer tracking status, update, cancel, cutoff, immutable service and employee, and secure link UI');
})().catch(error => { console.error(error); process.exitCode = 1; });
