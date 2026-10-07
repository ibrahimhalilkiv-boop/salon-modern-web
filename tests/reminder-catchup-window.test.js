const assert = require('node:assert/strict');
const fs = require('node:fs');

const catchup = fs.readFileSync('supabase/migrations/20261007153000_soft_cancel_and_configurable_reminders.sql', 'utf8');

assert.match(catchup, /appointment_reminder_minutes integer not null default 90/, 'The central reminder target must default to 90 minutes');
assert.match(catchup, /appointment_reminder_catchup_minutes integer not null default 30/, 'Scheduler catch-up must cover a 30-minute outage');
assert.match(catchup, /a\.reminder_target_at<=now\(\)/, 'A reminder must never be queued before its target');
assert.match(catchup, /a\.reminder_target_at>=now\(\)-make_interval\(mins=>v_catchup\)/, 'A missed target must remain eligible only inside the configured catch-up window');
assert.match(catchup, /new\.scheduled_at>=now\(\)\+make_interval\(mins=>v_minutes\)/, 'Appointments created below the target lead time must not receive another reminder');
assert.match(catchup, /on conflict do nothing/, 'Repeated cron runs must remain idempotent');
assert.match(catchup, /case when a\.created_by is not null then a\.created_by/, 'Manual reminder routing must stay with the creator');
assert.match(catchup, /online_booking_requests[\s\S]*then a\.employee_id/, 'Online booking fallback must stay with the assigned employee');
assert.match(catchup, /appointment_rescheduled/, 'Moved appointments must invalidate the old reminder');
assert.match(catchup, /appointment_cancelled/, 'Cancelled appointments must invalidate queued reminders');
console.log('PASS configurable 90-minute reminder, 30-minute catch-up, routing and duplicate guard');
