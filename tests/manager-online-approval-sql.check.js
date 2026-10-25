// Isolated PGlite fixture. No live appointment or WhatsApp message is created.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.argv[2] ? path.resolve(process.argv[2]) : '@electric-sql/pglite');
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const manager = uuid(1), employee = uuid(2), service = uuid(3), legacyClient = uuid(4), canonicalClient = uuid(5);
const future = new Date(Date.now() + 7 * 86400000);
while (future.getUTCDay() === 0) future.setUTCDate(future.getUTCDate() + 1);
const start = future.toISOString().slice(0, 10) + 'T10:00:00+03:00';
const next = future.toISOString().slice(0, 10) + 'T11:00:00+03:00';
const oldStart = new Date(Date.now() - 7 * 86400000).toISOString();
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema private; create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create table public.profiles(id uuid primary key,full_name text,username text,role text,active boolean);
      create table public.services(id uuid primary key,name text,price numeric,duration_minutes integer,online_duration_minutes integer,active boolean);
      create table public.clients(id uuid primary key default gen_random_uuid(),full_name text,phone text,note text,updated_at timestamptz default now());
      create table public.appointments(id uuid primary key default gen_random_uuid(),client_id uuid,client_name text,client_phone text,
        service_id uuid,service_name text,amount numeric,employee_id uuid,scheduled_at timestamptz,duration_minutes integer default 60,
        online_protection_minutes integer,note text,created_by uuid,status text,source text);
      create table public.online_booking_requests(id uuid primary key default gen_random_uuid(),client_name text,phone text,phone_normalized text,
        service_id uuid,service_name text,amount numeric,employee_id uuid,scheduled_at timestamptz,duration_minutes integer,note text,
        request_ip_hash text,public_token uuid unique,status text,appointment_id uuid,reviewed_by uuid,reviewed_at timestamptz,
        created_at timestamptz default now(),updated_at timestamptz default now(),customer_revision integer default 0);
      create table public.notifications(recipient_id uuid,kind text,title text,body text);
      create function private.normalize_tr_phone(text) returns text language sql immutable as $$select $1$$;
      create function public.can_create_online_booking(text) returns boolean language sql stable as $$select true$$;
      create function private.online_booking_duration(uuid) returns integer language sql stable as
        $$select greatest(duration_minutes,online_duration_minutes) from public.services where id=$1 and active$$;
      create function private.check_online_booking_window(timestamptz,integer) returns void language plpgsql as
        $$begin if $1<=now() then raise exception 'Geçmiş saat'; end if; end$$;
      create function private.online_slot_available(uuid,timestamptz,integer,uuid default null) returns boolean language sql stable as
        $$select not exists(select 1 from public.appointments where employee_id=$1 and scheduled_at=$2 and status<>'cancelled' and id is distinct from $4)$$;
      create function private.is_manager() returns boolean language sql stable as
        $$select exists(select 1 from public.profiles where id=auth.uid() and role='manager' and active)$$;
      create function private.appointment_snapshot() returns trigger language plpgsql as
        $$begin select name into new.service_name from public.services where id=new.service_id; return new; end$$;
      create trigger appointment_snapshot before insert or update of service_id on public.appointments
        for each row execute function private.appointment_snapshot();
      grant usage on schema public,private,auth to service_role,authenticated;
      grant all on all tables in schema public to service_role,authenticated;
      grant execute on all functions in schema public,private,auth to service_role,authenticated;
    `);
    await db.query('insert into public.profiles values($1,\'Yönetici\',\'owner\',\'manager\',true),($2,\'Çalışan\',\'staff\',\'employee\',true)', [manager, employee]);
    await db.query('insert into public.services values($1,\'Saç\',800,60,60,true)', [service]);
    await db.query('insert into public.clients(id,full_name,phone,note) values($1,\'Eski Müşteri\',\'905000000099\',null)', [legacyClient]);
    const oldAppointment = (await db.query('insert into public.appointments(client_id,client_name,client_phone,service_id,amount,employee_id,scheduled_at,note,status,source) values($1,\'Eski Müşteri\',\'905000000099\',$2,800,$3,$4,\'Eski online not\',\'confirmed\',\'online\') returning id', [legacyClient, service, employee, oldStart])).rows[0].id;
    await db.query('insert into public.online_booking_requests(client_name,phone,phone_normalized,service_id,service_name,amount,employee_id,scheduled_at,duration_minutes,note,public_token,status,appointment_id) values(\'Eski Müşteri\',\'905000000099\',\'905000000099\',$1,\'Saç\',800,$2,$3,60,\'Eski online not\',$4,\'approved\',$5)', [service, employee, oldStart, uuid(30), oldAppointment]);
    const migration = fs.readFileSync('supabase/migrations/20261025212654_manager_approve_online_booking.sql', 'utf8');
    await db.exec(migration);
    await db.exec(fs.readFileSync('supabase/migrations/20261025214646_online_booking_registered_customer_name.sql', 'utf8'));
    await db.query('insert into public.clients(id,full_name,phone) values($1,\'Mehmet Uncu\',\'905000000042\')', [canonicalClient]);
    assert.match((await db.query('select note from public.clients where id=$1', [legacyClient])).rows[0].note, /Eski online not/, 'Old approved note appears in customer notes');
    await db.exec('set role service_role');
    const payload = { public_token: uuid(40), employee_id: employee, service_id: service, scheduled_at: start,
      duration_minutes: 60, client_name: 'Yeni Müşteri', phone: '905000000041',
      phone_normalized: '905000000041', note: 'Yanları kısa olsun' };
    const create = () => db.query('select public.create_pending_online_booking($1::jsonb) as result', [JSON.stringify(payload)]);
    const created = (await create()).rows[0].result;
    assert.equal(created.status, 'pending');
    assert.equal(created.appointment_id, null);
    assert.equal((await create()).rows[0].result.id, created.id, 'Retry returns one request');
    assert.equal((await db.query('select count(*)::int as n from public.notifications where kind=\'booking_request\'')).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int as n from public.appointments where client_name=\'Yeni Müşteri\'')).rows[0].n, 0, 'Pending is absent from calendar');
    await assert.rejects(db.query('select public.create_confirmed_online_booking($1::jsonb)', [JSON.stringify(payload)]), /Yönetici onayı gerekli/);
    await db.exec('reset role');
    await db.exec('set role authenticated');
    await db.query('select set_config(\'test.uid\',$1,false)', [employee]);
    await assert.rejects(db.query('select public.approve_online_booking_request($1)', [created.id]), /Yönetici yetkisi gerekli/);
    await db.query('select set_config(\'test.uid\',$1,false)', [manager]);
    await db.query('select public.update_pending_online_booking_request($1,$2,$3,$4)', [created.id, next, employee, service]);
    assert.equal((await db.query('select scheduled_at from public.online_booking_requests where id=$1', [created.id])).rows[0].scheduled_at.toISOString(), new Date(next).toISOString());
    const appointment = (await db.query('select public.approve_online_booking_request($1) as id', [created.id])).rows[0].id;
    assert(appointment);
    assert.equal((await db.query('select status from public.online_booking_requests where id=$1', [created.id])).rows[0].status, 'approved');
    assert.match((await db.query('select note from public.clients where full_name=\'Yeni Müşteri\'')).rows[0].note, /Yanları kısa olsun/);
    await assert.rejects(db.query('select public.approve_online_booking_request($1)', [created.id]), /Bekleyen talep bulunamadı/);
    await db.query('update public.appointments set scheduled_at=$1 where id=$2', [start, appointment]);
    assert.equal((await db.query('select customer_revision from public.online_booking_requests where id=$1', [created.id])).rows[0].customer_revision, 1, 'Manager edit invalidates stale customer revision');
    await db.query('update public.appointments set status=\'cancelled\' where id=$1', [appointment]);
    assert.equal((await db.query('select status from public.online_booking_requests where id=$1', [created.id])).rows[0].status, 'cancelled', 'Manager cancellation updates tracking');
    await db.exec('reset role');
    await db.exec('set role service_role');
    const canonicalPayload = { ...payload, public_token: uuid(41), client_name: 'mehmet uncu',
      phone: '905000000042', phone_normalized: '905000000042' };
    const canonicalRequest = (await db.query('select public.create_pending_online_booking($1::jsonb) as result', [JSON.stringify(canonicalPayload)])).rows[0].result;
    await db.exec('reset role');
    await db.exec('set role authenticated');
    await db.query('select set_config(\'test.uid\',$1,false)', [manager]);
    const canonicalAppointment = (await db.query('select public.approve_online_booking_request($1) as id', [canonicalRequest.id])).rows[0].id;
    const canonicalRow = (await db.query('select client_id,client_name from public.appointments where id=$1', [canonicalAppointment])).rows[0];
    assert.equal(canonicalRow.client_id, canonicalClient, 'Existing customer is matched by name, without changing identity');
    assert.equal(canonicalRow.client_name, 'Mehmet Uncu', 'Calendar uses the saved customer spelling');
    assert.equal((await db.query('select client_name from public.online_booking_requests where id=$1', [canonicalRequest.id])).rows[0].client_name, 'mehmet uncu', 'Submitted spelling remains in request audit');
    await db.exec('reset role');
    await db.exec('set role service_role');
    const familyPayload = { ...canonicalPayload, public_token: uuid(42), client_name: 'Farklı Kişi', scheduled_at: next };
    const familyRequest = (await db.query('select public.create_pending_online_booking($1::jsonb) as result', [JSON.stringify(familyPayload)])).rows[0].result;
    await db.exec('reset role');
    await db.exec('set role authenticated');
    await db.query('select set_config(\'test.uid\',$1,false)', [manager]);
    const familyAppointment = (await db.query('select public.approve_online_booking_request($1) as id', [familyRequest.id])).rows[0].id;
    const familyRow = (await db.query('select client_id,client_name from public.appointments where id=$1', [familyAppointment])).rows[0];
    assert.notEqual(familyRow.client_id, canonicalClient, 'Shared phone does not merge differently named customers');
    assert.equal(familyRow.client_name, 'Farklı Kişi');
    console.log('PASS pending-only creation, dedup, manager approval, saved customer name, shared phone separation, notes, tracking and cancellation');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
