const assert = require('node:assert/strict');
const fs = require('node:fs');

const pages = ['index.html', 'salon-modern.html'].map(file => fs.readFileSync(file, 'utf8'));
const worker = fs.readFileSync('sw.js', 'utf8');
const management = fs.readFileSync('appointment-management-2.3.26.js', 'utf8');
const deleteButton = fs.readFileSync('appointment-cancel-button-2.3.27.js', 'utf8');
const debtWarning = fs.readFileSync('appointment-debt-warning-2.3.28.js', 'utf8');
const actions = fs.readFileSync('appointment-form-actions-2.3.30.js', 'utf8');
const pushMigration = fs.readFileSync('supabase/migrations/20260921121500_route_reminders_to_creator.sql', 'utf8');

const criticalScripts = [
  'appointment-management-2.3.26.js',
  'appointment-cancel-button-2.3.27.js',
  'appointment-debt-warning-2.3.28.js',
  'appointment-form-actions-2.3.30.js',
  'salon-web-push.js',
];

for (const page of pages) {
  for (const script of criticalScripts) {
    const count = page.split(`src="${script}"`).length - 1;
    assert.equal(count, 1, `${script} her HTML kabuğunda tam bir kez yüklenmeli`);
  }
}

for (const script of criticalScripts) {
  const count = worker.split(`'./${script}'`).length - 1;
  assert.equal(count, 1, `${script} PWA kabuğunda tam bir kez bulunmalı`);
}

assert.match(actions, /form\.onsubmit=saveNow/, 'Form submit tek doğrudan handler kullanmalı');
assert.match(actions, /save\.onclick=saveNow/, 'Kaydet düğmesi tek doğrudan handler kullanmalı');
assert.match(actions, /back\.onclick=cancelNow/, 'Vazgeç düğmesi tek doğrudan handler kullanmalı');
assert.match(actions, /panel\.onpointerdown=pick/, 'Mobil müşteri seçimi blur öncesinde yapılmalı');
assert.doesNotMatch(actions, /subtree\s*:\s*true/, 'Form observer alt ağaçta tekrar tekrar binding yapmamalı');

assert.match(management, /if\(!pendingId\|\|deleting\)return/, 'Çift silme isteği kilitlenmeli');
assert.match(management, /\.delete\(\)\.eq\('id',id\)\.select\('id'\)/, 'Silme yalnız seçilen randevu ID ile yapılmalı');
assert.doesNotMatch(management, /Randevuyu iptal et/, 'Eski iptal eylemi geri gelmemeli');
assert.doesNotMatch(deleteButton, /Randevuyu iptal et/, 'Modal düğmesi eski iptal davranışını üretmemeli');
assert.doesNotMatch(debtWarning, /subtree\s*:\s*true/, 'Borç uyarısı recursive observer kurmamalı');

assert.match(pushMigration, /select a\.created_by,a\.id,'appointment_reminder'/, 'Bir saatlik hatırlatma randevuyu oluşturana gitmeli');

console.log('PASS critical patch load order and singleton handlers');
