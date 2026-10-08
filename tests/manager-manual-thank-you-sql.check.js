// Isolated PostgreSQL fixture; never connects to production.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const runtime=process.argv[2],{Client}=require(path.join(runtime,'pg'));
(async()=>{
const {default:EmbeddedPostgres}=await import(require('node:url').pathToFileURL(path.join(runtime,'embedded-postgres/dist/index.js')).href);
const server=new EmbeddedPostgres({databaseDir:fs.mkdtempSync(path.join(os.tmpdir(),'salon-manager-thank-pg-')),port:55445,user:'postgres',password:'local-test-only',persistent:true,initdbFlags:['--locale=C','--encoding=UTF8'],postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
let db;
try{
await server.initialise();await server.start();db=new Client({host:'127.0.0.1',port:55445,user:'postgres',password:'local-test-only',database:'postgres'});await db.connect();
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
await db.query("create schema cron; create table cron.job(jobname text primary key); create function cron.schedule(text,text,text) returns integer language plpgsql as $$begin insert into cron.job values($1); return 1; end$$; create function cron.unschedule(text) returns boolean language plpgsql as $$begin delete from cron.job where jobname=$1; return found; end$$;");
await db.query(fs.readFileSync('supabase/migrations/20261008190000_manual_thank_you_push.sql','utf8'));
await db.query('begin');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const manager=uuid(1),staff=uuid(2),client=uuid(3),service=uuid(4),appointment=uuid(5),note=uuid(6),delivery=uuid(7);
await db.query("insert into profiles(id,full_name,role,active) values($1,'Manager','manager',true),($2,'Staff','staff',true)",[manager,staff]);
await db.query('insert into services(id) values($1)',[service]);
await db.query("insert into clients(id,full_name,phone,whatsapp_marketing_opt_in,whatsapp_marketing_opt_in_at) values($1,'Müşteri','05320000000',true,now())",[client]);
await db.query("insert into appointments(id,client_id,client_name,service_id,service_name,employee_id,created_by,scheduled_at,scheduled_end) values($1,$2,'Müşteri',$3,'Hizmet',$4,$5,now()-interval '1 hour',now()-interval '30 minutes')",[appointment,client,service,staff,manager]);
await db.query("select set_config('salon.test_uid',$1,true)",[staff]);
await db.query("select set_config('salon.test_role','staff',true)");
assert.equal((await db.query('select public.complete_appointment($1) value',[appointment])).rows[0].value.status,'completed','Staff completion remains allowed');
await db.query("insert into notifications(id,recipient_id,appointment_id,kind,title,body) values($1,$2,$3,'appointment_thank_you','old','old')",[note,manager,appointment]);
await db.query("insert into web_push_deliveries(id,notification_id,status) values($1,$2,'queued')",[delivery,note]);
await db.query(fs.readFileSync('supabase/migrations/20261008200000_manager_manual_thank_you.sql','utf8'));
assert.equal(Number((await db.query("select count(*) n from cron.job where jobname='salon-modern-manual-thank-you-push'")).rows[0].n),0);
assert.equal(Number((await db.query('select private.enqueue_due_manual_thank_you_pushes() n')).rows[0].n),0);
assert.equal((await db.query('select public.manual_thank_you_push_is_current($1) valid',[note])).rows[0].valid,false);
assert.equal((await db.query('select status from web_push_deliveries where id=$1',[delivery])).rows[0].status,'expired');
assert.equal((await db.query('select push_attempts from notifications where id=$1',[note])).rows[0].push_attempts,3);
assert.equal(Number((await db.query('select count(*) n from public.list_manual_whatsapp_thank_yous()')).rows[0].n),0,'Staff cannot list thanks');
await db.query('savepoint staff_mark');
await assert.rejects(db.query('select public.mark_manual_whatsapp_thank_you_sent($1)',[appointment]),error=>error.code==='42501');
await db.query('rollback to savepoint staff_mark');
await db.query("select set_config('salon.test_uid',$1,true)",[manager]);
await db.query("select set_config('salon.test_role','manager',true)");
const ready=(await db.query('select * from public.list_manual_whatsapp_thank_yous()')).rows;
assert.equal(ready.length,1,'Completed appointment is immediately eligible');
assert.equal(ready[0].appointment_id,appointment);
assert.equal(ready[0].eligible_at.getTime(),ready[0].completed_at.getTime());
assert.equal((await db.query('select public.mark_manual_whatsapp_thank_you_sent($1) value',[appointment])).rows[0].value.status,'sent');
assert.equal((await db.query('select public.mark_manual_whatsapp_thank_you_sent($1) value',[appointment])).rows[0].value.status,'already_recorded');
assert.equal(Number((await db.query('select count(*) n from public.list_manual_whatsapp_thank_yous()')).rows[0].n),0);
assert.equal(Number((await db.query("select count(*) n from whatsapp_message_logs where idempotency_key=$1",['appointment_thank_you:'+appointment])).rows[0].n),1);
await db.query('rollback');
console.log('PASS manager-only immediate thank-you, staff completion, old-push shutdown and dedupe');
}finally{if(db)await db.end();await server.stop()}
})().catch(error=>{console.error(error);process.exitCode=1});
