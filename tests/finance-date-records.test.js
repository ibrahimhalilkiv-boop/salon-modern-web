const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('salon-finance-2.3.0.js', 'utf8');
const input = { value: '2026-10-01' }, holder = { innerHTML: '' };
const context = {
  finance230DateRequest: 1, financeState: { expenses: [] },
  document: { getElementById: id => id === 'finance230Date' ? input : holder },
  esc: String, money: String, errText: error => error.message,
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('async function loadFinance230Expenses('), source.indexOf('function openFinance230Edit(')), context);
let calls = [], resolveOld;
context.salonDb = { from(table) {
  assert.equal(table, 'business_expenses');
  let date;
  return { select() { return this; }, eq(field, value) { assert.equal(field, 'expense_date'); date = value; return this; }, order() { return this; }, range(start, end) {
    calls.push({ date, start, end });
    if (date === '2026-09-30') return new Promise(resolve => { resolveOld = resolve; });
    return Promise.resolve({ data: start === 0 ? Array.from({ length: 500 }, (_, i) => ({ id: String(i), expense_date: date, category: 'Gider', amount: 10 })) : [{ id: 'last', expense_date: date, category: 'Ana gider', account_scope: 'reserve', amount: 20 }] });
  } };
} };
(async () => {
  await context.loadFinance230Expenses(input.value, 1);
  assert.equal(context.financeState.expenses.length, 501);
  assert.equal(calls.length, 2);
  assert.match(holder.innerHTML, /2026-10-01/);
  assert.match(holder.innerHTML, /Ana gider/);
  context.financeState.expenses.push({ id: 'other', expense_date: '2026-09-29', category: 'OTHER_DAY' });
  assert.doesNotMatch(context.financeRecordsHtml(input.value), /OTHER_DAY/);
  assert.match(context.financeRecordsHtml('2020-01-01'), /Bu tarihte gider kaydı yok/);
  const old = context.loadFinance230Expenses('2026-09-30', 1);
  context.finance230DateRequest = 2;
  await context.loadFinance230Expenses(input.value, 2);
  resolveOld({ data: [{ id: 'stale', expense_date: '2026-09-30' }] });
  await old;
  assert.equal(context.financeState.expenses.length, 501);
  context.salonDb.from = () => ({ select() { return this; }, eq() { return this; }, order() { return this; }, range() { return Promise.resolve({ error: { message: 'Test query error' } }); } });
  await context.loadFinance230Expenses(input.value, 2);
  assert.match(holder.innerHTML, /Test query error/);
  assert.equal(context.financeState.expenses.length, 501);
  assert.doesNotMatch(source, /expenses\.slice\(0,30\)/);
  assert.match(source, /accounting\.remove\(\)/);
  assert.match(source, /else if\(!cashButton.parentElement\)menu.appendChild\(cashButton\)/);
  console.log('PASS date-filtered expenses, 501 records, stale response protection, empty/error states and navigation independence');
})().catch(error => { console.error(error); process.exitCode = 1; });
