const assert = require('node:assert/strict');
const fs = require('node:fs');

const pages = [fs.readFileSync('index.html', 'utf8'), fs.readFileSync('salon-modern.html', 'utf8')];
const migration = fs.readFileSync('supabase/migrations/20260924103000_delete_linked_debt_with_appointment.sql', 'utf8');

for (const page of pages) {
  assert.match(page, /appointment_id:saved\.id/, 'Yeni borç oluşturulan randevuya bağlanmalı');
  assert.match(page, /existingDebt=originalId\?remoteDebts\.find\(function\(item\)\{return String\(item\.appointment_id\)===String\(originalId\)\}\)/, 'Aynı randevunun mevcut borcu durumdan bağımsız bulunmalı');
  assert.match(page, /original_amount:amount,paid_amount:0,debt_date:date,status:'open',paid_at:null/, 'Mevcut ilişkili borç mükerrer kayıt yerine güvenle güncellenmeli');
  assert.doesNotMatch(page, /savedWhatsAppUrl=!onDebt&&phone/, 'Borca yazılan yeni randevuda WhatsApp engellenmemeli');
  assert.match(page, /savedWhatsAppUrl=phone\?\(originalId\?\(appointmentUpdateNeedsWhatsApp/, 'Mevcut randevuda yalnız anlamlı güncelleme WhatsApp açmalı');

  const expression = page.match(/var savedWhatsAppUrl=([^;]+);/)[1];
  const decide = new Function(
    'phone','originalId','original','employee','date','time','staffName','customer','amount','operation',
    'appointmentUpdateNeedsWhatsApp','whatsappAppointmentUpdateUrl','whatsappAppointmentUrl',
    `return ${expression}`
  );
  const employee = { id: 'employee-1', full_name: 'Halil Kıv' };
  const common = ['05320000000', null, null, employee, '2026-09-25', '10:00', 'Halil Kıv', 'Ahmet', 500, 'Saç'];
  assert.equal(decide(...common, () => false, () => 'UPDATE', () => 'CREATE'), 'CREATE', 'Borç durumundan bağımsız yeni kayıt WhatsApp açmalı');
  assert.equal(decide('05320000000','appointment-1',{},employee,'2026-09-25','10:00','Halil Kıv','Ahmet',500,'Saç',() => false,() => 'UPDATE',() => 'CREATE'), '', 'Yalnız borca çevirilen mevcut kayıt WhatsApp açmamalı');
  assert.equal(decide('05320000000','appointment-1',{},employee,'2026-09-25','11:00','Halil Kıv','Ahmet',500,'Saç',() => true,() => 'UPDATE',() => 'CREATE'), 'UPDATE', 'Saat/tarih/çalışan güncellemesinin mevcut WhatsApp davranışı korunmalı');
}

assert.match(migration, /delete from public\.customer_debts where appointment_id = old\.id/, 'Yalnız silinen randevuya bağlı borç kaldırılmalı');
assert.match(migration, /current_setting\('salon\.appointment_debt_cascade'/, 'Randevu cascade silmesi ödeme işlemine çevrilmemeli');
assert.match(migration, /unique index if not exists customer_debts_one_per_appointment_idx/, 'Bir randevuya en fazla bir borç veritabanında korunmalı');

console.log('PASS debt lifecycle and WhatsApp trigger decision');
