const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('pwa-stability-2.3.20.js', 'utf8');
const begin = source.indexOf('  async function runLoadRemoteSession() {');
const end = source.indexOf('\n  window.loadRemoteSession = function ()', begin);
assert(begin > -1 && end > begin, 'The real authenticated startup function exists');

function fixture(verified) {
  let startBackground, finishHistory;
  const events = [];
  const history = new Promise(resolve => { finishHistory = resolve; });
  const context = {
    authRequest: 0, loadCount: 0,
    currentUser: null,
    appts: [{ id: 'stale-account' }], staff: [['Stale Staff']],
    remoteProfiles: [{ id: 'stale' }], remoteServices: [{ id: 'stale' }], remoteClients: [{ id: 'stale' }],
    teamCalendarMode: 'month', teamCalendarDate: '2026-10-01', teamCalendarMember: 'Stale Staff',
    salonCalendarToday: () => '2026-11-01',
    selectedTeamDate: () => context.teamCalendarDate,
    storedAuthSnapshot: () => ({}),
    getVerifiedUser: async () => {
      if (!verified) throw new Error('invalid session');
      return { id: 'manager' };
    },
    loadProfile: async () => {
      context.currentUser = { id: 'manager', role: 'yonetici' };
      return true;
    },
    trace: event => events.push(event),
    setState: state => events.push('state:' + state),
    hideConnectionProblem: () => {},
    showConnectionProblem: () => { events.push('connection-error'); },
    isTemporary: () => false, localSignOut: async () => {},
    AUTH: { AUTHENTICATED: 'AUTHENTICATED', UNAUTHENTICATED: 'UNAUTHENTICATED' },
    console: { warn() {} },
    setTimeout: fn => { startBackground = fn; },
    window: {
      enterApp: () => events.push('calendar-shell'),
      showPage: page => {
        assert.equal(page, 'calendar', 'Always open calendar first');
        assert.equal(context.window.salonSuppressCalendarReload, true, 'Do not duplicate initial data requests');
        events.push('page:' + page);
      },
      reloadRemoteData: () => {
        events.push('history-start');
        return history;
      },
      subscribeSalon: () => events.push('realtime'),
      showAppToast: () => events.push('ready-toast')
    }
  };
  vm.runInNewContext(source.slice(begin, end), context);
  return { context, events, start: () => startBackground(), finishHistory };
}

(async () => {
  const f = fixture(true);
  await f.context.runLoadRemoteSession();
  assert.equal(f.context.window.salonHistoryState, 'loading');
  assert.equal(f.context.window.salonCalendarLoadState.status, 'loading');
  assert.equal(f.context.teamCalendarDate, '2026-11-01');
  assert.equal(f.context.teamCalendarMode, 'day');
  assert.deepEqual(f.context.appts, [], 'No stale or unverified appointments displayed');
  assert.deepEqual(f.context.staff, [], 'No old employee list displayed');
  assert(f.events.includes('calendar-shell'));
  assert(f.events.includes('page:calendar'));
  assert(f.events.includes('state:AUTHENTICATED'));
  assert(!f.events.includes('history-start'), 'First calendar paint precedes even starting the full history query');
  assert(!f.events.includes('realtime'), 'Realtime waits for the first day preview');
  f.start();
  await Promise.resolve();
  assert(f.events.includes('history-start'));
  f.context.window.salonCalendarLoadState = { status: 'ready', date: '2026-11-01' };
  f.context.window.salonOnCalendarPreview();
  assert(f.events.includes('realtime'), 'Realtime starts as soon as the verified day data appears');
  assert(!f.events.includes('ready-toast'), 'History still runs in the background');
  f.finishHistory();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert(f.events.includes('ready-toast'), 'Background data eventually finishes');

  const rejected = fixture(false);
  await rejected.context.runLoadRemoteSession();
  assert(!rejected.events.includes('calendar-shell'), 'Unverified sessions never see private calendar');
  assert(!rejected.events.includes('history-start'));
  console.log('PASS immediate verified calendar, guarded skeleton, day-first realtime, background history, unverified session denied');
})().catch(error => { console.error(error); process.exitCode = 1; });
