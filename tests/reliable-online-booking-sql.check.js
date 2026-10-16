// Isolated PostgreSQL fixture. Never connects to production.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Client } = require(path.join(process.argv[2], 'pg'));
const { pathToFileURL } = require('node:url');

(async () => {
  const { default: EmbeddedPostgres } = await import(pathToFileURL(path.join(process.argv[2], 'embedded-postgres/dist/index.js')).href);
  const testPort = 55000 + Math.floor(Math.random() * 1000);
  const server = new EmbeddedPostgres({ databaseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'salon-online-pg-')), port: testPort,
    user: 'postgres', password: 'local-test-only', persistent: true, initdbFlags: ['--locale=C', '--encoding=UTF8'],
    postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: () => {} });
  let db;
  const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  try {
    await server.initialise(); await server.start();
    db = new Client({ host: '127.0.0.1', port: testPort, user: 'postgres', password: 'local-test-only', database: 'postgres' });
    await db.connect();
    await db.query(`
      create extension btree_gist;
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema private;
      grant usage on schema private to authenticated,service_role;
      create function auth.role() returns text language sql stable as $$select current_setting('test.role',true)$$;
      create function auth.uid() returns uuid language sql stable as $$select '${uuid(90)}'::uuid$$;
      create function private.is_manager() returns boolean language sql stable as $$select current_setting('test.manager',true)='true'$$;
      create function private.normalize_tr_phone(p_raw text) returns text language sql immutable as $$
        select case when length(regexp_replace(coalesce(p_raw,''),'[^0-9]','','g'))>=10
          then '90'||right(regexp_replace(p_raw,'[^0-9]','','g'),10) else null end$$;
      create table services(id uuid primary key,name text,price numeric,duration_minutes integer not null,active boolean not null);
      create table profiles(id uuid primary key,full_name text,username text,role text,active boolean);
      create table booking_settings(id boolean primary key,online_booking_enabled boolean,default_open_time time,default_close_time time);
      create table booking_schedule_overrides(schedule_date date primary key,open_time time,close_time time,is_closed boolean);
      create table clients(id uuid primary key default gen_random_uuid(),full_name text,phone text,updated_at timestamptz default now());
      create table appointments(id uuid primary key default gen_random_uuid(),client_id uuid,client_name text,client_phone text,
        service_id uuid,service_name text,amount numeric,employee_id uuid,scheduled_at timestamptz,scheduled_end timestamptz,
        duration_minutes integer,note text,status text default 'confirmed',source text default 'staff',staff_overlap_override boolean default false,
        created_by uuid,updated_by uuid);
      alter table appointments add constraint appointments_no_overlap exclude using gist
        (employee_id with =,tstzrange(scheduled_at,scheduled_end,'[)') with &&)
        where(status<>'cancelled' and source='online' and not staff_overlap_override);
      create table closed_time_slots(employee_id uuid,starts_at timestamptz,ends_at timestamptz);
      create table online_booking_requests(id uuid primary key default gen_random_uuid(),client_name text,phone text,phone_normalized text,
        service_id uuid,service_name text,amount numeric,employee_id uuid,scheduled_at timestamptz,duration_minutes integer,note text,
        request_ip_hash text,public_token uuid unique,status text,appointment_id uuid,reviewed_at timestamptz,reviewed_by uuid,
        updated_at timestamptz default now(),created_at timestamptz default now(),customer_revision integer default 0,last_customer_operation uuid);
      create table notifications(recipient_id uuid,appointment_id uuid,kind text,title text,body text);
      create function public.can_create_online_booking(text) returns boolean language sql stable as $$select true$$;
      create function private.online_booking_duration(p_service uuid) returns integer language sql stable as $$
        select case when name='Saç sakal' then 60 else 30 end from services where id=p_service and active$$;
      create function private.set_appointment_service_snapshot() returns trigger language plpgsql as $$begin return new; end$$;
      create function private.reject_appointment_during_closed_time() returns trigger language plpgsql as $$begin return new; end$$;
      create function public.set_appointment_end() returns trigger language plpgsql as $$begin
        new.scheduled_end:=new.scheduled_at+make_interval(mins=>new.duration_minutes);return new;end$$;
      create trigger appointments_set_service_snapshot before insert or update of service_id on appointments
        for each row execute function private.set_appointment_service_snapshot();
      create trigger appointments_validate_schedule before insert or update of scheduled_at,duration_minutes,service_id,employee_id,source,status,staff_overlap_override
        on appointments for each row execute function private.reject_appointment_during_closed_time();
      create trigger trg_set_appointment_end before insert or update of scheduled_at,duration_minutes,service_id on appointments
        for each row execute function public.set_appointment_end();
      insert into services values('${uuid(1)}','Saç sakal',500,30,true),('${uuid(2)}','Kısa bakım',200,30,true);
      insert into profiles values('${uuid(11)}','Birinci','person1','employee',true),('${uuid(12)}','İkinci','person2','employee',true);
      insert into booking_settings values(true,true,'09:00','20:00');
      insert into appointments(client_name,client_phone,service_id,service_name,employee_id,scheduled_at,duration_minutes,status,source)
        values('Eski müşteri','905000000001','${uuid(1)}','Saç sakal','${uuid(11)}','2026-11-02T09:00:00+03:00',30,'confirmed','staff');
      select set_config('test.role','service_role',false);
    `);
    await db.query(fs.readFileSync('supabase/migrations/20261016193740_reliable_online_booking_durations_and_slots.sql', 'utf8'));
    await db.query(fs.readFileSync('supabase/migrations/20261016194451_refresh_online_slot_snapshot_after_staff_lock.sql', 'utf8'));
    const old = (await db.query("select duration_minutes,scheduled_end,online_reserved_end from appointments where client_name='Eski müşteri'")).rows[0];
    assert.equal(old.duration_minutes, 30);
    assert.equal(new Date(old.scheduled_end).toISOString(), '2026-11-02T06:30:00.000Z');
    assert.equal(old.online_reserved_end, null, 'Historical appointment timestamps stay untouched');
    const durations = (await db.query('select name,duration_minutes,online_duration_minutes from services order by id')).rows;
    assert.deepEqual(durations.map(x => [x.duration_minutes, x.online_duration_minutes]), [[30, 60], [30, 30]]);
    assert.equal((await db.query('select default_open_time from booking_settings')).rows[0].default_open_time, '08:30:00');
    const slots = async (service, employee = null) => (await db.query('select public.online_booking_slots($1,$2,$3) as result', [service, '2026-11-02', employee])).rows[0].result.slots;
    const hair = await slots(uuid(1), uuid(11));
    assert(!hair.some(x => x.time === '09:30'), 'Legacy 30-minute calendar entry protects 60 minutes online');
    assert(hair.some(x => x.time === '10:00'));
    assert(hair.some(x => x.time === '19:00') && !hair.some(x => x.time === '19:30'));
    await db.query('update services set online_duration_minutes=90 where id=$1', [uuid(1)]);
    assert(!(await slots(uuid(1), uuid(11))).some(x => x.time === '19:00'), 'Changing service policy immediately changes offered slots');
    await db.query('update services set online_duration_minutes=60 where id=$1', [uuid(1)]);
    const short = await slots(uuid(2), uuid(11));
    assert(short.some(x => x.time === '19:30'), '30-minute service can end at 20:00');
    assert(short.some(x => x.time === '08:30'));
    assert.equal((await db.query("select jsonb_array_length(public.online_booking_slots($1,'2026-11-01'::date)->'slots') as count", [uuid(1)])).rows[0].count, 0, 'Sunday stays closed');
    const makeBooking = (phone, employee, hour, token) => ({ client_name: 'Test', phone, phone_normalized: phone,
      service_id: uuid(1), employee_id: employee, scheduled_at: `2026-11-02T${hour}:00+03:00`, duration_minutes: 60,
      public_token: token });
    const create = payload => db.query('select public.create_confirmed_online_booking($1) as result', [JSON.stringify(payload)]);
    const any = (await create(makeBooking('905000000002', null, '09:30', uuid(51)))).rows[0].result;
    assert.equal(any.employee_id, uuid(12), 'Fark etmez chooses the truly free employee');
    const created = (await db.query('select duration_minutes,online_protection_minutes,scheduled_end,online_reserved_end from appointments where id=$1', [any.appointment_id])).rows[0];
    assert.equal(created.duration_minutes, 30); assert.equal(created.online_protection_minutes, 60);
    assert.equal((new Date(created.online_reserved_end) - new Date(created.scheduled_end)) / 60000, 30);
    await assert.rejects(create(makeBooking('905000000003', uuid(12), '09:30', uuid(52))), /müsait değil/);
    await assert.rejects(create(makeBooking('905000000002', uuid(11), '09:30', uuid(53))), /aynı saatte/);
    // The manager can deliberately place a 30-minute internal booking in the online guard tail.
    await db.query(`insert into appointments(client_name,client_phone,service_id,employee_id,scheduled_at,status,source)
      values('Araya alınan','905000000004',$1,$2,'2026-11-02T10:00:00+03:00','confirmed','staff')`, [uuid(2), uuid(12)]);
    assert.equal((await db.query("select count(*)::integer as count from appointments where client_name='Araya alınan'")).rows[0].count, 1);
    assert(!(await slots(uuid(1), uuid(12))).some(x => x.time === '10:00'));
    await db.query("insert into closed_time_slots values($1,'2026-11-02T11:00:00+03:00','2026-11-02T12:00:00+03:00')", [uuid(11)]);
    assert(!(await slots(uuid(1), uuid(11))).some(x => x.time === '10:30'));
    await db.query("insert into online_booking_requests(client_name,phone,phone_normalized,service_id,service_name,amount,employee_id,scheduled_at,duration_minutes,public_token,status) values('Eski talep','905000000005','905000000005',$1,'Saç sakal',500,$2,'2026-11-02T13:00:00+03:00',30,$3,'pending')", [uuid(1), uuid(11), uuid(61)]);
    await db.query("select set_config('test.manager','true',false)");
    const pendingId = (await db.query('select id from online_booking_requests where public_token=$1', [uuid(61)])).rows[0].id;
    const approved = (await db.query('select public.approve_online_booking_request($1) as id', [pendingId])).rows[0].id;
    assert.deepEqual((await db.query('select duration_minutes,online_protection_minutes from appointments where id=$1', [approved])).rows[0], { duration_minutes: 30, online_protection_minutes: 60 });
    assert.equal((await db.query('select duration_minutes from online_booking_requests where id=$1', [pendingId])).rows[0].duration_minutes, 60);
    await db.query(`insert into appointments(client_name,client_phone,service_id,employee_id,scheduled_at,status,source)
      values('Bilinçli manuel yerleştirme','905000000008',$1,$2,'2026-11-02T13:00:00+03:00','confirmed','staff')`, [uuid(2), uuid(11)]);
    await assert.rejects(db.query(`insert into appointments(client_name,client_phone,service_id,employee_id,scheduled_at,status,source)
      values('Mükerrer müşteri','905000000005',$1,$2,'2026-11-02T13:00:00+03:00','confirmed','staff')`, [uuid(2), uuid(12)]), /aynı saatte/);
    const changed = (await db.query("select public.manage_customer_online_booking($1,$2,0,'update',$3) as result",
      [uuid(51), uuid(71), '2026-11-02T12:00:00+03:00'])).rows[0].result;
    assert.equal(changed.status, 'approved');
    assert.equal((await db.query('select online_protection_minutes from appointments where id=$1', [any.appointment_id])).rows[0].online_protection_minutes, 60);
    const cancelled = (await db.query("select public.manage_customer_online_booking($1,$2,1,'cancel',null) as result", [uuid(51), uuid(72)])).rows[0].result;
    assert.equal(cancelled.status, 'cancelled');
    assert.equal((await db.query('select status from appointments where id=$1', [any.appointment_id])).rows[0].status, 'cancelled');
    const second = new Client({ host: '127.0.0.1', port: testPort, user: 'postgres', password: 'local-test-only', database: 'postgres' });
    await second.connect();
    try {
      await second.query("select set_config('test.role','service_role',false)");
      const contenders = await Promise.allSettled([
        create(makeBooking('905000000006', uuid(11), '19:00', uuid(81))),
        second.query('select public.create_confirmed_online_booking($1) as result', [JSON.stringify(makeBooking('905000000007', uuid(11), '19:00', uuid(82)))]),
      ]);
      assert.equal(contenders.filter(result => result.status === 'fulfilled').length, 1, 'Only one customer may take the last slot');
      assert.equal((await db.query("select count(*)::integer as count from appointments where employee_id=$1 and scheduled_at='2026-11-02T19:00:00+03:00'", [uuid(11)])).rows[0].count, 1);
    } finally { await second.end(); }
    const concurrent = new Client({ host: '127.0.0.1', port: testPort, user: 'postgres', password: 'local-test-only', database: 'postgres' });
    await concurrent.connect();
    try {
      await concurrent.query("select set_config('test.role','service_role',false)");
      await db.query('begin');
      await db.query(`insert into appointments(client_name,client_phone,service_id,employee_id,scheduled_at,status,source)
        values('Kilidi tutan manuel randevu','905000000009',$1,$2,'2026-11-02T16:00:00+03:00','confirmed','staff')`, [uuid(2), uuid(11)]);
      const onlineDuringManual = concurrent.query('select public.create_confirmed_online_booking($1) as result',
        [JSON.stringify(makeBooking('905000000010', uuid(11), '16:00', uuid(83)))]);
      await new Promise(resolve => setTimeout(resolve, 100));
      await db.query('commit');
      await assert.rejects(onlineDuringManual, /müsait değil/, 'Online create must see a manual booking committed while it waited for the staff lock');
    } finally {
      await db.query('rollback').catch(() => {});
      await concurrent.end();
    }
    assert.equal((await db.query("select has_function_privilege('anon','public.online_booking_slots(uuid,date,uuid,uuid,integer)','execute') as allowed")).rows[0].allowed, false);
    console.log('PASS isolated PostgreSQL: durations, legacy guard, Fark etmez, manual flexibility, closures, day-end, Sunday, approval, reschedule, cancel, concurrent last slot and privilege');
  } finally {
    if (db) await db.end();
    if (process.platform === 'win32' && server.process) {
      const child = server.process;
      if (child.exitCode === null) child.kill('SIGTERM');
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 2000))]);
    } else await server.stop().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
