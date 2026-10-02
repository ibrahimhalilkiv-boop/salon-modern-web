// Local PostgreSQL only: retain the existing complete calendar fixture.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const runtime=process.argv[2],{Client}=require(path.join(runtime,'pg'));
const previous=fs.readFileSync('tests/calendar-customer-sql.check.js','utf8');
const fixture=previous.match(/const fixture=\x60([\s\S]*?)\x60;/)[1];
(async()=>{
 const {default:EmbeddedPostgres}=await import(require('node:url').pathToFileURL(path.join(runtime,'embedded-postgres/dist/index.js')).href);
 const server=new EmbeddedPostgres({databaseDir:fs.mkdtempSync(path.join(os.tmpdir(),'salon-strict-pg-')),port:55440,user:'postgres',password:'local-test-only',persistent:true,initdbFlags:['--locale=C','--encoding=UTF8'],postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
 let db,other;
 try{
 await server.initialise();await server.start();
 const config={host:'127.0.0.1',port:55440,user:'postgres',password:'local-test-only',database:'postgres'};
 db=new Client(config);other=new Client(config);await db.connect();await other.connect();
 await db.query(fixture);
 await db.query(fs.readFileSync('supabase/migrations/20261001190813_calendar_real_duration_customer_management.sql','utf8'));
 const notifications=fs.readFileSync('supabase/migrations/20260921113000_harden_web_push_appointment_notifications.sql','utf8').match(/create or replace function private\.notify_appointment_assignment\(\)[\s\S]*?\$\$;/i)[0];
 await db.query(notifications);await db.query('create trigger appointments_notify_assignee after insert or update on appointments for each row execute function private.notify_appointment_assignment()');
 const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),service=uuid(1),employee=uuid(2),manager=uuid(3),second=uuid(4);
 await db.query("insert into services values($1,'Test',100,45,true);",[service]);
 await db.query("insert into profiles values($1,'Personel','personel',true,'employee'),($2,'Yönetici','manager',true,'manager'),($3,'Diğer','other',true,'employee')",[employee,manager,second]);
 for(const c of [db,other]){await c.query("set test.role='authenticated'");await c.query("select set_config('test.uid',$1,false)",[manager]);}
 const at=t=>'2026-10-05T'+t+':00+03:00';
 const insert=(c,t,emp=employee,override=false,source='staff')=>c.query("insert into appointments(client_name,service_id,employee_id,scheduled_at,duration_minutes,status,source,staff_overlap_override) values('Fixture',$1,$2,$3,45,'confirmed',$4,$5) returning id",[service,emp,at(t),source,override]);
 const legacy=(await insert(db,'10:00')).rows[0].id;await insert(db,'10:15',employee,true);
 await db.query(fs.readFileSync('supabase/migrations/20261002085950_enforce_staff_appointment_conflicts.sql','utf8'));
 assert.equal((await db.query('select count(*)::int n from appointments')).rows[0].n,2);
 await db.query("update appointments set scheduled_at=scheduled_at,duration_minutes=duration_minutes,staff_overlap_override=staff_overlap_override,amount=75,client_name='Edited' where id=$1",[legacy]);
 const noticeCount=(await db.query('select count(*)::int n from notifications')).rows[0].n;
 await assert.rejects(insert(db,'10:30'),/Bu saat dolu/);
 await assert.rejects(insert(db,'10:30',employee,true),/Bu saat dolu/);
 await assert.rejects(insert(db,'10:30',employee,true,'online'),/Bu saat dolu/);
 assert.equal((await db.query('select count(*)::int n from notifications')).rows[0].n,noticeCount,'Rejected writes do not generate notifications');
 await insert(db,'10:30',second);await insert(db,'11:00'); // legacy 10:15 ends exactly 11:00
 const free=(await insert(db,'12:00')).rows[0].id;
 await assert.rejects(db.query('update appointments set scheduled_at=$1,staff_overlap_override=true where id=$2',[at('10:30'),free]),/Bu saat dolu/);
 await db.query('update appointments set scheduled_at=$1 where id=$2',[at('12:15'),free]);
 await db.query('insert into closed_time_slots values($1,$2,$3)',[employee,at('13:00'),at('14:00')]);
 await assert.rejects(insert(db,'12:45'),/kapalı/);
 await db.query('begin');await insert(db,'15:00');
 let settled=false;const pending=insert(other,'15:00',employee,true).then(()=>({ok:true}),error=>({error})).finally(()=>settled=true);
 await new Promise(resolve=>setTimeout(resolve,150));assert.equal(settled,false);
 await db.query('commit');assert((await pending).error);
 assert.equal((await db.query('select count(*)::int n from appointments where scheduled_at=$1',[at('15:00')])).rows[0].n,1);
 console.log('PASS strict PostgreSQL create/edit/move, ignored override, online, boundary, other employee, closed slots, legacy edits and TWO-CONNECTION concurrency');
 }finally{if(other)await other.end();if(db)await db.end();await server.stop()}
})().catch(error=>{console.error(error);process.exitCode=1});
