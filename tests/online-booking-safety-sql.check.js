// Run with a local @electric-sql/pglite install path as the first argument.
// The database is in memory; this never connects to or changes production.
const {PGlite}=require(process.argv[2]||'@electric-sql/pglite');
const assert=require('node:assert/strict');
const fs=require('node:fs');

(async()=>{
 const db=new PGlite();
 const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
 try{
  await db.exec(`create role anon; create role authenticated; create role service_role;
   create schema private; create schema auth;
   create function auth.role() returns text language sql as 'select current_setting(''test.role'',true)';
   create function auth.uid() returns uuid language sql as 'select null::uuid';
   create function private.normalize_tr_phone(p_raw text) returns text language plpgsql immutable strict set search_path=pg_catalog as $$
   declare v_digits text:=regexp_replace(p_raw,'[^0-9]','','g'); begin return v_digits; end $$;
   create table public.services(id uuid primary key,name text,price numeric,duration_minutes integer,active boolean);
   create table public.profiles(id uuid primary key,full_name text,username text,active boolean,role text);
   create table public.booking_settings(id boolean,online_booking_enabled boolean,default_open_time time,default_close_time time);
   create table public.booking_schedule_overrides(schedule_date date,open_time time,close_time time,is_closed boolean);
   create table public.clients(id uuid primary key,full_name text,phone text);
   create table public.appointments(id uuid primary key,client_id uuid,client_name text,client_phone text,service_id uuid,service_name text,amount numeric,employee_id uuid,scheduled_at timestamptz,scheduled_end timestamptz,duration_minutes integer,note text,status text,source text,staff_overlap_override boolean default false,created_by uuid,updated_by uuid);
   create table public.closed_time_slots(employee_id uuid,starts_at timestamptz,ends_at timestamptz);
   create table public.online_booking_requests(id uuid primary key,client_name text,phone text,phone_normalized text,service_id uuid,service_name text,amount numeric,employee_id uuid,scheduled_at timestamptz,duration_minutes integer,note text,request_ip_hash text,public_token uuid unique,status text,appointment_id uuid,reviewed_at timestamptz,created_at timestamptz default now(),customer_revision integer default 0,last_customer_operation uuid);
   create table public.notifications(recipient_id uuid,appointment_id uuid,kind text,title text,body text);
   create function private.online_booking_duration(uuid) returns integer language sql stable as 'select 30';
   set test.role='service_role';`);
  await db.exec(fs.readFileSync('supabase/migrations/20261004223000_online_booking_no_show_and_two_hour_cutoff.sql','utf8'));

  await db.query(`insert into clients values
   ($1,'Two no-shows','+90 500 000 00 01'),
   ($2,'One no-show','0500 000 00 02'),
   ($3,'Old no-show','5000000003'),
   ($4,'Cancelled','905000000004')`,[uuid(101),uuid(102),uuid(103),uuid(104)]);
  await db.query(`insert into appointments(id,client_id,client_name,client_phone,scheduled_at,scheduled_end,duration_minutes,status,source) values
   ($1,$2,'A','invalid',now()-interval '1 month',now()-interval '1 month'+interval '30 minutes',30,'no_show','staff'),
   ($3,$2,'A','0500 000 00 01',now()-interval '2 months',now()-interval '2 months'+interval '30 minutes',30,'no_show','staff'),
   ($4,$5,'B','905000000002',now()-interval '1 month',now()-interval '1 month'+interval '30 minutes',30,'no_show','staff'),
   ($6,$7,'C','905000000003',now()-interval '6 months'-interval '1 second',now()-interval '6 months',30,'no_show','staff'),
   ($8,$9,'D','905000000004',now()-interval '1 month',now()-interval '1 month'+interval '30 minutes',30,'cancelled','staff')`,
   [uuid(201),uuid(101),uuid(202),uuid(203),uuid(102),uuid(204),uuid(103),uuid(205),uuid(104)]);
  const allowed=async phone=>(await db.query('select public.can_create_online_booking($1) allowed',[phone])).rows[0].allowed;
  assert.equal(await allowed('05000000005'),true,'Zero no-shows allow booking');
  assert.equal(await allowed('+90 500 000 00 02'),true,'One no-show allows booking');
  assert.equal(await allowed('5000000001'),false,'Two no-shows deny booking across appointment and customer phone formats');
  assert.equal(await allowed('05000000003'),true,'No-show older than rolling six months does not count');
  assert.equal(await allowed('905000000004'),true,'Cancelled appointment does not count');
  assert.equal(await allowed('not-a-phone'),false,'Invalid phone never receives an allow decision');

  const employee=uuid(301),service=uuid(302);
  await db.query("insert into profiles values($1,'Çalışan','employee',true,'employee')",[employee]);
  await db.query("insert into services values($1,'Hizmet',100,30,true)",[service]);
  await db.query("insert into booking_settings values(true,true,'09:00','20:00')");
  await db.exec('begin');
  try{
   await db.query(`insert into appointments(id,client_name,client_phone,service_id,service_name,employee_id,scheduled_at,scheduled_end,duration_minutes,status,source)
     values($1,'Boundary','905000000010',$2,'Hizmet',$3,now()+interval '2 hours',now()+interval '2 hours 30 minutes',30,'confirmed','online')`,[uuid(401),service,employee]);
   await db.query(`insert into online_booking_requests(id,client_name,phone,phone_normalized,service_id,service_name,employee_id,scheduled_at,duration_minutes,public_token,status,appointment_id)
     values($1,'Boundary','905000000010','905000000010',$2,'Hizmet',$3,now()+interval '2 hours',30,$4,'approved',$5)`,[uuid(402),service,employee,uuid(403),uuid(401)]);
   await assert.rejects(db.query("select public.manage_customer_online_booking($1,$2,0,'cancel',null)",[uuid(403),uuid(404)]),/2 saat veya daha az/,'Exactly two hours must be rejected by SQL');
  }finally{await db.exec('rollback')}

  await db.query(`insert into appointments(id,client_name,client_phone,service_id,service_name,employee_id,scheduled_at,scheduled_end,duration_minutes,status,source)
    values($1,'Future','905000000011',$2,'Hizmet',$3,now()+interval '2 hours 1 minute',now()+interval '2 hours 31 minutes',30,'confirmed','online')`,[uuid(411),service,employee]);
  await db.query(`insert into online_booking_requests(id,client_name,phone,phone_normalized,service_id,service_name,employee_id,scheduled_at,duration_minutes,public_token,status,appointment_id)
    values($1,'Future','905000000011','905000000011',$2,'Hizmet',$3,now()+interval '2 hours 1 minute',30,$4,'approved',$5)`,[uuid(412),service,employee,uuid(413),uuid(411)]);
  const changed=(await db.query("select public.manage_customer_online_booking($1,$2,0,'cancel',null) result",[uuid(413),uuid(414)])).rows[0].result;
  assert.equal(changed.status,'cancelled','More than two hours remains manageable');
  await assert.rejects(db.query("select public.manage_customer_online_booking($1,$2,0,'cancel',null)",[uuid(999),uuid(415)]),/bulunamadı/,'Unknown customer token cannot access an appointment');
  assert.equal((await db.query("select has_function_privilege('anon','public.manage_customer_online_booking(uuid,uuid,integer,text,timestamptz)','execute') allowed")).rows[0].allowed,false);
  assert.equal((await db.query("select has_function_privilege('authenticated','public.can_create_online_booking(text)','execute') allowed")).rows[0].allowed,false);
  console.log('PASS real PostgreSQL: no-show 0/1/2, rolling six months, cancelled exclusion, phone identity, exact two-hour cutoff, token binding and privileges');
 }finally{await db.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
