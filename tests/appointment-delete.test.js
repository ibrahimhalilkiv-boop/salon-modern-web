const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const elements = {};
function classList() { const values = new Set(); return { add(v){values.add(v)}, remove(v){values.delete(v)}, contains(v){return values.has(v)} }; }
global.window = global;
global.appts = [
  { id: 'a-1', customer: 'Ahmet', date: '2026-10-07', time: '10:00', status: 'confirmed' },
  { id: 'b-2', customer: 'Mehmet', date: '2026-10-07', time: '11:00', status: 'confirmed' },
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

let cancelCalls = 0;
let cancelError = null;
global.salonDb = { async rpc(name, args) {
  assert.equal(name, 'cancel_appointment');
  assert.equal(args.p_reason, null);
  assert.ok(['a-1', 'b-2'].includes(args.p_appointment_id));
  cancelCalls += 1;
  return cancelError ? { data: null, error: cancelError } : { data: { id: args.p_appointment_id, status: 'cancelled' }, error: null };
} };

vm.runInThisContext(fs.readFileSync('appointment-management-2.3.26.js', 'utf8'));

(async () => {
  const managementSource = fs.readFileSync('appointment-management-2.3.26.js', 'utf8');
  const buttonSource = fs.readFileSync('appointment-cancel-button-2.3.27.js', 'utf8');
  const htmlSource = fs.readFileSync('salon-modern.html', 'utf8');
  assert.match(managementSource, /rpc\('cancel_appointment'/, 'Normal cancellation must use the protected RPC');
  assert.doesNotMatch(managementSource, /from\('appointments'\)\.delete/, 'Active cancellation must not DELETE the appointment');
  assert.doesNotMatch(htmlSource, /from\('appointments'\)\.delete/, 'Legacy appointment flows must not physically delete appointments');
  assert.match(managementSource, /geçmiş kaydı korunacaktır/, 'Confirmation must explain history preservation');
  assert.match(buttonSource, /Randevuyu iptal et/, 'The appointment action must be cancellation');

  requestAppointmentDeletion('a-1');
  assert.equal(cancelCalls, 0, 'Opening confirmation must not change the database');
  assert.equal(elements.appointmentDeleteModal.classList.contains('show'), true);
  assert.match(elements.appointmentDeleteDetails.innerHTML, /Ahmet/);
  closeAppointmentDeleteModal();
  assert.equal(appts.length, 2, 'Vazgeç must preserve every appointment');

  requestAppointmentDeletion('a-1');
  await Promise.all([confirmAppointmentDeletion(), confirmAppointmentDeletion()]);
  assert.equal(cancelCalls, 1, 'Double tap must produce one cancellation RPC');
  assert.deepEqual(appts.map(item => item.id), ['b-2'], 'Only the cancelled appointment leaves the active UI');

  appts.unshift({ id: 'a-1', customer: 'Ahmet', date: '2026-10-07', time: '10:00', status: 'confirmed' });
  cancelError = new Error('RLS denied');
  requestAppointmentDeletion('a-1');
  await confirmAppointmentDeletion();
  assert.equal(appts.some(item => item.id === 'a-1'), true, 'RPC failure must keep the UI record');
  console.log('PASS secure soft appointment cancellation');
})().catch(error => { console.error(error); process.exitCode = 1; });
