const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('salon-performance-2.3.14.js', 'utf8');
let reads = 0;
const appts = Array.from({ length: 2091 }, (_, i) => ({ get id() { reads++; return String(i); }, customer: `Customer ${i}`, amount: i }));
const cards = Array.from({ length: 100 }, (_, i) => ({
  label: { innerHTML: '' }, getAttribute: () => `appointmentClick('${1991 + i}')`,
  querySelector() { return this.label; }
}));
const ctx = { appts, Map, renderCalendar: () => 'base', priceText: row => `${row.amount} TL`, safe: String,
  document: { querySelectorAll: () => cards } };
ctx.window = ctx;
vm.runInNewContext(source.slice(source.indexOf('var renderCalendarBeforePrice='), source.indexOf('function ensureAppointmentPriceModal')), ctx);
assert.equal(ctx.renderCalendar(), 'base');
assert.equal(cards[0].label.innerHTML, 'Customer 1991 <span class="calendar-price">· 1991 TL</span>');
assert.equal(cards[99].label.innerHTML, 'Customer 2090 <span class="calendar-price">· 2090 TL</span>');
assert.equal(reads, 2091, 'Each appointment indexed once, no full-history search for every visible card');
console.log('PASS calendar prices unchanged; 204150 linear ID reads reduced to 2091 for 100 cards / 2091 appointments');
