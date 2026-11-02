const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

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
  renderCustomerDetail() {},
  document: {
    head: { appendChild() {} },
    createElement: element,
    getElementById(id) {
      if (id === 'customerDetailContent') return holder;
      if (id === 'customerBlacklistAction') return holder.panel?.children.find(child => child.id === id) || null;
      return null; // The customer phone editor is deliberately absent.
    },
  },
};
context.window = context;
vm.runInNewContext(fs.readFileSync('customer-online-blacklist-2.4.8.js', 'utf8'), context);
context.renderCustomerDetail();
assert.equal(holder.panel.children[2].textContent, 'Kara listeye ekle');
assert.equal(holder.panel.children[1].textContent, 'Bu müşteri online randevu alabilir.');
holder.panel = null;
context.remoteClients[0].online_booking_blocked = true;
context.renderCustomerDetail();
assert.equal(holder.panel.children[2].textContent, 'Kara listeden çıkar');
holder.panel = null;
context.currentUser = { role: 'personel' };
context.renderCustomerDetail();
assert.equal(holder.panel, null);
console.log('PASS customer detail: blacklist action visible without phone editor, correct state, manager only');
