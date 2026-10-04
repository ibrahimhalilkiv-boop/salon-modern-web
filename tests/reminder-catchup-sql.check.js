// Isolated PostgreSQL fixture; no production access.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const runtime=process.argv[2],{Client}=require(path.join(runtime,'pg'));
(async()=>{
const {default:EmbeddedPostgres}=await import(require('node:url').pathToFileURL(path.join(runtime,'embedded-postgres/dist/index.js')).href);
const server=new EmbeddedPostgres({databaseDir:fs.mkdtempSync(path.join(os.tmpdir(),'salon-reminder-pg-')),port:55442,user:'postgres',password:'local-test-only',persistent:true,initdbFlags:['--locale=C','--encoding=UTF8'],postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
let db;
try{
await server.initialise();await server.start();db=new Client({host:'127.0.0.1',port:55442,user:'postgres',password:'local-test-only',database:'postgres'});await db.connect();
await db.query(`create schema private;create table profiles(id uuid primary key,active boolean);
create table appointments(id uuid primary key,created_by uuid,client_name text,scheduled_at timestamptz,status text,employee_id uuid);
create table online_booking_requests(appointment_id uuid);
create table notifications(recipient_id uuid,appointment_id uuid,kind text,title text,body text,reminder_for timestamptz,unique(recipient_id,appointment_id,kind,reminder_for));`);
await db.query(fs.readFileSync('supabase/migrations/20261002183432_online_booking_reminder_recipient.sql','utf8'));
await db.query('begin');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
await db.query('insert into profiles values($1,true),($2,false)',[uuid(1),uuid(2)]);
const insert=(id,minutes,status='confirmed',creator=1)=>db.query('insert into appointments(id,created_by,client_name,scheduled_at,status) values($1,$2,$3,now()+make_interval(secs=>$4),$5)',[uuid(id),creator?uuid(creator):null,'Fixture',minutes*60,status]);
await insert(10,60);await insert(11,57);await insert(12,30);await insert(13,29.9);await insert(14,60.1);await insert(15,57,'cancelled');await insert(16,57,'confirmed',2);await insert(17,57,'confirmed',null);await insert(18,-60);
const enqueue=async()=>Number((await db.query('select private.enqueue_due_appointment_reminders() n')).rows[0].n);
assert.equal(await enqueue(),3);assert.equal(await enqueue(),0,'Repeated scheduler never duplicates');
const notes=(await db.query('select appointment_id,body,recipient_id from notifications')).rows;
assert(notes.find(n=>n.appointment_id===uuid(10)).body.includes('1 saat'));
assert(notes.find(n=>n.appointment_id===uuid(11)).body.includes('57 dakika'));
assert(notes.find(n=>n.appointment_id===uuid(12)).body.includes('30 dakika'));
assert(notes.every(n=>n.recipient_id===uuid(1)));
await db.query("update appointments set scheduled_at=now()+interval '58 minutes' where id=$1",[uuid(10)]);
assert.equal(await enqueue(),1,'A changed appointment time has a distinct reminder identity');
await db.query("update appointments set status='cancelled' where id=$1",[uuid(10)]);assert.equal(await enqueue(),0);
await db.query('insert into profiles values($1,true)',[uuid(3)]);
await insert(20,58,'confirmed',null);await insert(21,58,'confirmed',1);await insert(22,58,'confirmed',null);await insert(23,58,'cancelled',null);
await db.query('update appointments set employee_id=$1 where id in ($2,$3,$4,$5)',[uuid(3),uuid(20),uuid(21),uuid(22),uuid(23)]);
await db.query('insert into online_booking_requests values($1),($2),($3)',[uuid(20),uuid(21),uuid(23)]);
assert.equal(await enqueue(),2);assert.equal(await enqueue(),0);
const online=(await db.query('select appointment_id,recipient_id from notifications where appointment_id in ($1,$2,$3,$4)',[uuid(20),uuid(21),uuid(22),uuid(23)])).rows;
assert.equal(online.find(n=>n.appointment_id===uuid(20)).recipient_id,uuid(3));assert.equal(online.find(n=>n.appointment_id===uuid(21)).recipient_id,uuid(1));assert.equal(online.length,2);
await db.query('rollback');console.log('PASS reminders: catchup, dedup, creator routing, automatic online employee fallback, cancellation and missing manual creator exclusion');
}finally{if(db)await db.end();await server.stop()}
})().catch(e=>{console.error(e);process.exitCode=1});
