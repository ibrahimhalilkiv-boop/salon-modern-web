const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const migration = [
  '20261027201412_staff_client_lookup_api.sql',
  '20261027201419_restrict_staff_client_select.sql'
].map(name=>fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8')).join('\n');
const ids = {
  staff: '11111111-1111-4111-8111-111111111111',
  other: '22222222-2222-4222-8222-222222222222',
  manager: '33333333-3333-4333-8333-333333333333',
  own: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  another: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  unrelated: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
};
async function main(){
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema private;
    grant usage on schema auth,private,public to authenticated;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant execute on function auth.uid() to authenticated;
    create table public.profiles(id uuid primary key, role text, active boolean);
    create table public.clients(id uuid primary key default gen_random_uuid(), full_name text unique not null,
      phone text, note text, last_service_id uuid, last_employee_id uuid,
      last_appointment_at timestamptz, active boolean not null default true, created_by uuid);
    create table public.appointments(id uuid primary key default gen_random_uuid(), client_id uuid, employee_id uuid);
    create view public.client_visit_intelligence with (security_invoker=true) as
      select c.id as client_id,c.full_name,c.phone,c.note,1::integer visit_count,
      1::integer distinct_visit_days,current_date last_visit_date,1::integer average_visit_days,
      current_date expected_next_visit_date,c.last_employee_id preferred_employee_id,
      c.last_service_id preferred_service_id,''::text preferred_service_name,
      1::numeric recorded_spend,true spend_reliable from public.clients c;
    create function private.is_manager() returns boolean language sql stable security definer
      set search_path='' as $$ select exists(select 1 from public.profiles p
      where p.id=auth.uid() and p.active and p.role='manager') $$;
    alter table public.clients enable row level security;
    alter table public.appointments enable row level security;
    create policy clients_read_by_active_users on public.clients for select to authenticated using (true);
    create policy appointments_read on public.appointments for select to authenticated
      using (employee_id=auth.uid() or private.is_manager());
    create policy appointments_insert on public.appointments for insert to authenticated with check (employee_id=auth.uid());
    grant select,insert on public.clients,public.appointments to authenticated;
    grant select on public.client_visit_intelligence,public.profiles to authenticated;
    grant execute on function private.is_manager() to authenticated;
  `);
  await db.exec(migration);
  await db.exec(`
    insert into public.profiles values
      ('${ids.staff}','employee',true),('${ids.other}','employee',true),('${ids.manager}','manager',true);
    insert into public.clients(id,full_name,phone) values
      ('${ids.own}','Ayşe Yılmaz','05000000001'),
      ('${ids.another}','Mehmet Demir','05000000002'),
      ('${ids.unrelated}','Deniz Kaya','05000000003');
    insert into public.appointments(client_id,employee_id) values
      ('${ids.own}','${ids.staff}'),('${ids.another}','${ids.other}');
  `);
  const one = async sql => (await db.query(sql)).rows;
  const as = async id => {
    await db.exec(`set request.jwt.claim.sub='${id}';set role authenticated;`);
  };
  const reset = async () => db.exec('reset role');
  const assert = (condition,message) => { if(!condition) throw Error(message); console.log('PASS',message); };
  await as(ids.staff);
  assert((await one('select * from public.clients')).length===0,'staff direct select=* blocked');
  assert((await one('select * from public.clients limit 1 offset 1')).length===0,'staff pagination blocked');
  assert((await one('select * from public.client_visit_intelligence')).length===0,'staff invoker view blocked');
  const searched=await one("select * from public.staff_search_clients('ayse')");
  assert(searched.length===1&&Object.keys(searched[0]).sort().join(',')==='full_name,id,phone','staff search returns only identity and contact');
  assert((await one('select * from public.staff_owned_clients()')).length===1,'staff own history scoped');
  assert((await one('select * from public.staff_client_intelligence()')).length===1,'staff intelligence scoped');
  let invalid=false;try{await one("select * from public.staff_search_clients('a')")}catch(e){invalid=true}
  assert(invalid,'short query rejected');
  const created=await one("select * from public.staff_create_client('Yeni Musteri','05000000004')");
  assert(created.length===1,'staff customer creation works');
  const reused=await one("select * from public.staff_create_client('AYŞE YILMAZ',null)");
  assert(reused.length===1&&reused[0].id===ids.own,'typed name reuses the existing client');
  await db.exec(`insert into public.appointments(client_id,employee_id) values ('${created[0].id}','${ids.staff}')`);
  assert((await one('select * from public.staff_owned_clients()')).length===2,'new customer joins own history after appointment');
  await reset();await db.exec('truncate private.staff_client_lookup_quota');await as(ids.staff);
  let blocked=false;for(let i=0;i<21;i++){try{await one("select * from public.staff_search_clients('ayse')")}catch(e){blocked=i===20;break}}
  assert(blocked,'server rate limit after 20 lookups per minute');
  await reset();await as(ids.manager);
  assert((await one('select * from public.clients')).length===4,'manager full client read preserved');
  await reset();
  await db.exec(`
    insert into public.clients(full_name)
      select 'Fixture Client ' || n from generate_series(1,501) n;
    insert into public.appointments(client_id,employee_id)
      select c.id,'${ids.staff}' from public.clients c where c.full_name like 'Fixture Client %';
  `);
  await as(ids.staff);
  assert((await one('select * from public.staff_owned_clients(null,null)')).length===500,'null limit cannot remove own-history page cap');
  assert((await one('select * from public.staff_client_intelligence(null,null)')).length===500,'null limit cannot remove intelligence page cap');
  await reset();await db.exec('truncate private.staff_client_lookup_quota');await as(ids.staff);
  assert((await one("select * from public.staff_search_clients('Fixture')")).length===8,'search result cap is enforced in database');
  let wildcard=false;try{await one("select * from public.staff_search_clients('%%%')")}catch(e){wildcard=true}
  assert(wildcard,'wildcard-only query rejected');
  await reset();
  await db.exec('set role anon');
  let anonymous=false;try{await one("select * from public.staff_search_clients('ayse')")}catch(e){anonymous=true}
  assert(anonymous,'anonymous search RPC denied');
  await reset();
  console.log('All isolated database checks passed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
