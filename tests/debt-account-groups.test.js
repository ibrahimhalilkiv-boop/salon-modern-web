const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const primaryMigration = fs.readFileSync('supabase/migrations/20260924150000_add_primary_debt_account_member.sql', 'utf8');
assert.match(primaryMigration, /add column if not exists is_primary boolean not null default false/, 'Ana kişi alanı mevcut grupları bozmadan eklenmeli');
assert.match(primaryMigration, /row_number\(\) over/, 'Mevcut gruplara deterministik bir ana kişi atanmalı');
assert.match(primaryMigration, /where is_primary/, 'Her grupta birden fazla ana kişi veritabanında engellenmeli');

const debtList = { innerHTML: '' };
const head = { appendChild() {} };
global.window = global;
global.currentUser = { id: 'manager-1', role: 'yonetici' };
global.remoteClients = [
  { id: 'ahmet-id', full_name: 'Ahmet Yılmaz', phone: '05321111111' },
  { id: 'mehmet-id', full_name: 'Mehmet Yılmaz', phone: '05322222222' },
];
global.remoteDebts = [
  { id: 'd1', appointment_id: 'a1', client_id: 'ahmet-id', client_name: 'Ahmet Yılmaz', amount: 500, status: 'open' },
  { id: 'd2', appointment_id: 'a2', client_id: 'mehmet-id', client_name: 'Mehmet Yılmaz', amount: 250, status: 'open' },
  { id: 'd-old', client_id: 'ahmet-id', client_name: 'Ahmet Yılmaz', amount: 125, status: 'open' },
  { id: 'd3', client_id: 'mehmet-id', client_name: 'Mehmet Yılmaz', amount: 100, status: 'paid' },
];
global.appts = [
  { id: 'a1', operation: 'Saç kesimi' },
  { id: 'a2', operation: 'Sakal tıraşı' },
];
global.document = {
  getElementById(id) { return id === 'debtList' ? debtList : null; },
  createElement() { return { textContent: '', innerHTML: '', classList: { add() {}, remove() {} } }; },
  head,
  body: { appendChild() {} },
};
global.safe = String;
global.jsAttr = JSON.stringify;
global.avatarFor = name => name.slice(0, 2);
global.formatTry = amount => `${Number(amount).toFixed(2)} TL`;
global.debtCustomerKey = debt => `id:${debt.client_id}`;
global.renderDebts = () => {};
global.renderDebtDetail = () => {};
global.subscribeSalon = () => {};
global.logout = async () => {};
global.loadV151Supplement = async () => {};
global.showPage = () => {};
global.showAppToast = () => {};
global.salonDb = {
  from(table) {
    return {
      select() {
        if (table === 'debt_account_groups') return { order: async () => ({ data: [{ id: 'family-1', name: 'Yılmaz Ailesi' }], error: null }) };
        return Promise.resolve({ data: [
          { group_id: 'family-1', client_id: 'ahmet-id', relationship_label: 'Baba', is_primary: true },
          { group_id: 'family-1', client_id: 'mehmet-id', relationship_label: 'Oğul', is_primary: false },
        ], error: null });
      },
    };
  },
  channel() { return { on() { return this; }, subscribe() { return this; } }; },
  removeChannel() {},
};

vm.runInThisContext(fs.readFileSync('debt-account-groups-2.3.29.js', 'utf8'));

(async () => {
  await global.loadV151Supplement();
  global.renderDebts();
  assert.match(debtList.innerHTML, /Yılmaz Ailesi/);
  assert.match(debtList.innerHTML, /Ahmet Yılmaz/);
  assert.match(debtList.innerHTML, /Mehmet Yılmaz/);
  assert.match(debtList.innerHTML, /Saç kesimi/);
  assert.match(debtList.innerHTML, /Sakal tıraşı/);
  assert.match(debtList.innerHTML, /Eski borç kaydı/);
  assert.match(debtList.innerHTML, /İlişkili toplam borç: 875\.00 TL/);
  assert.match(debtList.innerHTML, /875\.00 TL/);
  assert.doesNotMatch(debtList.innerHTML, /975\.00 TL/);
  assert.equal(global.remoteDebts[0].client_id, 'ahmet-id');
  assert.equal(global.remoteDebts[1].client_id, 'mehmet-id');
  console.log('PASS debt account group total and customer_id isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });
