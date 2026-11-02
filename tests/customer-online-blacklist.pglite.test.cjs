const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require(process.argv[2] || '@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  const manager = '11111111-1111-4111-8111-111111111111';
  const employee = '22222222-2222-4222-8222-222222222222';
  const blocked = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema private;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table public.profiles(id uuid primary key,role text,active boolean);
      create table public.clients(id uuid primary key,full_name text,phone text,active boolean default true);
      create table public.appointments(id uuid primary key,client_id uuid,client_phone text,status text,scheduled_at timestamptz);
      create table public.online_booking_requests(id uuid primary key,client_name text,phone_normalized text,status text);
      create function private.is_manager() returns boolean language sql stable as $$
        select exists(select 1 from public.profiles where id=auth.uid() and role='manager' and active) $$;
      create function private.normalize_tr_phone(text) returns text language sql immutable as $$
        select nullif(regexp_replace(coalesce($1,''),'[^0-9]','','g'),'') $$;
      create function public.can_create_online_booking(text) returns boolean language sql stable as $$
        select $1 is not null $$;
      insert into public.profiles values
        ('${manager}','manager',true),('${employee}','employee',true);
      insert into public.clients(id,full_name,phone) values
        ('${blocked}','Mehmet Uncu','05320000001'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Ayşe Uncu','05320000001');
    `);
    await db.exec(fs.readFileSync('supabase/migrations/20261102141626_customer_online_booking_blacklist.sql', 'utf8'));
    await db.exec(`set request.jwt.claim.sub='${employee}'`);
    await assert.rejects(db.query('update clients set online_booking_blocked=true where id=$1',[blocked]), /Yönetici yetkisi gerekli/);
    await db.exec(`set request.jwt.claim.sub='${manager}'`);
    await db.query('update clients set online_booking_blocked=true where id=$1',[blocked]);
    const allowed = async (phone,name) => (await db.query('select public.can_create_online_booking($1,$2) result',[phone,name])).rows[0].result;
    assert.equal(await allowed('05320000001','Mehmet Uncu'),false);
    assert.equal(await allowed('05320000001','Ayşe Uncu'),true,'shared phone must not block a different customer');
    assert.equal(await allowed('05320000002','Mehmet Uncu'),true,'different phone does not prove same identity');
    await assert.rejects(db.query("insert into online_booking_requests values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Mehmet Uncu','05320000001','pending')"),/salonumuzla iletişime geçin/);
    await db.query("insert into online_booking_requests values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Ayşe Uncu','05320000001','pending')");
    await db.query("insert into appointments values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',$1,'05320000001','confirmed',now())",[blocked]);
    await db.query('update clients set online_booking_blocked=false where id=$1',[blocked]);
    await db.query("insert into online_booking_requests values('ffffffff-ffff-4fff-8fff-ffffffffffff','Mehmet Uncu','05320000001','pending')");
    await db.query('update clients set online_booking_blocked=true where id=$1',[blocked]);
    await assert.rejects(db.query("update online_booking_requests set status='approved' where id='ffffffff-ffff-4fff-8fff-ffffffffffff'"),/salonumuzla iletişime geçin/);
    await db.query("insert into online_booking_requests values('99999999-9999-4999-8999-999999999999','Mehmet Uncu','05320000001','cancelled')");
    await db.query("update online_booking_requests set status='cancelled' where id='ffffffff-ffff-4fff-8fff-ffffffffffff'");
    await db.query('update clients set online_booking_blocked=false where id=$1',[blocked]);
    assert.equal(await allowed('05320000001','Mehmet Uncu'),true);
    await db.query("update online_booking_requests set status='approved' where id='ffffffff-ffff-4fff-8fff-ffffffffffff'");
    await db.query('update clients set online_booking_blocked=true where id=$1',[blocked]);
    await db.query("update online_booking_requests set status='approved' where id='ffffffff-ffff-4fff-8fff-ffffffffffff'");
    await db.query("update online_booking_requests set status='cancelled' where id='ffffffff-ffff-4fff-8fff-ffffffffffff'");
    assert.equal((await db.query("select status from appointments where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'")).rows[0].status,'confirmed');
    console.log('PASS blacklist: manager guard, identity match, pending/approval denial, removal, manual appointment');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
