const assert = require('node:assert/strict');
const fs = require('node:fs');
const push = fs.readFileSync('salon-web-push.js', 'utf8');
const worker = fs.readFileSync('sw.js', 'utf8');

assert.match(push, /async function subscribeCurrent/, 'PWA aboneliği tek ortak fonksiyondan kurulmalı');
assert.match(push, /Notification\.permission==='granted'.*!sub.*subscribeCurrent/s, 'İzin verilmiş cihaz otomatik yeniden bağlanmalı');
assert.match(push, /await subscribeCurrent\(\);render\(\);var check=await server\('test'\)/, 'Etkinleştirme sonrası gerçek test bildirimi gönderilmeli');
assert.match(push, /Şimdi bildirimleri aç/, 'Ana ekranda belirgin etkinleştirme düğmesi bulunmalı');
assert.match(push, /window\.addEventListener\('focus'.*sync\(\)/, 'Uygulamaya dönünce cihaz kaydı yenilenmeli');
assert.match(worker, /salon-modern-shell-pwa-v29/, 'Yeni bildirim kodu eski PWA önbelleğinden ayrılmalı');
assert.match(worker, /self\.addEventListener\('push'/, 'Service Worker push olayını göstermeli');
console.log('PASS web push registration and reminder delivery client');
