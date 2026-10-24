// Local PostgreSQL only. No live credentials or customer records.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { Client } = require(path.join(process.argv[2], 'pg'));
(async () => {
  const { default: EmbeddedPostgres } = await import(pathToFileURL(path.join(process.argv[2], 'embedded-postgres/dist/index.js')).href);
  const port = 56000 + Math.floor(Math.random() * 1000);
  const server = new EmbeddedPostgres({ databaseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'salon-active-rls-')), port,
    user: 'postgres', password: 'local-test-only', persistent: true,
    initdbFlags: ['--locale=C', '--encoding=UTF8'], postgresFlags: ['-h', '127.0.0.1'], onLog() {}, onError() {} });
  let db;
  try {
    await server.initialise(); await server.start();
    db = new Client({ host: '127.0.0.1', port, user: 'postgres', password: 'local-test-only', database: 'postgres' });
    await db.connect();
    await db.query(`
      create role authenticated; create role anon; create role service_role bypassrls;
      create schema auth; create schema private;
      create function auth.uid() returns text language sql stable as $$select current_setting('test.actor',true)$$;
      create table public.profiles(id text primary key,active boolean,role text);
      insert into profiles values ('manager',true,'manager'),('staff',true,'employee'),('inactive',false,'employee');
      create function private.is_active_salon_user() returns boolean language sql stable security definer
        set search_path=pg_catalog,public as $$select exists(select 1 from profiles where id=auth.uid() and active)$$;
      create function private.is_manager() returns boolean language sql stable security definer
        set search_path=pg_catalog,public as $$select exists(select 1 from profiles where id=auth.uid() and active and role='manager')$$;
      create table appointments(id int primary key,employee_id text,created_by text,note text);
      insert into appointments values(1,'staff','manager','original'),(2,'inactive','manager','original');
      alter table appointments enable row level security;
      grant usage on schema auth,private to authenticated; grant all on appointments to authenticated,service_role;
      create policy appointments_read_by_manager_or_assignee on appointments for select to authenticated
        using((select private.is_manager()) or employee_id=(select auth.uid()));
      create policy appointments_create_by_manager_or_assignee on appointments for insert to authenticated
        with check((select private.is_manager()) or (employee_id=(select auth.uid()) and created_by=(select auth.uid())));
      create policy appointments_update_by_manager_or_assignee on appointments for update to authenticated
        using((select private.is_manager()) or employee_id=(select auth.uid()))
        with check((select private.is_manager()) or employee_id=(select auth.uid()));
    `);
    async function actor(id, sql) {
      await db.query('begin');
      try { await db.query("select set_config('test.actor',$1,true)",[id]); await db.query('set local role authenticated'); return await db.query(sql); }
      finally { await db.query('rollback'); }
    }
    assert.equal((await actor('inactive','select * from appointments')).rowCount,1,'Reproduce inactive account reading its old appointment');
    await db.query(fs.readFileSync('supabase/migrations/20261024053623_require_active_appointment_actor.sql','utf8'));
    assert.equal((await actor('inactive','select * from appointments')).rowCount,0);
    assert.equal((await actor('inactive',"update appointments set note='changed' returning id")).rowCount,0);
    await assert.rejects(actor('inactive',"insert into appointments values(3,'inactive','inactive','test')"),/row-level security/);
    assert.equal((await actor('manager','select * from appointments')).rowCount,2);
    assert.equal((await actor('staff','select * from appointments')).rowCount,1);
    assert.equal((await actor('staff',"update appointments set note='changed' returning id")).rowCount,1);
    assert.equal((await actor('staff',"insert into appointments values(3,'staff','staff','test') returning id")).rowCount,1);
    await assert.rejects(actor('staff',"insert into appointments values(3,'inactive','staff','test')"),/row-level security/);
    await db.query('begin; set local role service_role');
    assert.equal((await db.query('select * from appointments')).rowCount,2);
    await db.query('rollback');
    await db.query('drop policy appointments_require_active_actor on appointments');
    assert.equal((await actor('inactive','select * from appointments')).rowCount,1,'Rollback tested');
    console.log('PASS inactive actor reproduction/fix, active manager/staff read/write, cross-staff denial, service-role bypass and rollback');
  } finally {
    if(db)await db.end();
    if(process.platform==='win32'&&server.process){const child=server.process;if(child.exitCode===null)child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,2000))]);}
    else await server.stop().catch(()=>{});
  }
})().catch(error=>{console.error(error);process.exitCode=1});
