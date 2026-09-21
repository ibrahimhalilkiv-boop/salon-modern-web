const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const elements = {};
function classList() { const values = new Set(); return { add(v){values.add(v)}, remove(v){values.delete(v)}, contains(v){return values.has(v)} }; }
global.window = global;
global.appts = [
  { id: 'a-1', customer: 'Ahmet', date: '2026-09-21', time: '10:00' },
  { id: 'b-2', customer: 'Mehmet', date: '2026-09-21', time: '11:00' },
];
global.editingAppointmentId = 'a-1';
global.canManageOwnAppointment = () => true;
global.friendlyDate = value => value;
global.appointmentDate = item => item.date;
global.safe = String;
global.document = {
  getElementById(id) { return elements[id] || null; },
  createElement() { return { id: '', className: '', innerHTML: '', classList: classList() }; },
  body: { appendChild(modal) {
    elements[modal.id] = modal;
    elements.appointmentDeleteDetails = { innerHTML: '' };
    elements.appointmentDeleteConfirm = { disabled: false, textContent: '' };
  } },
};
global.renderHomeSummary = () => {};
global.render = () => {};
global.renderCalendar = () => {};
global.renderStatistics = () => {};
global.closeAppointmentModal = () => {};
global.reloadRemoteData = async () => {};
global.showAppToast = () => {};

let deleteCalls = 0;
let deleteError = null;
global.salonDb = { from(table) {
  assert.equal(table, 'appointments');
  return { delete() { return this; }, eq(column, id) {
    assert.equal(column, 'id');
    assert.ok(['a-1', 'b-2'].includes(id));
    return this;
  }, async select() { deleteCalls++; return deleteError ? { data: null, error: deleteError } : { data: [{ id: 'a-1' }], error: null }; } };
} };

vm.runInThisContext(fs.readFileSync('appointment-management-2.3.26.js', 'utf8'));

(async () => {
  const managementSource = fs.readFileSync('appointment-management-2.3.26.js', 'utf8');
  assert.match(managementSource, /Promise\.race\(\[Promise\.resolve\(request\)/, 'Silme isteği tarayıcıyı süresiz kilitlememeli');
  assert.match(managementSource, /function finishUi\(\)/, 'Silme sonrası arayüz tek merkezden kapatılmalı');
  const buttonSource = fs.readFileSync('appointment-cancel-button-2.3.27.js', 'utf8');
  const authCleanupSource = fs.readFileSync('pwa-auth-contact-cleanup-2.3.25.js', 'utf8');
  assert.equal(managementSource.includes('Randevu Yönetimi'), false, 'Eski yönetim ekranı geri gelmemeli');
  assert.equal(managementSource.includes("update(values)"), false, 'Silme, status güncellemesine dönüşmemeli');
  assert.equal(buttonSource.includes('Randevuyu iptal et'), false, 'İptal eylemi kalmamalı');
  assert.equal(authCleanupSource.includes('Randevuyu iptal et'), false, 'Eski PWA katmanı iptal düğmesi üretmemeli');
  assert.equal(buttonSource.match(/permanentAppointmentDelete/g).length >= 1, true, 'Tek kalıcı sil düğmesi kurulmalı');

  requestAppointmentDeletion('a-1');
  assert.equal(deleteCalls, 0, 'Sil düğmesi veritabanını doğrudan değiştirmemeli');
  assert.equal(elements.appointmentDeleteModal.classList.contains('show'), true, 'Onay modalı açılmalı');
  assert.match(elements.appointmentDeleteDetails.innerHTML, /Ahmet/, 'Onayda müşteri görünmeli');
  assert.match(elements.appointmentDeleteDetails.innerHTML, /2026-09-21/, 'Onayda tarih görünmeli');
  assert.match(elements.appointmentDeleteDetails.innerHTML, /10:00/, 'Onayda saat görünmeli');
  closeAppointmentDeleteModal();
  assert.equal(appts.length, 2, 'Vazgeç tüm randevuları korumalı');

  requestAppointmentDeletion('a-1');
  await Promise.all([confirmAppointmentDeletion(), confirmAppointmentDeletion()]);
  assert.equal(deleteCalls, 1, 'Çift dokunma tek DELETE üretmeli');
  assert.deepEqual(appts.map(item => item.id), ['b-2'], 'Yalnız seçilen randevu kaldırılmalı');

  appts.unshift({ id: 'a-1', customer: 'Ahmet', date: '2026-09-21', time: '10:00' });
  deleteError = new Error('RLS denied');
  requestAppointmentDeletion('a-1');
  await confirmAppointmentDeletion();
  assert.equal(appts.some(item => item.id === 'a-1'), true, 'DELETE hatasında UI kaydı korunmalı');
  console.log('PASS secure appointment deletion');
})().catch(error => { console.error(error); process.exitCode = 1; });
