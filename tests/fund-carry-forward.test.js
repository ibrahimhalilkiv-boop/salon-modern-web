const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('salon-finance-2.3.0.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20261031150000_current_reserve_balance_carries_over_months.sql', 'utf8');

assert.match(source, /salonDb\.rpc\('get_current_reserve_balance'\)/, 'Balance must come from an all-history server aggregate');
assert.doesNotMatch(source, /balance=financeState\.ledger\.reduce/, '50 recent movements cannot be used as the lifetime fund balance');
assert.match(migration, /v_month_start/, 'Prior-month carry must be calculated');
assert.match(migration, /where l\.entry_date <= v_today/, 'Do not include future-dated expenses');
assert.match(migration, /revoke all on function public\.get_current_reserve_balance\(\) from public, anon/, 'Do not expose fund data to anonymous clients');

const start = source.indexOf('function renderReserve(){');
const end = source.indexOf('async function saveFinance230Rule(', start);
assert(start >= 0 && end > start, 'Reserve renderer must exist');

const holder = {innerHTML: ''};
const sample = {
  as_of: '2026-10-31', opening_balance: 68832,
  contributions: 104000, main_expenses: -86781, adjustments: 0,
  current_month_movement: 17219, current_balance: 86051
};
const context = vm.createContext({
  document: {getElementById: id => id === 'finance230Reserve' ? holder : null},
  financeState: {
    reserveSummary: sample, rules: [], ledger: [
      {entry_type: 'main_expense', entry_date: '2026-10-30', amount: -64562}
    ]
  },
  money: amount => new Intl.NumberFormat('tr-TR').format(Number(amount || 0)),
  esc: value => String(value),
  today: () => '2026-10-31',
  finance230LedgerHtml: rows => rows.map(row => row.join(' ')).join(' | ')
});
vm.runInContext(source.slice(start,end), context);
context.renderReserve();
assert.match(holder.innerHTML, /86\.051/, 'Fund must show 86,051, not the partial last-50 balance');
assert.match(holder.innerHTML, /68\.832/, 'Past months must carry forward');
assert.match(holder.innerHTML, /17\.219/, 'Current month net movement must appear');
assert.match(holder.innerHTML, /Her ayın kalan fonu sonraki aya otomatik devreder/);
console.log('PASS fund carry-forward, partial-history protection, future-date cutoff and manager-only RPC');
