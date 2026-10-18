const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const context = { window: {}, Date };
vm.runInNewContext(fs.readFileSync('salon-appointment-data.js', 'utf8'), context);
const loader = context.window.SalonAppointmentData;

const rows = Array.from({ length: 10500 }, (_, n) => ({
  id: String(n).padStart(6, '0'),
  scheduled_at: n < 7000 ? '2026-09-15T09:00:00+03:00' : '2026-11-15T09:00:00+03:00',
  status: 'confirmed', employee_id: n % 2 ? 'employee' : 'manager'
}));
for (let n = 0; n < 6; n++) rows[9000 + n].scheduled_at = '2026-10-19T10:00:00+03:00';

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
  const manager = await loader.load(db('manager'), '*', '2026-10-19');
  assert.equal(manager.length, 10500);
  assert.equal(manager.filter(row => row.scheduled_at.startsWith('2026-10-19')).length, 6);
  assert.equal(new Set(manager.map(row => row.id)).size, 10500);
  const employee = await loader.load(db('employee'), '*', '2026-10-19');
  assert.equal(employee.length, 5250);
  assert.equal(employee.filter(row => row.scheduled_at.startsWith('2026-10-19')).length, 3);
  const first = loader.nextGeneration(), second = loader.nextGeneration();
  assert.equal(loader.isCurrent(first), false);
  assert.equal(loader.isCurrent(second), true);
  assert.deepEqual(JSON.parse(JSON.stringify(loader.monthBounds('2026-12-31'))),
    { start: '2026-12-01T00:00:00+03:00', end: '2027-01-01T00:00:00+03:00' });
  console.log('PASS 10,500 paginated appointments, visible date, RLS-shaped employee result, generation and month rollover');
})().catch(error => { console.error(error); process.exitCode = 1; });
