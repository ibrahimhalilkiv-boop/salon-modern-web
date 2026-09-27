const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

global.window = global;
global.document = { querySelectorAll() { return []; } };
global.renderCalendar = () => {};
global.renderStatistics = () => {};
global.renderCustomers = () => {};
global.renderCustomerDetail = () => {};
global.remoteOpenDebtAppointmentIds = new Set();

vm.runInThisContext(fs.readFileSync('salon-debt-visibility-2.3.15.js', 'utf8'));

global.remoteDebts = [
  { id: 'linked-open', appointment_id: 'appointment-1', client_id: 'client-1', amount: 500, status: 'open' },
  { id: 'historical-open', appointment_id: 'old-appointment', client_id: 'client-2', amount: 250, status: 'open' },
  { id: 'product-open', appointment_id: null, client_id: 'client-3', amount: 100, status: 'open' },
  { id: 'linked-paid', appointment_id: 'appointment-4', client_id: 'client-4', amount: 300, status: 'paid' },
];

assert.equal(global.appointmentHasOpenDebt({ id: 'appointment-1', clientId: 'client-1' }), true, 'Bağlı açık borç randevuyu kırmızı yapmalı');
assert.equal(global.appointmentHasOpenDebt({ id: 'appointment-2', clientId: 'client-2' }), false, 'Geçmiş borç yeni randevuyu kırmızı yapmamalı');
assert.equal(global.appointmentHasOpenDebt({ id: 'appointment-3', clientId: 'client-3' }), false, 'Ürün/bağımsız borcu takvimi etkilememeli');
assert.equal(global.appointmentHasOpenDebt({ id: 'appointment-4', clientId: 'client-4' }), false, 'Ödenmiş bağlı borç kırmızı olmamalı');
assert.equal(global.appointmentHasOpenDebt({ id: '', clientId: 'client-1' }), false, 'Randevu kimliği olmadan müşteri eşleşmesi yapılmamalı');

global.remoteDebts = [];
global.remoteOpenDebtAppointmentIds = new Set(['appointment-live']);
assert.equal(global.appointmentHasOpenDebt({ id: 'appointment-live' }), true, 'Hafif canlı borç indeksi takvim rengini borç detay sorgusundan bağımsız sağlamalı');

const html = fs.readFileSync('salon-modern.html', 'utf8');
const statistics = html.match(/renderStatistics=function\(\)\{[\s\S]*?\n\};/)?.[0] || '';
assert.doesNotMatch(statistics, /appointmentHasOpenDebt/, 'İstatistiklerde borç rengi uygulanmamalı');
assert.match(html, /appointmentHasOpenDebt\(item\)\?'appointment-debt-name'/, 'Takvimde randevuya bağlı borç rengi korunmalı');
assert.match(html, /select\('appointment_id'\)\.eq\('status','open'\)\.gt\('amount',0\)/, 'Takvim için açık borç randevu kimlikleri ayrı ve hafif sorgulanmalı');
assert.match(html, /profile\.active&&profile\.username!==['"]salon\.modern['"]/, 'Yalnız yönetim hesabı çalışan özetine ve takvime katılmamalı');
assert.match(fs.readFileSync('salon-debt-visibility-2.3.15.js', 'utf8'), /remoteOpenDebtAppointmentIds\.has\(appointmentId\)/, 'Son yüklenen borç görünürlük katmanı canlı indeksi kullanmalı');

const ui = fs.readFileSync('salon-ui-2.3.12.js', 'utf8');
assert.match(ui, /\.appointment-debt-name\{color:#b42318!important\}/, 'Borçlu randevu müşteri adı kırmızı olmalı');

console.log('PASS appointment-specific calendar debt visibility');
