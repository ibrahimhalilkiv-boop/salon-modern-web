const assert = require('node:assert/strict');
const fs = require('node:fs');
const push = fs.readFileSync('salon-web-push.js', 'utf8');
const worker = fs.readFileSync('sw.js', 'utf8');

assert.match(push, /async function subscribeCurrent/, 'PWA aboneliği tek ortak fonksiyondan kurulmalı');
assert.match(push, /Notification\.permission==='granted'.*!sub.*subscribeCurrent/s, 'İzin verilmiş cihaz otomatik yeniden bağlanmalı');
assert.match(push, /await subscribeCurrent\(\);render\(\);var check=await server\('test'\)/, 'Etkinleştirme sonrası gerçek test bildirimi gönderilmeli');
assert.match(push, /Şimdi bildirimleri aç/, 'Ana ekranda belirgin etkinleştirme düğmesi bulunmalı');
assert.match(push, /window\.addEventListener\('focus'.*sync\(\)/, 'Uygulamaya dönünce cihaz kaydı yenilenmeli');
assert.match(push, /rpc\('claim_web_push_subscription'/, 'Aynı cihaz mevcut kullanıcıya güvenli RPC ile bağlanmalı');
assert.match(push, /Bildirim cihazı sunucuya kaydedilemedi/, 'Sunucu kayıt hatası kullanıcıdan gizlenmemeli');
assert.match(push, /location\.assign\(url\)/, 'Hatırlatma tıklaması Android popup engeline takılmamalı');
assert.match(push, /\^90\\d\{10\}\$/, 'WhatsApp yalnız geçerli normalize Türkiye numarasıyla açılmalı');
assert.match(worker, /salon-modern-shell-pwa-v49/, 'Yeni bildirim kodu eski PWA önbelleğinden ayrılmalı');
assert.match(worker, /self\.addEventListener\('push'/, 'Service Worker push olayını göstermeli');
console.log('PASS web push registration and reminder delivery client');
