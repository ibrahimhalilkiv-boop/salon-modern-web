const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('salon-modern.html', 'utf8');
const controls = fs.readFileSync('booking-schedule-controls-2.4.3.js', 'utf8');

assert.match(controls, /amount\.readOnly=false;amount\.disabled=false/, 'Ücret alanı her modal açılışında etkin olmalı');
assert.match(controls, /amount\.addEventListener\('input'/, 'Elle ücret değişikliği izlenmeli');
assert.match(html, /amount=Number\(document\.getElementById\('appointmentAmount'\)\.value\)/, 'Kaydedilen tutar ücret alanından alınmalı');
assert.match(html, /amount:amount/, 'Randevu satırı elle girilen tutarı kullanmalı');
assert.match(html, /tariff_price_snapshot=Number\(service\.price\)/, 'Hizmet tarife fiyatı ayrı snapshot olarak korunmalı');
assert.match(html, /if\(!existing\).*service\.price/s, 'Tarife fiyatı yalnız yeni randevu başlangıcında otomatik doldurulmalı');
assert.match(html, /existing\?\.amount\?\?operationPrice/, 'Mevcut randevunun özel ücreti açılışta korunmalı');

console.log('PASS appointment custom amount');
