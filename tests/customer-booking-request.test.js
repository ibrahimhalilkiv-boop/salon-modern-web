const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/20260925120000_customer_booking_requests.sql', 'utf8');
const edge = fs.readFileSync('supabase/functions/customer-booking-request/index.ts', 'utf8');
const publicHtml = fs.readFileSync('randevu/index.html', 'utf8');
const publicJs = fs.readFileSync('randevu/booking.js', 'utf8');
const adminJs = fs.readFileSync('booking-requests-admin-2.4.0.js', 'utf8');
const shell = fs.readFileSync('sw.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

assert.doesNotMatch(migration, /create table/i, 'Canlıdaki mevcut talep tablosu tekrar oluşturulmamalı');
assert.match(migration, /alter table public\.online_booking_requests/, 'Mevcut online talep tablosu genişletilmeli');
assert.match(migration, /public_token uuid not null default gen_random_uuid/, 'Tahmin edilemeyen takip kodu olmalı');
assert.match(migration, /alter table public\.online_booking_requests enable row level security/, 'RLS açık kalmalı');
assert.match(migration, /revoke all on table public\.online_booking_requests from anon/, 'Public tablo erişimi kapalı olmalı');
assert.doesNotMatch(migration, /grant insert[^;]+anon/i, 'Anon doğrudan talep tablosuna yazamamalı');

assert.match(edge, /BOOKING_RATE_LIMIT_SALT/, 'Rate limit IP verisi hashlenmeli');
assert.doesNotMatch(edge, /BOOKING_RATE_LIMIT_SALT'\) \|\| SUPABASE_URL/, 'IP hash için tahmin edilebilir fallback kullanılmamalı');
assert.match(edge, /phone_normalized[^\n]+gte\('created_at', since\)/, 'Telefon bazlı rate limit olmalı');
assert.match(edge, /online_booking_requests/, 'Tek talep veri kaynağı kullanılmalı');
assert.match(edge, /request_ip_hash[^\n]+gte\('created_at', since\)/, 'IP bazlı rate limit olmalı');
assert.match(edge, /db\.auth\.getUser\(token\)/, 'Yönetici işlemi JWT ile doğrulanmalı');
assert.match(edge, /eq\('role', 'manager'\)/, 'Yönetici rolü server-side kontrol edilmeli');
assert.match(edge, /action === 'availability'/, 'Public müsaitlik endpointi olmalı');
assert.match(edge, /action === 'status'/, 'Güvenli tokenlı durum endpointi olmalı');
assert.match(edge, /kind: 'booking_request'/, 'Yönetici bildirimi mevcut notifications yapısına yazılmalı');

assert.match(publicHtml, /Salon Modern \| Online Randevu/, 'SEO başlığı bulunmalı');
assert.match(publicHtml, /og:title/, 'Open Graph bilgisi bulunmalı');
assert.match(publicHtml, /Talebiniz Salon Modern tarafından onaylandığında/, 'Talebin kesin randevu olmadığı açık olmalı');
assert.doesNotMatch(publicHtml, /service_role/i, 'Public HTML gizli anahtar içermemeli');
assert.match(publicJs, /action=create/, 'Form Edge Function üzerinden gönderilmeli');
assert.doesNotMatch(publicJs, /\.from\(['"]appointments/, 'Public tarayıcı appointments tablosuna doğrudan yazmamalı');
assert.match(adminJs, /Randevu Talepleri/, 'Yönetici menüsü bulunmalı');
assert.match(adminJs, /SalonBookingRequests\.approve/, 'Onay eylemi bulunmalı');
assert.match(adminJs, /WhatsApp’tan bildir/, 'Manuel WhatsApp eylemi bulunmalı');
assert.match(index, /booking-requests-admin-2\.4\.0\.js/, 'Yönetim uygulaması modülü yüklemeli');
assert.match(shell, /salon-modern-shell-pwa-v55/, 'PWA cache sürümü yükseltilmeli');
assert.match(shell, /\.\/randevu\//, 'Public sayfa çevrimdışı shell ayrımında tanınmalı');

console.log('customer booking request tests: PASS');
