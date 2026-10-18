const assert = require('node:assert/strict');
const fs = require('node:fs');
const push = fs.readFileSync('salon-web-push.js', 'utf8');
const worker = fs.readFileSync('sw.js', 'utf8');

assert.match(push, /async function subscribeCurrent/, 'PWA aboneliği tek ortak fonksiyondan kurulmalı');
const sync = push.slice(push.indexOf('async function sync()'), push.indexOf('async function enable()'));
assert.doesNotMatch(sync, /subscribeCurrent\(/, 'Arka plan eşitlemesi cihaz push servisine yeniden abone olmamalı');
assert.doesNotMatch(sync, /toast\(/, 'Arka plan eşitlemesi tekrar eden hata bildirimi üretmemeli');
assert.match(push, /await subscribeCurrent\(\);render\(\);toast\('Bildirimler açıldı'/, 'Yalnız açık kullanıcı eylemi yeni abonelik oluşturmalı');
assert.doesNotMatch(push.slice(push.indexOf('async function enable()'), push.indexOf('async function disable()')), /server\('test'\)/, 'Etkinleştirme gerçek test bildirimi göndermemeli');
assert.match(push, /Şimdi bildirimleri aç/, 'Ana ekranda belirgin etkinleştirme düğmesi bulunmalı');
assert.match(push, /window\.addEventListener\('focus'.*sync\(\)/, 'Uygulamaya dönünce cihaz kaydı yenilenmeli');
assert.match(push, /rpc\('claim_web_push_subscription'/, 'Aynı cihaz mevcut kullanıcıya güvenli RPC ile bağlanmalı');
assert.match(push, /Bildirim cihazı sunucuya kaydedilemedi/, 'Sunucu kayıt hatası kullanıcıdan gizlenmemeli');
assert.match(worker, /clients\.openWindow\(target\)/, 'Hatırlatma tıklaması Service Worker üzerinden açılmalı');
assert.match(worker, /salon-modern-shell-pwa-v142/, 'Güncel uygulama sürümü eski PWA önbelleğinden ayrılmalı');
assert.match(worker, /self\.addEventListener\('push'/, 'Service Worker push olayını göstermeli');
console.log('PASS web push registration and reminder delivery client');
