const assert = require('node:assert/strict');
const fs = require('node:fs');

const pages = [fs.readFileSync('salon-modern.html', 'utf8')];
const migration = fs.readFileSync('supabase/migrations/20260924103000_delete_linked_debt_with_appointment.sql', 'utf8');

for (const page of pages) {
  assert.match(page, /appointment_id:saved\.id/, 'Yeni borç oluşturulan randevuya bağlanmalı');
  assert.match(page, /existingDebt=originalId\?remoteDebts\.find\(function\(item\)\{return String\(item\.appointment_id\)===String\(originalId\)\}\)/, 'Aynı randevunun mevcut borcu durumdan bağımsız bulunmalı');
  assert.match(page, /if\(onDebt&&!existingDebt\)/, 'Existing appointment debt must not be recreated');
  assert.doesNotMatch(page, /original_amount:amount,paid_amount:0/, 'Editing an appointment must not erase recorded debt payments');
  assert.doesNotMatch(page, /savedWhatsAppUrl/, 'Borçlu veya normal randevuda ikinci bir WhatsApp taslağı otomatik açılmamalı');
  assert.match(page, /salonDb\.from\('appointments'\)\.insert\(rows\)/, 'Randevu kayıt yolu korunmalı');
}

assert.match(migration, /delete from public\.customer_debts where appointment_id = old\.id/, 'Yalnız silinen randevuya bağlı borç kaldırılmalı');
assert.match(migration, /current_setting\('salon\.appointment_debt_cascade'/, 'Randevu cascade silmesi ödeme işlemine çevrilmemeli');
assert.match(migration, /unique index if not exists customer_debts_one_per_appointment_idx/, 'Bir randevuya en fazla bir borç veritabanında korunmalı');

console.log('PASS debt lifecycle and WhatsApp trigger decision');
