const assert = require('node:assert/strict');
const fs = require('node:fs');

const index = fs.readFileSync('index.html', 'utf8');
const shell = fs.readFileSync('salon-modern.html', 'utf8');
const actions = fs.readFileSync('appointment-form-actions-2.3.30.js', 'utf8');
const worker = fs.readFileSync('sw.js', 'utf8');

for (const html of [index, shell]) {
  assert.match(html, /customer_debts'\)\.insert\(debtRows\)\.select\('id,appointment_id,client_id,amount,status'\)/, 'Yeni borç kaydı sunucudan geri okunmalı');
  assert.match(html, /debtResult\.data\.length!==expectedDebtCount/, 'Borç kayıt sayısı doğrulanmalı');
  assert.match(html, /appointment-form-actions-2\.3\.30\.js/, 'Form eylem katmanı yüklenmeli');
}

assert.match(actions, /form\.onsubmit=runSave/, 'Kaydetme için doğrudan form handler bulunmalı');
assert.match(actions, /save\.onclick=runSave/, 'Kaydet düğmesi doğrudan çalışmalı');
assert.match(actions, /remove\.onclick=runDelete/, 'Sil düğmesi doğrudan onay akışını açmalı');
assert.match(actions, /back\.onclick=runBack/, 'Vazgeç düğmesi doğrudan çalışmalı');
assert.match(actions, /share\.onclick=runShare/, 'WhatsApp düğmesi doğrudan çalışmalı');
assert.match(actions, /closeAppointmentModal/, 'Vazgeç düğmesi doğrudan modalı kapatmalı');
assert.match(actions, /requestAppointmentDeletion|permanentAppointmentDelete/, 'Sil düğmesi güvenli silme katmanında kalmalı');
assert.match(worker, /salon-modern-shell-pwa-v27/, 'Yeni PWA cache sürümü kullanılmalı');
assert.match(worker, /appointment-form-actions-2\.3\.30\.js/, 'Yeni form katmanı offline kabuğuna eklenmeli');

console.log('PASS appointment debt verification and form actions');
