const assert = require('node:assert/strict');
const fs = require('node:fs');

const notifications = fs.readFileSync('supabase/migrations/20260921113000_harden_web_push_appointment_notifications.sql', 'utf8');
const delivery = fs.readFileSync('supabase/migrations/20260921114500_sync_web_push_delivery_status.sql', 'utf8');

assert.match(notifications, /v_actor is distinct from new\.employee_id/, 'Kendi kendine atamada bildirim üretilmemeli');
assert.match(notifications, /values\(new\.employee_id,new\.id,'appointment'/, 'Yeni atama yalnız atanan çalışana yazılmalı');
assert.match(notifications, /on conflict do nothing/, 'Reminder tekrarında duplicate engellenmeli');
assert.match(notifications, /a\.status='confirmed'/, 'İptal randevu reminder kapsamı dışında kalmalı');
assert.match(notifications, /grant execute on function public\.claim_web_push_subscription.*authenticated/, 'Subscription claim yalnız giriş yapmış kullanıcıya açık olmalı');
assert.match(delivery, /d\.status='sent'/, 'Başarılı Web Push notification kaydına yansıtılmalı');
assert.match(delivery, /last_push_error/, 'Teslimat hatası notification kaydına yansıtılmalı');

const creatorReminder = fs.readFileSync('supabase/migrations/20260921121500_route_reminders_to_creator.sql', 'utf8');
assert.match(creatorReminder, /select a\.created_by,a\.id,'appointment_reminder'/, 'Bir saatlik hatırlatma randevuyu ekleyen kullanıcıya gitmeli');
assert.match(creatorReminder, /a\.created_by is not null/, 'Sahipsiz randevu için hatırlatma oluşturulmamalı');

console.log('PASS appointment assignment and reminder push backend');
