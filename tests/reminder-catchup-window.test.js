const assert = require('node:assert/strict');
const fs = require('node:fs');

const catchup = fs.readFileSync('supabase/migrations/20261004211051_extend_push_reminder_catchup.sql', 'utf8');

assert.match(catchup, /scheduled_at>=now\(\)\+interval '30 minutes'/, 'Scheduler catch-up must cover a 30-minute outage');
assert.match(catchup, /scheduled_at<=now\(\)\+interval '60 minutes'/, 'Reminder must not be queued more than one hour early');
assert.match(catchup, /on conflict do nothing/, 'Repeated cron runs must remain idempotent');
assert.match(catchup, /case when a\.created_by is not null then a\.created_by/, 'Manual reminder routing must stay with the creator');
assert.match(catchup, /online_booking_requests[\s\S]*then a\.employee_id/, 'Online booking fallback must stay with the assigned employee');
console.log('PASS reminder 30-minute catch-up window, routing and duplicate guard');
