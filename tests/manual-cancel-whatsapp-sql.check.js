// Isolated PostgreSQL fixture; never connects to production.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const runtime=process.argv[2],{Client}=require(path.join(runtime,'pg'));
(async()=>{
const {default:EmbeddedPostgres}=await import(require('node:url').pathToFileURL(path.join(runtime,'embedded-postgres/dist/index.js')).href);
const server=new EmbeddedPostgres({databaseDir:fs.mkdtempSync(path.join(os.tmpdir(),'salon-cancel-wa-pg-')),port:55446,user:'postgres',password:'local-test-only',persistent:true,initdbFlags:['--locale=C','--encoding=UTF8'],postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
let db;
try{
await server.initialise();await server.start();db=new Client({host:'127.0.0.1',port:55446,user:'postgres',password:'local-test-only',database:'postgres'});await db.connect();
await db.query(`
create role anon; create role authenticated; create role service_role;
create schema auth; create schema private;
grant usage on schema public,auth to authenticated;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('salon.test_uid',true),'')::uuid$$;
create function private.is_manager() returns boolean language sql stable as $$select current_setting('salon.test_role',true)='manager'$$;
create function private.is_active_salon_user() returns boolean language sql stable as $$select auth.uid() is not null$$;
create function private.normalize_tr_phone(p_raw text) returns text language sql immutable as $$
with v as (select regexp_replace(coalesce(p_raw,''),'[^0-9]','','g') d)
select case when d ~ '^905[0-9]{9}$' then d when d ~ '^05[0-9]{9}$' then '90'||substring(d from 2)
when d ~ '^5[0-9]{9}$' then '90'||d else null end from v $$;
create table public.profiles(id uuid primary key,full_name text);
create table public.clients(id uuid primary key,full_name text,phone text,whatsapp_marketing_opt_out_at timestamptz);
create table public.appointments(id uuid primary key,client_id uuid,client_name text,client_phone text,employee_id uuid,
scheduled_at timestamptz,status text default 'confirmed',staff_overlap_override boolean default false,
cancellation_reason text,cancelled_at timestamptz,cancelled_by uuid,cancellation_source text);
create table public.whatsapp_message_logs(id uuid primary key default gen_random_uuid(),idempotency_key text unique,
template_key text,appointment_id uuid,client_id uuid,scheduled_for timestamptz default now(),next_attempt_at timestamptz default now(),
status text default 'queued',attempt_count integer default 0,metadata jsonb default '{}',sent_at timestamptz,status_at timestamptz,updated_at timestamptz default now(),
constraint whatsapp_message_logs_status_check check(status=any(array['queued','sending','sent','delivered','read','failed','delivery_unknown','awaiting_meta_approval','suppressed_safe_mode','skipped_template_missing','skipped_template_invalid','skipped_no_phone','skipped_event_invalid'])));
create function private.enqueue_whatsapp_message(p_key text,p_template_key text,p_appointment_id uuid,p_client_id uuid,p_scheduled_for timestamptz default now())
returns void language sql as $$insert into public.whatsapp_message_logs(idempotency_key,template_key,appointment_id,client_id,scheduled_for,next_attempt_at)
values(p_key,p_template_key,p_appointment_id,p_client_id,p_scheduled_for,p_scheduled_for) on conflict(idempotency_key) do nothing$$;
`);
const prior=fs.readFileSync('supabase/migrations/20261007153000_soft_cancel_and_configurable_reminders.sql','utf8');
function definition(start,end){return prior.slice(prior.indexOf(start),prior.indexOf(end,prior.indexOf(start)))}
await db.query(definition('create or replace function private.set_appointment_cancellation_metadata()','revoke all on function private.set_appointment_cancellation_metadata()'));
await db.query('create trigger appointments_set_cancellation_metadata before insert or update of status,cancelled_at,cancelled_by,cancellation_source,cancellation_reason on public.appointments for each row execute function private.set_appointment_cancellation_metadata()');
await db.query(definition('create or replace function public.cancel_appointment(p_appointment_id uuid','revoke all on function public.cancel_appointment(uuid,text)'));
await db.query(fs.readFileSync('supabase/migrations/20261008213000_manual_appointment_cancellation_whatsapp.sql','utf8'));
await db.query('create trigger appointments_enqueue_meta_message after insert or update of scheduled_at,employee_id,status on public.appointments for each row execute function private.enqueue_appointment_whatsapp_message()');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const manager=uuid(1),staff=uuid(2),other=uuid(3),client=uuid(4),appointment=uuid(5),staffAppointment=uuid(6),declined=uuid(7);
await db.query('begin');
await db.query('insert into profiles(id,full_name) values($1,\'Manager\'),($2,\'Halil Kıv\'),($3,\'Other\')',[manager,staff,other]);
await db.query("insert into clients(id,full_name,phone) values($1,'Ayşe Yılmaz','05321234567')",[client]);
await db.query("insert into appointments(id,client_id,client_name,client_phone,employee_id,scheduled_at) values($1,$2,'Ayşe Yılmaz','05321234567',$3,'2026-10-10 10:00+03'),($4,$2,'Ayşe Yılmaz','05321234567',$3,'2026-10-10 11:00+03'),($5,$2,'Ayşe Yılmaz','05321234567',$3,'2026-10-10 12:00+03')",[appointment,client,staff,staffAppointment,declined]);
await db.query("select set_config('salon.test_uid',$1,true),set_config('salon.test_role','manager',true)",[manager]);
assert.equal((await db.query('select public.cancel_appointment($1,null) value',[appointment])).rows[0].value.status,'cancelled');
assert.equal((await db.query('select public.cancel_appointment($1,null) value',[appointment])).rows[0].value.replayed,true);
assert.deepEqual((await db.query("select status,attempt_count from whatsapp_message_logs where idempotency_key=$1",['appointment_cancelled:'+appointment])).rows,[{status:'manual_pending',attempt_count:0}]);
const ready=(await db.query('select public.get_manual_cancel_whatsapp($1) value',[appointment])).rows[0].value;
assert.equal(ready.status,'ready');assert.equal(ready.phone,'905321234567');assert.equal(ready.staff_name,'Halil Kıv');assert.equal(new Date(ready.scheduled_at).toISOString(),'2026-10-10T07:00:00.000Z');
await db.query("select set_config('salon.test_uid',$1,true),set_config('salon.test_role','staff',true)",[other]);
await db.query('savepoint unauthorized');
await assert.rejects(db.query('select public.get_manual_cancel_whatsapp($1)',[appointment]),error=>error.code==='42501');
await db.query('rollback to savepoint unauthorized');
await db.query('savepoint unauthorized_mark');
await assert.rejects(db.query('select public.mark_manual_cancel_whatsapp_sent($1)',[appointment]),error=>error.code==='42501');
await db.query('rollback to savepoint unauthorized_mark');
await db.query("select set_config('salon.test_uid',$1,true)",[staff]);
assert.equal((await db.query('select public.cancel_appointment($1,null) value',[staffAppointment])).rows[0].value.status,'cancelled','Staff can still cancel own appointment');
assert.equal((await db.query('select public.get_manual_cancel_whatsapp($1) value',[staffAppointment])).rows[0].value.status,'ready');
assert.equal((await db.query('select public.mark_manual_cancel_whatsapp_sent($1) value',[staffAppointment])).rows[0].value.status,'sent');
assert.equal((await db.query('select public.mark_manual_cancel_whatsapp_sent($1) value',[staffAppointment])).rows[0].value.status,'already_recorded');
assert.equal((await db.query('select public.get_manual_cancel_whatsapp($1) value',[staffAppointment])).rows[0].value.status,'already_sent');
await db.query("update clients set whatsapp_marketing_opt_out_at=now() where id=$1",[client]);
await db.query('select public.cancel_appointment($1,null)',[declined]);
assert.equal((await db.query('select public.get_manual_cancel_whatsapp($1) value',[declined])).rows[0].value.status,'contact_declined');
assert.equal((await db.query("select count(*)::int n from whatsapp_message_logs where template_key='appointment_cancelled' and status='queued'")).rows[0].n,0);
assert.equal((await db.query("select count(*)::int n from whatsapp_message_logs where idempotency_key=$1",['appointment_cancelled:'+appointment])).rows[0].n,1);
await db.query('rollback');
console.log('PASS manual cancellation queue, replay/dedupe, staff scope, opt-out and exact Istanbul time');
}finally{if(db)await db.end();await server.stop()}
})().catch(error=>{console.error(error);process.exitCode=1});
