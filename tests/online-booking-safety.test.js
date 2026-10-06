const assert=require('node:assert/strict');
const fs=require('node:fs');

const migration=fs.readFileSync('supabase/migrations/20261004223000_online_booking_no_show_and_two_hour_cutoff.sql','utf8');
const cutoffMigration=fs.readFileSync('supabase/migrations/20261006110804_allow_exact_two_hour_customer_changes.sql','utf8');
const edge=fs.readFileSync('supabase/functions/customer-booking-request/index.ts','utf8');
const manage=fs.readFileSync('randevu/durum/manage.js','utf8');

assert.match(migration,/status='no_show'/,'Only explicit no-show status may count');
assert.match(migration,/scheduled_at>=now\(\)-interval '6 months'/,'No-show window must be rolling six months');
assert.doesNotMatch(migration,/status='cancelled'.*can_create_online_booking/s,'Cancelled appointments must not count as no-show');
assert.match(migration,/count\(\*\)<2/,'Zero and one no-show must be allowed; two must be denied');
assert.match(migration,/normalize_tr_phone/,'Phone variants must use one server-side normalizer');
assert.match(migration,/private\.normalize_tr_phone\(a\.client_phone\)=i\.phone[\s\S]*exists[\s\S]*c\.id=a\.client_id[\s\S]*private\.normalize_tr_phone\(c\.phone\)=i\.phone/,'No-show identity must match either the appointment snapshot or linked customer phone');
assert.match(migration,/single-business database[\s\S]*tenant boundary/,'Business scope must be documented as this isolated Supabase project');
assert.match(migration,/if not public\.can_create_online_booking/,'Atomic create RPC must enforce no-show denial');
assert.match(cutoffMigration,/appointment\.scheduled_at<now\(\)\+interval '2 hours'/,'Only less than two hours must be denied');
assert.match(migration,/extract\(minute from local_start\)::integer%30<>0/,'Backend must accept only hour and half-hour starts');
assert.match(migration,/p_start at time zone 'Europe\/Istanbul'/,'Database schedule validation must use Istanbul local time');
assert.match(edge,/return `\$\{date\}T\$\{time\}:00\+03:00`/,'Edge Function must encode customer selections with Turkey UTC offset');
assert.match(migration,/where public_token=p_token for update/,'Token-bound row lock must remain');
assert.match(migration,/p_revision is distinct from request\.customer_revision/,'Revision protection must remain');
assert.doesNotMatch(migration,/update public\.services|update public\.appointments set status='no_show'/i,'Migration must not alter services, existing appointments or create no-shows');
assert.match(edge,/can_create_online_booking/,'Public create endpoint must check only the boolean decision');
assert.match(edge,/CUSTOMER_CHANGE_CUTOFF_MESSAGE/,'Public endpoints must return the two-hour explanation');
assert.match(edge,/const outsideCutoff = [^\n]+ >= Date\.now\(\) \+ 2 \* 60 \* 60 \* 1000/,'UI eligibility must include the exact two-hour boundary');
assert.equal((edge.match(/getTime\(\) < Date\.now\(\) \+ 2 \* 60 \* 60 \* 1000/g)||[]).length,2,'Availability and action endpoints must reject only times below two hours');
assert.match(edge,/'Cache-Control': 'no-store'/,'Token-scoped customer data must not be cached');
assert.match(manage,/managementMessage/,'Customer page must show the backend cutoff explanation');

const now=new Date('2026-10-05T12:00:00+03:00');
const sixMonthsAgo=new Date('2026-04-05T12:00:00+03:00');
const normalize=value=>{const digits=String(value||'').replace(/\D/g,'');if(/^905\d{9}$/.test(digits))return digits;if(/^00905\d{9}$/.test(digits))return digits.slice(2);if(/^05\d{9}$/.test(digits))return '90'+digits.slice(1);if(/^5\d{9}$/.test(digits))return '90'+digits;return null};
function canCreate(rows,phone,project='salon-modern'){
 const wanted=normalize(phone);
 return rows.filter(row=>row.project===project&&row.status==='no_show'&&row.at>=sixMonthsAgo&&row.at<=now&&(normalize(row.appointmentPhone)===wanted||normalize(row.customerPhone)===wanted)).length<2;
}
const hit=(at,extra={})=>({project:'salon-modern',status:'no_show',at:new Date(at),appointmentPhone:'0500 000 00 01',customerPhone:null,...extra});
assert.equal(canCreate([], '+90 500 000 00 01'),true,'Zero no-shows allow booking');
assert.equal(canCreate([hit('2026-09-01T10:00:00+03:00')], '5000000001'),true,'One no-show allows booking');
assert.equal(canCreate([hit('2026-09-01T10:00:00+03:00'),hit('2026-10-01T10:00:00+03:00')], '905000000001'),false,'Two no-shows deny booking');
assert.equal(canCreate([hit('2026-04-05T11:59:59+03:00'),hit('2026-10-01T10:00:00+03:00')], '05000000001'),true,'A no-show outside rolling six months does not count');
assert.equal(canCreate([hit('2026-09-01T10:00:00+03:00'),hit('2026-10-01T10:00:00+03:00',{status:'cancelled'})], '05000000001'),true,'Cancelled appointments do not count');
assert.equal(canCreate([hit('2026-09-01T10:00:00+03:00'),hit('2026-10-01T10:00:00+03:00',{project:'another-business'})], '05000000001'),true,'Appointments isolated in another business project do not count');
assert.equal(canCreate([hit('2026-09-01T10:00:00+03:00',{appointmentPhone:'invalid',customerPhone:'+90 500 000 00 01'}),hit('2026-10-01T10:00:00+03:00')], '05000000001'),false,'Linked customer phone repairs a stale appointment snapshot');

console.log('PASS online no-show gate, phone normalization, token/revision security, two-hour boundary and half-hour grid');
