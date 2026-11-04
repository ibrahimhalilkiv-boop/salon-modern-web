const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require(process.argv[2]||'@electric-sql/pglite');

(async()=>{
  const db=new PGlite();
  await db.exec('create schema private; create role anon; create role authenticated; create role service_role; create table public.clients(id integer generated always as identity primary key,full_name text not null);');
  const migration=fs.readFileSync('supabase/migrations/20261104144237_normalize_customer_names.sql','utf8');
  await db.exec(migration.split('-- Existing approved booking flow')[0]);
  const rows=await db.query("insert into public.clients(full_name) values ('mehmet uncu'),('ibrahim yaylacık'),('IŞIK  ılgaz') returning full_name");
  assert.deepEqual(rows.rows.map(row=>row.full_name),['Mehmet Uncu','İbrahim Yaylacık','Işık Ilgaz']);
  await db.exec("update public.clients set full_name='ayşe-nur şEN' where id=1");
  const updated=await db.query('select full_name from public.clients where id=1');
  assert.equal(updated.rows[0].full_name,'Ayşe-Nur Şen');
  const keys=await db.query("select private.customer_name_key('İbrahim Yaylacık')=private.customer_name_key('ibrahim Yaylacık') same");
  assert.equal(keys.rows[0].same,true);
  await db.close();
  console.log('PASS PostgreSQL Turkish name trigger and canonical key');
})().catch(error=>{console.error(error);process.exitCode=1});
