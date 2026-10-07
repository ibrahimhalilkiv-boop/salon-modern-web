// Run with a local @electric-sql/pglite install path as the first argument.
// The database is in memory; this never connects to or changes production.
const { PGlite } = require(process.argv[2] || '@electric-sql/pglite');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema private;
      grant usage on schema private to authenticated, service_role;

      create function private.normalize_tr_phone(p_raw text)
      returns text language sql immutable security invoker
      set search_path=pg_catalog as $$
        with value as (select regexp_replace(coalesce(p_raw,''),'[^0-9]','','g') digits)
        select case
          when digits ~ '^905[0-9]{9}$' then digits
          when digits ~ '^00905[0-9]{9}$' then substring(digits from 3)
          when digits ~ '^05[0-9]{9}$' then '90'||substring(digits from 2)
          when digits ~ '^5[0-9]{9}$' then '90'||digits
          else null
        end from value
      $$;

      revoke all on function private.normalize_tr_phone(text) from public, anon, authenticated;
      grant execute on function private.normalize_tr_phone(text) to service_role;

      create table public.clients(id integer primary key, full_name text not null, phone text, active boolean default true);
      create index clients_normalized_tr_phone_idx
        on public.clients(private.normalize_tr_phone(phone))
        where active and phone is not null;
      grant select, update on public.clients to authenticated;
      insert into public.clients(id,full_name,phone) values(1,'Eski Ad','05325514129');
    `);

    await db.exec('set role authenticated');
    await assert.rejects(
      db.exec("update public.clients set phone='05325514130' where id=1"),
      /permission denied for function normalize_tr_phone/,
      'The previous ACL must reproduce the production update failure'
    );
    await db.exec('reset role');

    await db.exec(fs.readFileSync(
      'supabase/migrations/20261007082944_allow_authenticated_client_phone_normalization.sql',
      'utf8'
    ));

    await db.exec('set role authenticated');
    await db.exec("update public.clients set full_name='Yeni Ad', phone='05325514130' where id=1");
    const normalized = await db.query("select private.normalize_tr_phone(phone) as phone from public.clients where id=1");
    assert.equal(normalized.rows[0].phone, '905325514130', 'Phone normalization must remain unchanged');
    await db.exec('reset role');

    const privileges = await db.query(`
      select
        has_function_privilege('authenticated','private.normalize_tr_phone(text)','EXECUTE') authenticated_execute,
        has_function_privilege('anon','private.normalize_tr_phone(text)','EXECUTE') anon_execute,
        has_function_privilege('public','private.normalize_tr_phone(text)','EXECUTE') public_execute,
        has_function_privilege('service_role','private.normalize_tr_phone(text)','EXECUTE') service_role_execute
    `);
    assert.deepEqual(privileges.rows[0], {
      authenticated_execute: true,
      anon_execute: false,
      public_execute: false,
      service_role_execute: true
    });
    console.log('PASS authenticated client name/phone update, phone normalization, and least-privilege ACL');
  } finally {
    await db.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
