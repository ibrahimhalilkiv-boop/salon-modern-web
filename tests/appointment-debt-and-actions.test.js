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

assert.match(actions, /form\.onsubmit=saveNow/, 'Kaydetme için doğrudan form handler bulunmalı');
assert.match(actions, /remove\.onclick=deleteNow/, 'Sil düğmesi doğrudan onayı açmalı');
assert.match(actions, /closeAppointmentModal/, 'Vazgeç düğmesi doğrudan modalı kapatmalı');
assert.match(actions, /requestAppointmentDeletion|permanentAppointmentDelete/, 'Sil düğmesi güvenli silme katmanında kalmalı');
assert.match(actions, /Promise\.race\(\[task/, 'Kayıt isteği tarayıcıyı süresiz kilitlememeli');
assert.match(actions, /Takvim arka planda doğrulanıyor/, 'Zaman aşımında kullanıcıya arka plan doğrulaması bildirilmeli');
assert.match(worker, /salon-modern-shell-pwa-v53/, 'Güncel PWA cache sürümü kullanılmalı');
assert.match(worker, /appointment-form-actions-2\.3\.30\.js/, 'Yeni form katmanı offline kabuğuna eklenmeli');

console.log('PASS appointment debt verification and form actions');

assert.match(actions, /save\.onclick=saveNow/, 'Kaydet düğmesi doğrudan click ile çalışmalı');
assert.match(actions, /back\.onclick=cancelNow/, 'Vazgeç düğmesi doğrudan click ile çalışmalı');

assert.match(actions, /saveWatchdog=setTimeout/, 'Kaydet işlemi takılı kalırsa arayüz serbest bırakılmalı');

assert.doesNotMatch(actions, /subtree:true/, 'Randevu modalı alt ağacında MutationObserver döngüsü olmamalı');

for (const file of ['appointment-debt-warning-2.3.28.js','appointment-cancel-button-2.3.27.js']) { const source=fs.readFileSync(file,'utf8'); assert.doesNotMatch(source,/subtree:\s*true/,file+' randevu modalında recursive observer kullanmamalı'); }

const html=fs.readFileSync('salon-modern.html','utf8');assert.match(actions,/panel\.onpointerdown=pick/,'Müşteri seçimi mobil blur öncesinde işlenmeli');assert.match(actions,/applyCustomerHistory\(client\)/,'Seçilen müşterinin telefon ve geçmiş bilgileri doldurulmalı');

const customerHtml=fs.readFileSync('salon-modern.html','utf8');const historyFn=customerHtml.match(/function applyCustomerHistory\(client\)\{[\s\S]*?\n\}/)?.[0]||'';assert.match(historyFn,/client\.phone/,'Müşteri seçimi telefonu doldurmalı');assert.match(historyFn,/lastAppointmentForClient/,'Müşteri seçimi son randevuyu bulmalı');assert.match(historyFn,/appointmentOperation/,'Son hizmet otomatik seçilmeli');assert.match(historyFn,/appointmentStaff/,'Son hizmeti veren çalışan otomatik seçilmeli');
