const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

let handler;
const NativeDate = Date;
const nowMs = new NativeDate('2026-10-04T12:00:00+03:00').getTime();
class TestDate extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [nowMs])); }
  static now() { return nowMs; }
}
const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`);
const services = Array.from({ length: 6 }, (_, i) => ({
  id: ids[i], name: `Hizmet ${i}`, price: 600 - i * 50,
  duration_minutes: [30, 30, 30, 30, 30, 15][i],
  online_duration_minutes: [60, 60, 60, 60, 30, 30][i],
})).reverse();
let override = null, existing = null, rpcError = null, bookingAllowed = true, onlineEnabled = true;
let slots = [{ time: '10:00', employeeIds: ['e1'] }, { time: '19:00', employeeIds: ['e1'] }];
const rpcCalls = [];
const db = {
  rpc(name, args) {
    if (name === 'can_create_online_booking') return Promise.resolve({ data: bookingAllowed, error: null });
    rpcCalls.push({ name, args });
    if (name === 'online_booking_slots') {
      const service = services.find((item) => item.id === args.p_service);
      return Promise.resolve({ data: { durationMinutes: args.p_duration_override || service.online_duration_minutes, slots }, error: null });
    }
    return Promise.resolve({ data: { id: '12345678-0000-4000-8000-000000000001', public_token: args.p_booking?.public_token }, error: rpcError });
  },
  from(table) {
    const filters = {};
    let single = false;
    const query = {
      select() { return this; }, returns() { return this; },
      eq(key, value) { filters[key] = value; return this; },
      neq() { return this; }, in() { return this; }, gte() { return this; }, lte() { return this; },
      lt() { return this; }, gt() { return this; }, order() { return this; },
      maybeSingle() { single = true; return this; },
      then(resolve, reject) {
        const data = table === 'services' ? (single ? services.find((item) => item.id === filters.id) : services)
          : table === 'profiles' ? (single ? { id: 'e1' } : [{ id: 'e1', full_name: 'Çalışan' }])
          : table === 'booking_settings' ? { online_booking_enabled: onlineEnabled, default_open_time: '08:30', default_close_time: '20:00' }
          : table === 'booking_schedule_overrides' ? override
          : table === 'online_booking_requests' ? existing : [];
        return Promise.resolve({ data, error: null, count: 0 }).then(resolve, reject);
      },
    };
    return query;
  },
};
const source = fs.readFileSync('supabase/functions/customer-booking-request/index.ts', 'utf8').replace(/^import[^\n]+\n/, '');
const ctx = vm.createContext({ createClient: () => db, Deno: { env: { get: () => '' }, serve: (fn) => { handler = fn; } },
  Request, Response, URL, Intl, Date: TestDate, crypto, TextEncoder, console });
vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' }), ctx);
const create = (payload) => handler(new Request('https://test/?action=create', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
}));

(async () => {
  const ranked = await vm.runInContext('onlineServices()', ctx);
  assert.deepEqual(Array.from(ranked, (item) => item.id), ids, 'Catalogue order remains price based');
  assert.deepEqual(Array.from(ranked, (item) => item.duration_minutes), [30, 30, 30, 30, 30, 15], 'Internal durations remain unchanged');
  assert.deepEqual(Array.from(ranked, (item) => item.online_duration_minutes), [60, 60, 60, 60, 30, 30]);
  let response = await handler(new Request(`https://test/?action=availability&date=2026-10-05&service=${ids[0]}&employee=e1`));
  let data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.durationMinutes, 60);
  assert.equal(data.slots.length, 2);
  assert.equal(rpcCalls.at(-1).name, 'online_booking_slots');
  assert.equal(rpcCalls.at(-1).args.p_employee, 'e1');
  response = await handler(new Request(`https://test/?action=availability&date=2026-10-05&service=${ids[4]}`));
  data = await response.json();
  assert.equal(data.durationMinutes, 30);
  assert.equal(rpcCalls.at(-1).args.p_employee, null, 'Fark etmez must query all staff');
  override = { is_closed: true };
  response = await handler(new Request(`https://test/?action=availability&date=2026-10-05&service=${ids[0]}`));
  assert.deepEqual((await response.json()).slots, [], 'Closed day must not expose slots');
  override = null;

  const payload = { customerName: 'Test Person', customerPhone: '05000000001', serviceId: ids[0],
    employeeId: 'e1', date: '2026-10-05', time: '10:00', submissionToken: '00000000-0000-4000-8000-000000000011' };
  onlineEnabled = false;
  response = await handler(new Request(`https://test/?action=availability&date=2026-10-05&service=${ids[0]}`));
  assert.deepEqual((await response.json()).slots, [], 'Online switch hides customer availability');
  const writesBeforeClosedCreate = rpcCalls.length;
  response = await create(payload);
  assert.equal(response.status, 409, 'Online switch rejects customer create server-side');
  assert.equal(rpcCalls.length, writesBeforeClosedCreate, 'Closed online booking must not create an appointment');
  onlineEnabled = true;
  response = await create(payload);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).status, 'approved');
  assert.equal(rpcCalls.at(-1).args.p_booking.duration_minutes, 60);
  response = await create({ ...payload, employeeId: null, submissionToken: '00000000-0000-4000-8000-000000000012' });
  assert.equal(response.status, 201, 'Fark etmez can reserve an available employee');
  assert.equal(rpcCalls.at(-1).args.p_booking.employee_id, null);
  bookingAllowed = false;
  response = await create({ ...payload, submissionToken: '00000000-0000-4000-8000-000000000013' });
  assert.equal(response.status, 403, 'No-show restriction stays active');
  bookingAllowed = true;
  existing = { id: '12345678-0000-4000-8000-000000000001', public_token: payload.submissionToken,
    status: 'approved', phone_normalized: '905000000001', service_id: ids[0], employee_id: 'e1',
    scheduled_at: '2026-10-05T10:00:00+03:00' };
  const priorCalls = rpcCalls.length;
  response = await create(payload);
  assert.equal(response.status, 200);
  assert.equal(rpcCalls.length, priorCalls, 'Retry must not create another appointment');
  response = await create({ ...payload, employeeId: null });
  assert.equal(response.status, 200, 'Fark etmez retry accepts previously selected employee');
  existing = null;
  rpcError = { message: 'conflict' };
  response = await create(payload);
  assert.equal(response.status, 409);
  rpcError = null;
  services.find((item) => item.id === ids[0]).price = 1;
  assert.equal((await vm.runInContext('onlineServices()', ctx)).find((item) => item.id === ids[0]).online_duration_minutes, 60,
    'Online duration depends on service data, not list order or a hardcoded UUID');
  assert.doesNotMatch(source, /2638b0ff-a6e0-412c-b212-0f4d238d9be1/, 'No service UUID is hardcoded');
  console.log('PASS online duration catalogue, shared SQL slots, Fark etmez, no-show and idempotent create');
})().catch((error) => { console.error(error); process.exitCode = 1; });
