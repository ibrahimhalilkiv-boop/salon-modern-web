const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('salon-modern.html', 'utf8');
const begin = html.indexOf('reloadRemoteData=async function(){');
const end = html.indexOf('function renderServiceOptions(', begin);
assert(begin > 0 && end > begin, 'remote data loader exists');

let releaseMonth;
const monthGate = new Promise(resolve => { releaseMonth = resolve; });
let dayShown;
const daySignal = new Promise(resolve => { dayShown = resolve; });
const requests = [];
const rows = [{ id: 'today', client_name: 'Bugün' }, { id: 'older', client_name: 'Önce' }];
const currentUser = { id: 'manager', role: 'yonetici' };
const window = {
  salonHistoryState: 'loading',
  salonOnCalendarPreview() { dayShown(); },
  dispatchEvent(event) { requests.push(event.type); }
};
const dataFor = table => table === 'profiles' ? [{ id: 'manager', full_name: 'Halil', active: true, username: 'halil.kiv', role: 'manager' }]
  : table === 'services' ? [{ id: 'service', name: 'Saç', price: 500, active: true }]
  : table === 'clients' ? [{ id: 'client', full_name: 'Bugün' }] : [];
const salonDb = { from(table) {
  const query = {
    select() { return this; }, order() { return this; }, lt() { return this; }, gt() { return this; },
    then(resolve) { requests.push(table); return Promise.resolve({ data: dataFor(table), error: null }).then(resolve); }
  };
  return query;
} };
const SalonAppointmentData = {
  nextGeneration() { return 1; }, isCurrent(value) { return value === 1; },
  dayBounds() { return { start: 'day-start', end: 'day-end' }; },
  monthBounds() { return { start: 'month-start', end: 'month-end' }; },
  async load(db, columns, date, onVisible, onDay) {
    await onDay(rows.slice(0, 1));
    await monthGate;
    await onVisible(rows);
    return rows;
  }
};
const context = {
  window, currentUser, salonDb, SalonAppointmentData, Promise, Event,
  selectedTeamDate: () => '2026-10-29', teamCalendarMode: 'day',
  document: { getElementById: () => ({ classList: { contains: () => false } }) },
  remoteProfiles: [], remoteServices: [], remoteClients: [], staff: [], appts: [], clients: [], lastOperation: '',
  remoteAppointment: row => ({ id: row.id }), avatarFor: () => 'H',
  renderCalendar() {}, renderHomeSummary() {}, render() {}, renderUsers() {}, renderStatistics() {},
  showAppToast(title) { throw Error('Unexpected toast: ' + title); }
};
vm.runInNewContext(html.slice(begin, end), context);

(async () => {
  const pending = context.reloadRemoteData();
  await daySignal;
  assert.deepEqual(context.appts.map(row => row.id), ['today']);
  assert.equal(window.salonCalendarLoadState.status, 'ready');
  assert.equal(requests.includes('clients'), false, 'client list waits for the calendar');
  assert.equal(window.salonHistoryState, 'loading', 'history continues in the background');
  releaseMonth();
  await pending;
  assert.deepEqual(context.appts.map(row => row.id), ['today', 'older']);
  assert.equal(window.salonHistoryState, 'ready');
  assert.equal(requests.includes('clients'), true);
  assert.equal(requests.includes('salon:data-ready'), true);
  console.log('PASS selected day is visible before month, history and client list finish');
})().catch(error => { console.error(error); process.exitCode = 1; });
