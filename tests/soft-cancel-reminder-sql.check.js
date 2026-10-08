// Isolated PostgreSQL fixture; never connects to production.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const runtime=process.argv[2],{Client}=require(path.join(runtime,'pg'));
(async()=>{
const {default:EmbeddedPostgres}=await import(require('node:url').pathToFileURL(path.join(runtime,'embedded-postgres/dist/index.js')).href);
const server=new EmbeddedPostgres({databaseDir:fs.mkdtempSync(path.join(os.tmpdir(),'salon-soft-cancel-pg-')),port:55443,user:'postgres',password:'local-test-only',persistent:true,initdbFlags:['--locale=C','--encoding=UTF8'],postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
let db;
try{
await server.initialise();await server.start();db=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'local-test-only',database:'postgres'});await db.connect();
await db.query(`
create role anon; create role authenticated; create role service_role;
create schema auth; create schema private; create schema net;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('salon.test_uid',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('salon.test_auth_role',true),''),'authenticated')$$;
create function private.is_manager() returns boolean language sql stable as $$select current_setting('salon.test_role',true)='manager'$$;
create function private.is_active_salon_user() returns boolean language sql stable as $$select auth.uid() is not null$$;
create function private.normalize_tr_phone(p_raw text) returns text language sql immutable as $$select regexp_replace(coalesce(p_raw,''),'[^0-9]','','g')$$;
create function private.check_online_booking_window(timestamptz,integer) returns void language plpgsql as $$begin return;end$$;
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;

create table public.profiles(id uuid primary key,full_name text,role text,active boolean default true);
create table public.clients(id uuid primary key,full_name text,phone text);
create table public.services(id uuid primary key);
create table public.booking_settings(id boolean primary key default true,online_booking_enabled boolean not null default true,default_open_time time not null default '09:00',default_close_time time not null default '19:00',updated_at timestamptz not null default now(),updated_by uuid);
insert into public.booking_settings(id) values(true);
create table public.appointments(
 id uuid primary key,client_id uuid,client_name text not null,client_phone text,service_id uuid not null,service_name text not null default '',amount numeric not null default 0,
 employee_id uuid not null,scheduled_at timestamptz not null,duration_minutes integer not null default 30,note text,created_by uuid,created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),updated_by uuid,status text not null default 'confirmed',source text not null default 'staff',
 scheduled_end timestamptz not null,staff_overlap_override boolean not null default false
);
create table public.online_booking_requests(
 id uuid primary key default gen_random_uuid(),public_token uuid unique,appointment_id uuid,client_name text,phone text,phone_normalized text,
 service_id uuid,service_name text,amount numeric,employee_id uuid,scheduled_at timestamptz,duration_minutes integer,note text,status text default 'approved',
 customer_revision integer default 1,last_customer_operation uuid,reviewed_at timestamptz
);
create table public.closed_time_slots(employee_id uuid,starts_at timestamptz,ends_at timestamptz);
create table public.notifications(
 id uuid primary key default gen_random_uuid(),recipient_id uuid,appointment_id uuid,kind text,title text,body text,reminder_for timestamptz,
 pushed_at timestamptz,push_attempts integer default 0,last_push_error text,created_at timestamptz default now()
);
create unique index notifications_reminder_unique on public.notifications(recipient_id,appointment_id,kind,reminder_for) where kind='appointment_reminder';
create table public.web_push_deliveries(
 id uuid primary key default gen_random_uuid(),notification_id uuid,status text default 'queued',attempt_count integer default 0,
 next_attempt_at timestamptz default now(),sent_at timestamptz,last_error text,created_at timestamptz default now(),updated_at timestamptz default now()
);
create table public.whatsapp_message_logs(
 id uuid primary key default gen_random_uuid(),idempotency_key text unique not null,template_key text not null,appointment_id uuid,client_id uuid,
 scheduled_for timestamptz not null default now(),next_attempt_at timestamptz not null default now(),status text not null default 'queued',
 attempt_count integer not null default 0,provider_message_id text,template_content_hash text,rendered_message text,metadata jsonb default '{}',
 last_error text,sent_at timestamptz,status_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now()
);
create table public.message_templates(template_key text primary key,title text,content text,updated_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.whatsapp_meta_template_mappings(template_key text primary key,meta_template_name text,language_code text default 'tr',placeholder_order jsonb default '[]',approved_content_hash text,approval_status text default 'unconfigured',approved_at timestamptz,updated_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.customer_debts(id uuid primary key,appointment_id uuid,amount numeric,status text);
grant all on public.appointments to authenticated,service_role;
`);
await db.query(fs.readFileSync('supabase/migrations/20261007153000_soft_cancel_and_configurable_reminders.sql','utf8'));
await db.query(fs.readFileSync('supabase/migrations/20261008123000_whatsapp_links_and_thank_you.sql','utf8'));
await db.query(fs.readFileSync('supabase/migrations/20261008152000_manual_whatsapp_thank_you_queue.sql','utf8'));
await db.query('begin');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const manager=uuid(1),employee=uuid(2),service=uuid(3);
await db.query('insert into profiles(id,full_name,role,active) values($1,\'Manager\',\'manager\',true),($2,\'Employee\',\'staff\',true)',[manager,employee]);
await db.query('insert into services(id) values($1)',[service]);
const insert=async(id,minutes,creator=manager)=>{
  await db.query(`insert into appointments(id,client_name,service_id,service_name,employee_id,created_by,scheduled_at,scheduled_end,status)
    values($1,'Fixture',$2,'Service',$3,$4,now()+make_interval(mins=>$5),now()+make_interval(mins=>$5+30),'confirmed')`,[uuid(id),service,employee,creator,minutes]);
};
await insert(10,60);
await insert(11,59);
let rows=(await db.query('select id,reminder_eligible,round(extract(epoch from (scheduled_at-reminder_target_at))/60) lead from appointments order by id')).rows;
assert.equal(rows.find(r=>r.id===uuid(10)).reminder_eligible,true,'Exactly 60 minutes is eligible');
assert.equal(Number(rows.find(r=>r.id===uuid(10)).lead),60);
assert.equal(rows.find(r=>r.id===uuid(11)).reminder_eligible,false,'Less than 60 minutes is not eligible');

await insert(12,150);await db.query("update appointments set reminder_eligible=true,reminder_target_at=now()-interval '20 minutes' where id=$1",[uuid(12)]);
await insert(13,150);await db.query("update appointments set reminder_eligible=true,reminder_target_at=now()-interval '31 minutes' where id=$1",[uuid(13)]);
const enqueue=async()=>Number((await db.query('select private.enqueue_due_appointment_reminders() n')).rows[0].n);
assert.equal(await enqueue(),2,'Exact target and 20-minute catch-up are queued');
assert.equal(await enqueue(),0,'Repeated cron does not duplicate');
let noteIds=(await db.query('select appointment_id from notifications where kind=\'appointment_reminder\' order by appointment_id')).rows.map(r=>r.appointment_id);
assert.deepEqual(noteIds,[uuid(10),uuid(12)]);
assert(!noteIds.includes(uuid(11)));assert(!noteIds.includes(uuid(13)));

await insert(20,180);
const target20=(await db.query('select reminder_target_at from appointments where id=$1',[uuid(20)])).rows[0].reminder_target_at;
const notification20=uuid(120);
await db.query('insert into customer_debts(id,appointment_id,amount,status) values($1,$2,100,\'open\')',[uuid(220),uuid(20)]);
await db.query("insert into notifications(id,recipient_id,appointment_id,kind,title,body,reminder_for) values($1,$2,$3,'appointment_reminder','R','R',(select scheduled_at from appointments where id=$3))",[notification20,manager,uuid(20)]);
await db.query("insert into web_push_deliveries(notification_id,status) values($1,'queued')",[notification20]);
await db.query("insert into whatsapp_message_logs(idempotency_key,template_key,appointment_id,scheduled_for,status) values('cancel-fixture','appointment_reminder',$1,$2,'queued')",[uuid(20),target20]);
await db.query("select set_config('salon.test_uid',$1,false),set_config('salon.test_role','manager',false)",[manager]);
let cancelled=(await db.query('select public.cancel_appointment($1,null) value',[uuid(20)])).rows[0].value;
assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.cancellation_source,'admin');
let kept=(await db.query('select status,cancelled_at,cancelled_by,cancellation_source from appointments where id=$1',[uuid(20)])).rows[0];
assert.equal(kept.status,'cancelled');assert(kept.cancelled_at);assert.equal(kept.cancelled_by,manager);assert.equal(kept.cancellation_source,'admin');
assert.equal(Number((await db.query('select count(*) n from customer_debts where appointment_id=$1',[uuid(20)])).rows[0].n),1,'Soft cancel preserves linked debt');
assert.equal((await db.query('select status from web_push_deliveries where notification_id=$1',[notification20])).rows[0].status,'expired');
assert.equal((await db.query("select status from whatsapp_message_logs where idempotency_key='cancel-fixture'")).rows[0].status,'skipped_event_invalid');
assert.equal((await db.query('select public.cancel_appointment($1,null) value',[uuid(20)])).rows[0].value.replayed,true,'Second cancellation is idempotent');

await insert(30,180);
const old=(await db.query('select scheduled_at,reminder_target_at from appointments where id=$1',[uuid(30)])).rows[0];
const notification30=uuid(130);
await db.query("insert into notifications(id,recipient_id,appointment_id,kind,title,body,reminder_for) values($1,$2,$3,'appointment_reminder','R','R',$4)",[notification30,manager,uuid(30),old.scheduled_at]);
await db.query("insert into web_push_deliveries(notification_id,status) values($1,'queued')",[notification30]);
await db.query("insert into whatsapp_message_logs(idempotency_key,template_key,appointment_id,scheduled_for,status) values('move-fixture','appointment_reminder',$1,$2,'queued')",[uuid(30),old.reminder_target_at]);
await db.query("update appointments set scheduled_at=now()+interval '240 minutes',scheduled_end=now()+interval '270 minutes' where id=$1",[uuid(30)]);
const moved=(await db.query('select scheduled_at,reminder_target_at,reminder_eligible from appointments where id=$1',[uuid(30)])).rows[0];
assert.equal(moved.reminder_eligible,true);assert.notEqual(String(moved.reminder_target_at),String(old.reminder_target_at));
assert.equal((await db.query('select status from web_push_deliveries where notification_id=$1',[notification30])).rows[0].status,'expired');
assert.equal((await db.query("select status from whatsapp_message_logs where idempotency_key='move-fixture'")).rows[0].status,'skipped_event_invalid');

assert.equal((await db.query("select has_table_privilege('authenticated','public.appointments','DELETE') allowed")).rows[0].allowed,false,'Authenticated clients cannot physically delete appointments');
assert.equal((await db.query("select has_function_privilege('authenticated','public.cancel_appointment(uuid,text)','EXECUTE') allowed")).rows[0].allowed,true);
assert.equal((await db.query("select has_function_privilege('anon','public.cancel_appointment(uuid,text)','EXECUTE') allowed")).rows[0].allowed,false);

const thankClient=uuid(400),thankAppointment=uuid(401);
await db.query("insert into clients(id,full_name,phone,whatsapp_marketing_opt_in,whatsapp_marketing_opt_in_at) values($1,'Opt In','05320000000',true,now())",[thankClient]);
await db.query("update whatsapp_meta_template_mappings set approval_status='approved',approved_content_hash='fixture' where template_key='appointment_thank_you'");
await insert(401,180);await db.query('update appointments set client_id=$1 where id=$2',[thankClient,thankAppointment]);
await db.query("select set_config('salon.test_uid',$1,false),set_config('salon.test_role','manager',false)",[manager]);
assert.equal((await db.query('select public.complete_appointment($1) value',[thankAppointment])).rows[0].value.status,'completed');
assert.equal(Number((await db.query("select count(*) n from whatsapp_message_logs where template_key='appointment_thank_you'")).rows[0].n),0,'Thank-you remains disabled by default');
await db.query("update booking_settings set whatsapp_thank_you_enabled=true,whatsapp_thank_you_delay_minutes=60");
await db.query('alter table appointments disable trigger appointments_set_completion_metadata');
await db.query("update appointments set completed_at=now()-interval '61 minutes' where id=$1",[thankAppointment]);
await db.query('alter table appointments enable trigger appointments_set_completion_metadata');
assert.equal((await db.query('select public.whatsapp_enqueue_due_thank_yous() value')).rows[0].value.appointment_thank_yous_enqueued,1);
assert.equal((await db.query('select public.whatsapp_enqueue_due_thank_yous() value')).rows[0].value.appointment_thank_yous_enqueued,0,'Thank-you dedupe is appointment-scoped');
await db.query("update clients set whatsapp_marketing_opt_in=false,whatsapp_marketing_opt_in_at=null where id=$1",[thankClient]);
await insert(402,180);await db.query("update appointments set client_id=$1,status='completed' where id=$2",[thankClient,uuid(402)]);
await db.query('alter table appointments disable trigger appointments_set_completion_metadata');
await db.query("update appointments set completed_at=now()-interval '61 minutes' where id=$1",[uuid(402)]);
await db.query('alter table appointments enable trigger appointments_set_completion_metadata');
assert.equal((await db.query('select public.whatsapp_enqueue_due_thank_yous() value')).rows[0].value.appointment_thank_yous_enqueued,0,'No marketing consent means no thank-you');

const manualClient=uuid(410),manualAppointment=uuid(411);
await db.query("insert into clients(id,full_name,phone,whatsapp_marketing_opt_in,whatsapp_marketing_opt_in_at) values($1,'Manual Opt In','05321112233',true,now())",[manualClient]);
await insert(411,180);await db.query("update appointments set client_id=$1,status='completed' where id=$2",[manualClient,manualAppointment]);
await db.query('alter table appointments disable trigger appointments_set_completion_metadata');
await db.query("update appointments set completed_at=now()-interval '61 minutes' where id=$1",[manualAppointment]);
await db.query('alter table appointments enable trigger appointments_set_completion_metadata');
let manualRows=(await db.query('select * from public.list_manual_whatsapp_thank_yous()')).rows;
assert.equal(manualRows.length,1);assert.equal(manualRows[0].appointment_id,manualAppointment);
assert.equal((await db.query('select public.mark_manual_whatsapp_thank_you_sent($1) value',[manualAppointment])).rows[0].value.status,'sent');
assert.equal((await db.query('select count(*)::int n from public.list_manual_whatsapp_thank_yous()')).rows[0].n,0,'Marked appointments leave the manual queue');
assert.equal((await db.query('select public.whatsapp_enqueue_due_thank_yous() value')).rows[0].value.appointment_thank_yous_enqueued,0,'Manual mark blocks future automatic duplicate');
await db.query('rollback');
console.log('PASS PostgreSQL soft cancel, 60-minute reminders, opt-in automatic/manual thank-you scheduling and shared dedupe');
}finally{if(db)await db.end();await server.stop()}
})().catch(e=>{console.error(e);process.exitCode=1});
