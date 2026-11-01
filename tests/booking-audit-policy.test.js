const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('randevu/index.html', 'utf8');
const browser = fs.readFileSync('randevu/booking.js', 'utf8');
const edge = fs.readFileSync('supabase/functions/customer-booking-request/index.ts', 'utf8');
const sql = fs.readFileSync('supabase/migrations/20261101090803_booking_recommendation_and_manual_whatsapp_guard.sql', 'utf8');
const whatsappSql = fs.readFileSync('supabase/migrations/20261101091541_whatsapp_policy_source_consistency.sql', 'utf8');
const dispatcher = fs.readFileSync('supabase/functions/whatsapp-outbound-dispatch/index.ts', 'utf8');
const identity = html.indexOf('data-step="1"');
const service = html.indexOf('data-step="2"');
const employee = html.indexOf('data-step="3"');
assert(identity >= 0 && identity < service && service < employee);
assert.match(html.slice(identity, service), /id="customerName"[\s\S]*id="customerPhone"/);
assert.match(html.slice(service, employee), /id="services"/);
assert.match(browser, /recommendedEmployeeId/);
assert.match(browser, /Önerilen çalışan/);
assert.match(edge, /recommendedEmployeeId: recommendation\.data \|\| null/);
assert.doesNotMatch(edge.slice(edge.indexOf('async function bookingIdentity'),edge.indexOf('async function bookingSchedule')), /completed_count|visitCount|historyCount/);
assert.match(sql, /a\.status = 'completed'[\s\S]*a\.scheduled_at < now\(\)/);
assert.match(sql, /private\.normalize_tr_phone\(c\.phone\) = private\.normalize_tr_phone\(p_phone\)/);
assert.match(sql, /a\.employee_id = any\(coalesce\(p_employee_ids/);
assert.match(sql, /order by count\(\*\) desc, max\(a\.scheduled_at\) desc/);
assert.match(sql, /private\.staff_search_clients[\s\S]*a\.client_id = c\.id and a\.employee_id = v_actor/);
assert.match(sql, /limit 8/);
assert.match(sql, /p\.username <> 'salon.modern'/);
assert.match(sql, /'can_manual',false,'can_mark',false,'can_legacy_manual',false/);
for (const name of ['prepare_manual_appointment_whatsapp','mark_manual_cancel_whatsapp_sent','mark_manual_appointment_whatsapp_handled']) {
  assert.match(sql, new RegExp('function public\\.' + name + '[\\s\\S]*?Randevu WhatsApp taslak gönderimi kapalı'));
}
assert.match(whatsappSql, /tg_op = 'INSERT'[\s\S]*new\.scheduled_at > now\(\)/);
assert.match(whatsappSql, /p_template_key in \('appointment_cancelled','appointment_update'\)/);
assert.match(whatsappSql, /CREATE TRIGGER appointments_enqueue_meta_message/);
assert.match(dispatcher, /appointment_whatsapp_notification_disabled/);
console.log('PASS booking order, recommendation privacy, staff scope and WhatsApp guards');
