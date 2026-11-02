const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const listeners = {};

const holder = { panel: null, querySelector: () => title, prepend(panel) { this.panel = panel; } };
const title = { after(panel) { holder.panel = panel; } };
function element(tag) {
  return { tag, children: [], append(...children) { this.children.push(...children); } };
}
const context = {
  currentUser: { role: 'yonetici' },
  remoteClients: [{ id: 'client-1', full_name: 'Mehmet Uncu', online_booking_blocked: false }],
  selectedCustomerId: 'client-1',
  renderCustomers() {},
  renderCustomerDetail() {
    holder.panel = null; // The async customer renderer replaces its loading markup.
    return Promise.resolve().then(() => { holder.panel = null; });
  },
  document: {
    head: { appendChild() {} },
    createElement: element,
    addEventListener(name, handler) { listeners[name] = handler; },
    getElementById(id) {
      if (id === 'customerDetailContent') return holder;
      if (id === 'customerBlacklistAction') return holder.panel?.children.find(child => child.id === id) || null;
      return null; // The customer phone editor is deliberately absent.
    },
  },
};
context.window = context;
vm.runInNewContext(fs.readFileSync('customer-online-blacklist-2.4.8.js', 'utf8'), context);
(async () => {
  await context.renderCustomerDetail();
  assert.equal(holder.panel.children[2].textContent, 'Kara listeye ekle');
  assert.equal(holder.panel.children[1].textContent, 'Bu müşteri online randevu alabilir.');
  context.remoteClients[0].online_booking_blocked = true;
  await context.renderCustomerDetail();
  assert.equal(holder.panel.children[2].textContent, 'Kara listeden çıkar');
  holder.panel = null; // A background refresh calls the async renderer directly.
  listeners['salon:customer-detail-rendered']({ detail: { clientId: 'client-1' } });
  assert.equal(holder.panel.children[2].textContent, 'Kara listeden çıkar');
  context.currentUser = { role: 'personel' };
  await context.renderCustomerDetail();
  assert.equal(holder.panel, null);
  console.log('PASS customer detail: action survives async redraw, correct state, manager only');
})().catch(error => { console.error(error); process.exitCode = 1; });
