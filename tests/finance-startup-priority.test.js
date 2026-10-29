const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('salon-finance-2.3.0.js', 'utf8');
const begin = source.indexOf('var previousEnterApp=');
const end = source.indexOf('var style=', begin);
assert(begin > 0 && end > begin);

const listeners = new Map();
let idle, loads = 0;
const context = {
  window: {
    salonRemoteMode: true, salonHistoryState: 'loading',
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); }
  },
  currentUser: { role: 'yonetici' },
  manager: () => true,
  enterApp() {}, logout() {},
  syncFinance230Version() {},
  loadFinance230() { loads++; },
  requestIdleCallback(fn) { idle = fn; },
  setTimeout() { throw Error('Unexpected eager timer'); },
  Map
};
vm.runInNewContext(source.slice(begin, end), context);
context.enterApp();
assert.equal(loads, 0, 'finance must not compete with initial calendar requests');
assert.equal(typeof listeners.get('salon:data-ready'), 'function');
listeners.get('salon:data-ready')();
assert.equal(loads, 0, 'finance starts only during an idle period');
idle();
assert.equal(loads, 1);
console.log('PASS finance preload waits for calendar/history and an idle period');
