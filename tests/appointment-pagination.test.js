const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const context = { window: {}, Date };
vm.runInNewContext(fs.readFileSync('salon-appointment-data.js', 'utf8'), context);
const loader = context.window.SalonAppointmentData;

let rows = Array.from({ length: 50000 }, (_, n) => ({
  id: String(n).padStart(6, '0'),
  scheduled_at: n < 30000 ? '2026-09-15T09:00:00+03:00' : '2026-11-15T09:00:00+03:00',
  status: 'confirmed', employee_id: n % 2 ? 'employee' : 'manager'
}));
for (let n = 0; n < 6; n++) rows[49000 + n].scheduled_at = '2026-10-19T10:00:00+03:00';
const allRows = rows;

function db(role) {
  return { from(table) {
    assert.equal(table, 'appointments');
    const filters = [];
    let limit = 500, orders = [];
    const query = {
      select() { return this; }, neq(column, value) { filters.push(row => row[column] !== value); return this; },
      gte(column, value) { filters.push(row => row[column] >= value); return this; },
      lt(column, value) { filters.push(row => row[column] < value); return this; },
      order(column, options) { orders.push([column, options.ascending]); return this; },
      limit(count) { limit = count; return this; },
      or(filter) {
        const match = filter.match(/^scheduled_at\.lt\.(.+),and\(scheduled_at\.eq\.(.+),id\.lt\.(.+)\)$/);
        assert(match, 'stable keyset filter');
        filters.push(row => row.scheduled_at < match[1] || (row.scheduled_at === match[2] && row.id < match[3]));
        return this;
      },
      then(resolve) {
        let result = rows.filter(row => (role === 'manager' || row.employee_id === role) && filters.every(test => test(row)));
        result.sort((a, b) => {
          for (const [column, ascending] of orders) {
            const difference = a[column].localeCompare(b[column]);
            if (difference) return ascending ? difference : -difference;
          }
          return 0;
        });
        return Promise.resolve({ data: result.slice(0, Math.min(limit, 1000)), error: null }).then(resolve);
      }
    };
    return query;
  } };
}

(async () => {
  for (const size of [999, 1000, 1001, 2000, 5000, 10000, 50000]) {
    rows = allRows.slice(0, size);
    const result = await loader.load(db('manager'), '*', '2026-10-19');
    assert.equal(result.length, size, `${size} appointments load without a hidden ceiling`);
    assert.equal(new Set(result.map(row => row.id)).size, size);
  }
  rows = allRows;
  let previewRows = null;
  const manager = await loader.load(db('manager'), '*', '2026-10-19', visible => { previewRows = visible; });
  assert.equal(previewRows.length, 6, 'Calendar receives only the selected month before full history');
  assert.equal(manager.length, 50000);
  assert.equal(manager.filter(row => row.scheduled_at.startsWith('2026-10-19')).length, 6);
  assert.equal(new Set(manager.map(row => row.id)).size, 50000);
  const employee = await loader.load(db('employee'), '*', '2026-10-19');
  assert.equal(employee.length, 25000);
  assert.equal(employee.filter(row => row.scheduled_at.startsWith('2026-10-19')).length, 3);
  const first = loader.nextGeneration(), second = loader.nextGeneration();
  assert.equal(loader.isCurrent(first), false);
  assert.equal(loader.isCurrent(second), true);
  assert.deepEqual(JSON.parse(JSON.stringify(loader.monthBounds('2026-12-31'))),
    { start: '2026-12-01T00:00:00+03:00', end: '2027-01-01T00:00:00+03:00' });
  assert.deepEqual(JSON.parse(JSON.stringify(loader.dayBounds('2026-12-31'))),
    { start: '2026-12-31T00:00:00+03:00', end: '2027-01-01T00:00:00+03:00' });
  rows = Array.from({ length: 1205 }, (_, n) => ({ id: String(n).padStart(6, '0'), scheduled_at: '2026-10-30T10:00:00+03:00', status: 'confirmed', employee_id: 'manager' }))
    .concat(Array.from({ length: 15 }, (_, n) => ({ id: String(1300 + n), scheduled_at: '2026-10-28T10:00:00+03:00', status: 'completed', employee_id: 'manager' })))
    .concat([{ id: '999999', scheduled_at: '2026-10-30T10:00:00+03:00', status: 'cancelled', employee_id: 'manager' }]);
  const upcoming = await loader.loadVisible(db('manager'), '*', '2026-10-29', '2026-10-29');
  assert.equal(upcoming.length, 1205, 'calendar keeps over 1000 upcoming appointments');
  assert.equal(new Set(upcoming.map(row => row.id)).size, 1205);
  let upcomingPreview;
  const history = await loader.load(db('manager'), '*', '2026-10-29', visible => { upcomingPreview = visible; }, null, '2026-10-29');
  assert.equal(upcomingPreview.length, 1205, 'past and cancelled rows stay off the calendar');
  assert.equal(history.length, 1220, 'past appointments remain available to finance and history');
  rows = allRows.slice(0, 1200).concat(allRows.slice(49000, 49006));
  let releaseMonth, dayReady;
  const monthGate = new Promise(resolve => { releaseMonth = resolve; });
  const daySignal = new Promise(resolve => { dayReady = resolve; });
  const delayedDb = { from(table) {
    const query = db('manager').from(table);
    let lower = '', upper = '';
    const gte = query.gte, lt = query.lt, then = query.then;
    query.gte = function(column, value) { if (column === 'scheduled_at') lower = value; return gte.call(this, column, value); };
    query.lt = function(column, value) { if (column === 'scheduled_at') upper = value; return lt.call(this, column, value); };
    query.then = function(resolve, reject) {
      if (lower === '2026-10-01T00:00:00+03:00' && upper === '2026-11-01T00:00:00+03:00')
        return monthGate.then(() => then.call(this, resolve, reject));
      return then.call(this, resolve, reject);
    };
    return query;
  } };
  const stages = [];
  const pending = loader.load(delayedDb, '*', '2026-10-19',
    visible => stages.push(['month', visible.length]),
    day => { stages.push(['day', day.length]); dayReady(); });
  await daySignal;
  assert.deepEqual(stages, [['day', 6]], 'selected day appears while the month is still loading');
  releaseMonth();
  const priorityRows = await pending;
  assert.deepEqual(stages, [['day', 6], ['month', 6]]);
  assert.equal(priorityRows.length, 1206, 'background history completes without losing records');
  console.log('PASS 999 through 50,000 paginated appointments, late visible date, RLS-shaped employee result, generation and month rollover');
})().catch(error => { console.error(error); process.exitCode = 1; });
