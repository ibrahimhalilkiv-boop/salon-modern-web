const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/20260925120000_customer_booking_requests.sql', 'utf8');
const edge = fs.readFileSync('supabase/functions/customer-booking-request/index.ts', 'utf8');
const publicHtml = fs.readFileSync('randevu/index.html', 'utf8');
const publicJs = fs.readFileSync('randevu/booking.js', 'utf8');
const adminJs = fs.readFileSync('booking-requests-admin-2.4.0.js', 'utf8');
const shell = fs.readFileSync('sw.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

assert.match(migration, /create table if not exists public\.booking_requests/, 'Talep tablosu ayrı olmalı');
assert.match(migration, /status in \('pending','approved','rejected','cancelled'\)/, 'Durumlar kontrollü olmalı');
assert.match(migration, /alter table public\.booking_requests enable row level security/, 'RLS açık olmalı');
assert.match(migration, /revoke all on table public\.booking_requests from public, anon, authenticated/, 'Public tablo erişimi kapalı olmalı');
assert.doesNotMatch(migration, /grant insert[^;]+anon/i, 'Anon doğrudan talep tablosuna yazamamalı');
assert.match(migration, /for update/, 'Onay RPC içinde talep güncellenmeli');
assert.match(migration, /where id = p_request_id for update/, 'Eşzamanlı onay satır kilidi kullanmalı');
assert.match(migration, /Bu saat artık müsait değil/, 'Onayda müsaitlik tekrar doğrulanmalı');
assert.match(migration, /insert into public\.appointments/, 'Yalnız onay RPC gerçek randevu oluşturmalı');
assert.match(migration, /grant execute on function public\.approve_booking_request[^;]+service_role/, 'Onay RPC yalnız sunucudan çağrılmalı');
assert.match(migration, /find_client_id_by_phone/, 'Mevcut müşteri telefonla server-side eşleştirilmeli');

assert.match(edge, /BOOKING_RATE_LIMIT_SALT/, 'Rate limit IP verisi hashlenmeli');
assert.doesNotMatch(edge, /BOOKING_RATE_LIMIT_SALT'\) \|\| SUPABASE_URL/, 'IP hash için tahmin edilebilir fallback kullanılmamalı');
assert.match(edge, /customer_phone[^\n]+gte\('created_at', since\)/, 'Telefon bazlı rate limit olmalı');
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
