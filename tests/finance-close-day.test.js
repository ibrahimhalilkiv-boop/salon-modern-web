const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('salon-finance-2.3.0.js', 'utf8');
const section = source.slice(source.indexOf('function requestCloseDay('), source.indexOf('function expenseCategories('));
const button = { disabled: false, textContent: 'Onayla ve günü kapat' };
const elements = {
  finance230Date: { value: '2026-10-22' },
  finance230Summary: { dataset: { summary: JSON.stringify({ distributable_revenue: 1000, distributable_amount: 800 }) } }
};
const calls = [], messages = [];
let role = 'yonetici', resolveRpc;
const ctx = vm.createContext({
  window: {}, finance230Busy: false, financeState: { loaded: true },
  document: { getElementById: id => elements[id], querySelector: () => button },
  manager: () => role === 'yonetici', today: () => '2026-10-22', money: value => String(value || 0), esc: String,
  errText: error => error.message, toast: (...args) => messages.push(args),
  openFinance230Action: (...args) => calls.push(['panel', ...args]),
  openFinance230: tab => calls.push(['open', tab]),
  loadFinance230: async force => calls.push(['load', force]),
  salonDb: {
    rpc(name, args) { calls.push(['rpc', name, args]); return new Promise(resolve => { resolveRpc = resolve; }); },
    from(table) { assert.equal(table, 'daily_cash_closings'); return {
      select() { return this; }, eq(field, date) { assert.equal(field, 'business_date'); assert.equal(date, '2026-10-22'); return this; },
      maybeSingle() { return Promise.resolve({ data: { business_date: '2026-10-22', status: 'closed', revision: 2 }, error: null }); }
    }; }
  }
});
vm.runInContext(section, ctx);

(async () => {
  ctx.window.requestCloseDay();
  assert.match(calls[0][2], /onclick="closeFinance230Day\('2026-10-22'\)"/);
  assert.equal(typeof ctx.window.closeFinance230Day, 'function', 'Inline onay düğmesi global işlevi bulmalı');
  const first = ctx.window.closeFinance230Day('2026-10-22');
  assert.equal(button.disabled, true);
  await ctx.window.closeFinance230Day('2026-10-22');
  assert.equal(calls.filter(x => x[0] === 'rpc').length, 1, 'Eşzamanlı tıklama tek RPC göndermeli');
  resolveRpc({ data: 'closing-id', error: null });
  await first;
  assert.equal(button.disabled, false);
  assert.equal(ctx.financeState.loaded, false);
  assert.deepEqual(calls.filter(x => x[0] === 'load'), [['load', true]]);
  assert.deepEqual(messages.at(-1), ['Gün kapatıldı', 'Tek kasa ve fon aktarımı kaydedildi.']);
  role = 'personel';
  await ctx.window.closeFinance230Day('2026-10-22');
  assert.equal(calls.filter(x => x[0] === 'rpc').length, 1, 'Çalışan kapanış başlatamamalı');
  console.log('PASS finance close day: inline handler, RPC, verified status, double click and employee guard');
})().catch(error => { console.error(error); process.exitCode = 1; });
