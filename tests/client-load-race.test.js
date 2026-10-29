const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('smart-customer-analysis-1.7.0.js', 'utf8');
const pending = [];
const ctx = vm.createContext({ currentUser: { id: 'first', role: 'yonetici' }, remoteClients: [], clients: [],
  salonDb: { from() {
    const query = { select() { return this; }, eq() { return this; }, order() { return this; },
      limit() { return this; }, gt() { return this; },
      then(resolve) { pending.push(resolve); } };
    return query;
  } }
});
vm.runInContext(source.slice(source.indexOf('var smartClientLoadPromise='), source.indexOf('var previousLoadV151Smart=')), ctx);
const tick = () => new Promise(resolve => setImmediate(resolve));
const row = name => ({ id: name, full_name: name, phone: 'shared-phone' });
(async () => {
  const first = ctx.smartLoadActiveClients();
  assert.equal(ctx.smartLoadActiveClients(), first, 'Same user shares one in-flight read');
  await tick();
  ctx.currentUser = { id: 'second', role: 'yonetici' };
  const second = ctx.smartLoadActiveClients();
  await tick();
  assert.equal(pending.length, 2, 'New login must issue its own authorized read');
  pending[0]({ data: [row('stale')], error: null });
  await first;
  assert.equal(ctx.remoteClients.length, 0);
  assert.equal(ctx.smartLoadActiveClients(), second, 'Old completion must not clear new in-flight read');
  pending[1]({ data: [row('B'), row('A')], error: null });
  await second;
  assert.deepEqual(Array.from(ctx.remoteClients, r => r.id), ['A', 'B'], 'Shared phone must not merge clients');
  const old = ctx.smartLoadActiveClients(); await tick();
  const fresh = ctx.smartLoadActiveClients(true); await tick();
  pending[3]({ data: [row('new')], error: null }); await fresh;
  pending[2]({ data: [row('old')], error: null }); await old;
  assert.equal(ctx.remoteClients[0].id, 'new', 'Realtime forced refresh supersedes stale read');
  const logout = ctx.smartLoadActiveClients(); await tick(); ctx.currentUser = null;
  pending[4]({ data: [row('after-logout')], error: null }); await logout;
  assert.equal(ctx.remoteClients[0].id, 'new');
  await ctx.smartLoadActiveClients(); assert.equal(pending.length, 5, 'No unauthenticated read');
  console.log('PASS client pagination loader: dedupe, account switch, forced refresh, shared phone and logout');
})().catch(error => { console.error(error); process.exitCode = 1; });
