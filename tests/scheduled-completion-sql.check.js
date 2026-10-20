// In-memory Postgres fixture: no live bookings or customer messages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.argv[2] ? path.resolve(process.argv[2]) : '@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema private; create schema cron;
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create function private.is_manager() returns boolean language sql stable as
        $$select current_setting('test.manager',true)='true'$$;
      create table public.appointments(
        id uuid primary key, employee_id uuid, client_id uuid, status text not null,
        scheduled_at timestamptz not null, duration_minutes integer not null default 30,
        staff_overlap_override boolean not null default false,
        completed_at timestamptz, completed_by uuid);
      create function private.complete_metadata() returns trigger language plpgsql as $$
      begin
        if new.status='completed' and old.status is distinct from 'completed' then
          new.completed_at=now(); new.completed_by=auth.uid();
        end if; return new;
      end $$;
      create trigger complete_metadata before update of status on public.appointments
        for each row execute function private.complete_metadata();
      create table public.booking_settings(
        id boolean primary key, whatsapp_thank_you_enabled boolean not null default false,
        whatsapp_thank_you_delay_minutes integer not null default 120);
      insert into public.booking_settings(id) values(true);
      create table public.clients(id uuid primary key,whatsapp_marketing_opt_in boolean,
        whatsapp_marketing_opt_in_at timestamptz,whatsapp_marketing_opt_out_at timestamptz);
      create table public.whatsapp_meta_template_mappings(
        template_key text primary key,approval_status text,approved_content_hash text);
      insert into public.whatsapp_meta_template_mappings values
        ('appointment_thank_you','pending',null);
      create table public.whatsapp_message_logs(
        idempotency_key text primary key,template_key text,appointment_id uuid,client_id uuid,
        scheduled_for timestamptz,next_attempt_at timestamptz);
      create function cron.schedule(text,text,text) returns integer language sql as $$select 1$$;
    `);
    const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
    const employee = uuid(1), client = uuid(2);
    await db.query('insert into clients values($1,true,now(),null)', [client]);
    await db.query(`insert into appointments(id,employee_id,client_id,status,scheduled_at) values
      ($1,$2,$3,'confirmed',now()-interval '1 day')`, [uuid(10), employee, client]);
    await db.exec(fs.readFileSync('supabase/migrations/20261020130234_scheduled_completion_and_meta_thank_you.sql', 'utf8'));
    await db.query("select set_config('test.uid',$1,false)", [employee]);
    await db.exec("select set_config('test.manager','false',false)");
    await db.query("insert into appointments(id,employee_id,client_id,status,scheduled_at) values($1,$2,$3,'confirmed',now()+interval '1 hour')",
      [uuid(20), employee, client]);
    await assert.rejects(db.query('select public.complete_appointment($1)', [uuid(20)]), /saati gelmeden/,
      'Staff cannot complete a future appointment');
    assert.equal((await db.query('select private.auto_complete_due_appointments() n')).rows[0].n, 0,
      'Historical confirmed bookings stay untouched at activation');
    assert.equal((await db.query('select status from appointments where id=$1', [uuid(10)])).rows[0].status, 'confirmed');
    await db.exec("update private.appointment_completion_automation set activated_at=now()-interval '1 day'");
    await db.query(`insert into appointments(id,employee_id,client_id,status,scheduled_at) values
      ($1,$5,$6,'confirmed',now()-interval '2 hours 1 minute'),
      ($2,$5,$6,'no_show',now()-interval '2 hours 1 minute'),
      ($3,$5,$6,'cancelled',now()-interval '2 hours 1 minute'),
      ($4,$5,$6,'confirmed',now()+interval '1 hour')`,
      [uuid(11), uuid(12), uuid(13), uuid(14), employee, client]);
    await db.exec("update private.appointment_completion_automation set activated_at=now()-interval '3 hours'");
    assert.equal((await db.query('select private.auto_complete_due_appointments() n')).rows[0].n, 1);
    assert.equal((await db.query('select private.auto_complete_due_appointments() n')).rows[0].n, 0,
      'Repeated cron does not complete twice');
    const statuses = (await db.query('select id,status from appointments where id=any($1::uuid[])',
      [[uuid(11), uuid(12), uuid(13), uuid(14)]])).rows;
    assert.deepEqual(statuses.map(x => x.status).sort(), ['cancelled', 'completed', 'confirmed', 'no_show'].sort());
    await db.exec("update booking_settings set whatsapp_thank_you_enabled=true");
    assert.equal((await db.query('select public.whatsapp_enqueue_due_thank_yous() result')).rows[0].result.appointment_thank_yous_enqueued, 0,
      'Meta approval gates enqueue');
    await db.exec("update whatsapp_meta_template_mappings set approval_status='approved',approved_content_hash='fixture'");
    await db.exec("update clients set whatsapp_marketing_opt_out_at=now()");
    assert.equal((await db.query('select public.whatsapp_enqueue_due_thank_yous() result')).rows[0].result.appointment_thank_yous_enqueued, 0,
      'Opted-out customers are not queued');
    await db.exec("update clients set whatsapp_marketing_opt_out_at=null");
    assert.equal((await db.query('select public.whatsapp_enqueue_due_thank_yous() result')).rows[0].result.appointment_thank_yous_enqueued, 1);
    assert.equal((await db.query('select public.whatsapp_enqueue_due_thank_yous() result')).rows[0].result.appointment_thank_yous_enqueued, 0);
    const queued = (await db.query('select appointment_id,scheduled_for from whatsapp_message_logs')).rows[0];
    assert.equal(queued.appointment_id, uuid(11));
    const target = (await db.query('select scheduled_at+interval \'2 hours\' target from appointments where id=$1', [uuid(11)])).rows[0].target;
    assert.equal(new Date(queued.scheduled_for).getTime(), new Date(target).getTime());
    console.log('PASS activation cutoff, no-show/cancel exclusion, idempotent completion, Meta/consent gate and two-hour schedule');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
