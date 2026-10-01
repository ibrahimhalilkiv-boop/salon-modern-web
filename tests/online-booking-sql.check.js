// Run with a local @electric-sql/pglite install path as the first argument.
// Fixtures are entirely in memory; no production connection is used.
const {PGlite}=require(process.argv[2]||'@electric-sql/pglite');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema private; create schema auth;
 create function auth.role() returns text language sql as 'select current_setting(''test.role'',true)';
 create table public.services(id uuid primary key,name text,price numeric,duration_minutes int,active bool);
 create table public.profiles(id uuid primary key,username text,active bool,role text);
 create table public.booking_settings(id bool,online_booking_enabled bool,default_open_time time,default_close_time time);
 create table public.booking_schedule_overrides(schedule_date date,open_time time,close_time time,is_closed bool);
 create table public.clients(id uuid primary key default gen_random_uuid(),full_name text,phone text);
 create table public.appointments(id uuid primary key default gen_random_uuid(),client_id uuid,client_name text,client_phone text,service_id uuid,service_name text,amount numeric,employee_id uuid,scheduled_at timestamptz,duration_minutes int,note text,status text,source text);
 create table public.online_booking_requests(id uuid primary key default gen_random_uuid(),client_name text,phone text,phone_normalized text,service_id uuid,service_name text,amount numeric,employee_id uuid,scheduled_at timestamptz,duration_minutes int constraint online_booking_requests_duration_minutes_check check(duration_minutes=30),note text,request_ip_hash text,public_token uuid unique,status text,appointment_id uuid,reviewed_at timestamptz,created_at timestamptz default now());
 create table public.notifications(recipient_id uuid,appointment_id uuid,kind text,title text,body text);
 insert into services values('00000000-0000-4000-8000-000000000001','Test',100,15,true);
 insert into profiles values('00000000-0000-4000-8000-000000000002','test',true,'employee');
 insert into booking_settings values(true,true,'09:00','20:00');
 set test.role='service_role';`);
 await db.exec(fs.readFileSync('supabase/migrations/20261001063305_online_booking_auto_confirm.sql','utf8'));
 await db.exec(`create trigger snapshot before insert on appointments for each row execute function private.set_appointment_service_snapshot();
 create function private.test_conflict() returns trigger language plpgsql as $$ begin
 if exists(select 1 from appointments where employee_id=new.employee_id and scheduled_at=new.scheduled_at) then raise exception 'conflict'; end if;return new;end $$;
 create trigger conflict before insert on appointments for each row execute function private.test_conflict();`);
 const date=new Date(Date.now()+7*86400000);while(date.getUTCDay()===0)date.setUTCDate(date.getUTCDate()+1);
 const day=date.toISOString().slice(0,10);
 const payload={public_token:'00000000-0000-4000-8000-000000000003',employee_id:'00000000-0000-4000-8000-000000000002',service_id:'00000000-0000-4000-8000-000000000001',scheduled_at:day+'T10:00:00+03:00',duration_minutes:60,client_name:'Test Person',phone:'905000000001',phone_normalized:'905000000001'};
 const call=p=>db.query('select public.create_confirmed_online_booking($1::jsonb) as result',[JSON.stringify(p)]);
 const first=(await call(payload)).rows[0].result;const replay=(await call(payload)).rows[0].result;
 assert.equal(first.appointment_id,replay.appointment_id);
 let rows=(await db.query('select * from appointments')).rows;assert.equal(rows.length,1);assert.equal(rows[0].duration_minutes,60);
 assert.equal((await db.query('select status from online_booking_requests')).rows[0].status,'approved');
 await assert.rejects(call({...payload,public_token:'00000000-0000-4000-8000-000000000004',phone:'905000000002',phone_normalized:'905000000002'}),/conflict/);
 assert.equal((await db.query('select * from clients')).rows.length,1,'Failed appointment must roll back client and request');
 assert.equal((await db.query('select * from online_booking_requests')).rows.length,1);
 await db.exec('update booking_settings set online_booking_enabled=false');
 await assert.rejects(call({...payload,public_token:'00000000-0000-4000-8000-000000000005',scheduled_at:day+'T11:00:00+03:00'}),/kapalı/);
 await db.exec("set test.role='authenticated'");await assert.rejects(call({...payload,public_token:'00000000-0000-4000-8000-000000000006'}),/Yetkisiz/);
 await db.close();console.log('Local SQL: atomic confirmation, 60-minute snapshot, replay, conflict rollback, closure, authorization PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
