const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('salon-modern.html', 'utf8');
const source = html.slice(html.indexOf('var salonPreviewMonthSequence=0;'), html.indexOf('async function startRemoteApp(){'));
assert(source.includes('window.salonPreviewCalendarMonth=async function()'));
assert(html.includes("window.salonHistoryState!=='ready'&&target!=='calendar'"));
assert.doesNotMatch(html,/from\('appointments'\)\.select\('\*'\)\.neq\('status','cancelled'\)\.order\('scheduled_at'\)/,
  'Unpaged legacy appointment reader must not return');
assert.match(html,/salon-appointment-data\.js\?v=150/);
const worker = fs.readFileSync('sw.js','utf8');
const listAsset = html.match(/appointment-list-management-2\.4\.4\.js\?v=\d+/)?.[0];
assert.match(worker,/salon-modern-shell-pwa-v\d+/);
assert.ok(listAsset && worker.includes(listAsset), 'App and service worker must cache the same appointment manager script');
const performance=fs.readFileSync('salon-performance-2.3.14.js','utf8');
assert.match(performance,/status==='SUBSCRIBED'[\s\S]*subscribedOnce[\s\S]*appointment-reconnect/,
  'Realtime resubscription must reconcile missed appointments');
assert.match(performance,/addEventListener\('online',[\s\S]*appointment-reconnect/,
  'Network recovery must reconcile missed appointments');

const pending = new Map();
let date = '2026-10-20';
const closed = { select() { return this; }, lt() { return this; }, gt() { return this; },
  order() { return Promise.resolve({ data: [], error: null }); } };
const ctx = {
  window: { salonHistoryState: 'loading', salonCalendarPreviewMonth: '2026-09' },
  currentUser: { id: 'manager' }, appts: [{ id: 'old' }], remoteClosedSlots: [],
  selectedTeamDate: () => date, renderCalendar() {}, remoteAppointment: row => row,
  showAppToast() {}, salonDb: { from() { return closed; } },
  SalonAppointmentData: {
    monthBounds(day) { return { start: day.slice(0, 7) + '-01', end: day.slice(0, 7) + '-31' }; },
    loadVisible(db, columns, day) { return new Promise((resolve, reject) => pending.set(day, { resolve, reject })); }
  }
};
vm.createContext(ctx);
vm.runInContext(source, ctx);

(async () => {
  const october = ctx.window.salonPreviewCalendarMonth();
  date = '2026-11-20';
  const november = ctx.window.salonPreviewCalendarMonth();
  pending.get('2026-11-20').resolve([{ id: 'november' }]);
  await november;
  pending.get('2026-10-20').resolve([{ id: 'october' }]);
  await october;
  assert.equal(ctx.appts[0].id, 'november', 'Slow older month cannot overwrite selected month');
  assert.equal(ctx.window.salonCalendarLoadState.status, 'ready');

  date = '2026-12-20';
  const december = ctx.window.salonPreviewCalendarMonth();
  pending.get('2026-12-20').reject(new Error('offline'));
  await december;
  assert.equal(ctx.window.salonCalendarLoadState.status, 'error');
  assert.equal(ctx.appts[0].id, 'november', 'Network failure preserves known appointment data');

  ctx.window.salonHistoryState = 'ready';
  await ctx.window.salonPreviewCalendarMonth();
  assert.equal(ctx.appts[0].id, 'november', 'Completed canonical history is not replaced by a preview');
  console.log('PASS month navigation rejects stale loads, keeps records on errors and respects completed history');
})().catch(error => { console.error(error); process.exitCode = 1; });
