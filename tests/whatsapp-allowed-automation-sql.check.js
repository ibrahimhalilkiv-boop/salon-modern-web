const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.argv[2] ? path.resolve(process.argv[2]) : '@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema private;
      create table public.booking_settings (
        id boolean primary key, whatsapp_return_auto_enabled boolean,
        whatsapp_thank_you_enabled boolean, appointment_reminder_minutes integer,
        updated_at timestamptz default now());
      insert into public.booking_settings values(true,true,false,30,now());
      create table public.whatsapp_meta_template_mappings (
        template_key text primary key, meta_template_name text, placeholder_order jsonb default '[]',
        approved_content_hash text, approval_status text, approved_at timestamptz,
        updated_at timestamptz default now());
      insert into public.whatsapp_meta_template_mappings(template_key,meta_template_name,approved_content_hash,approval_status)
      values ('appointment_confirmation','confirmation','hash','approved'),
             ('appointment_reminder','reminder','hash','approved'),
             ('appointment_update','update','hash','approved'),
             ('appointment_cancelled','cancelled','hash','approved'),
             ('appointment_thank_you','thanks',null,'pending'),
             ('customer_return_reminder','return',null,'pending');
      create table public.whatsapp_message_logs (id serial primary key,template_key text);
      insert into public.whatsapp_message_logs(template_key) values ('appointment_cancelled');
      create table public.message_templates(template_key text primary key,content text);
      insert into public.message_templates values ('appointment_confirmation','old'),('customer_return_reminder','old');
      create function private.mark_meta_template_pending() returns trigger language plpgsql as $$
      begin return new; end $$;
      create trigger message_templates_mark_meta_pending after insert or update of content
      on public.message_templates for each row execute function private.mark_meta_template_pending();
    `);
    await db.exec(fs.readFileSync('supabase/migrations/20261102090806_restrict_whatsapp_automation_to_confirmation_and_reminder.sql', 'utf8'));
    const settings = (await db.query('select * from public.booking_settings')).rows[0];
    assert.equal(settings.whatsapp_return_auto_enabled, false);
    assert.equal(settings.appointment_reminder_minutes, 60);
    await assert.rejects(db.query('update public.booking_settings set whatsapp_return_auto_enabled=true'), /booking_settings_only_confirmation_and_hourly_reminder/);
    await assert.rejects(db.query('update public.booking_settings set appointment_reminder_minutes=30'), /booking_settings_only_confirmation_and_hourly_reminder/);
    const maps = (await db.query('select template_key,meta_template_name,approved_content_hash,approval_status from public.whatsapp_meta_template_mappings order by template_key')).rows;
    assert.deepEqual(maps.filter(row => row.approval_status === 'approved').map(row => row.template_key), ['appointment_confirmation', 'appointment_reminder']);
    assert(maps.filter(row => row.approval_status === 'unconfigured').every(row => row.meta_template_name === null && row.approved_content_hash === null));
    await db.exec("update public.message_templates set content='new' where template_key='customer_return_reminder'");
    assert.equal((await db.query("select approval_status from public.whatsapp_meta_template_mappings where template_key='customer_return_reminder'")).rows[0].approval_status, 'unconfigured');
    await db.exec("update public.message_templates set content='new' where template_key='appointment_confirmation'");
    assert.equal((await db.query("select approval_status from public.whatsapp_meta_template_mappings where template_key='appointment_confirmation'")).rows[0].approval_status, 'pending');
    await db.exec("insert into public.whatsapp_message_logs(template_key) values ('appointment_confirmation'),('appointment_reminder'),('appointment_update'),('appointment_cancelled'),('customer_return_reminder'),('appointment_thank_you')");
    const queued = (await db.query('select template_key,count(*)::integer as count from public.whatsapp_message_logs group by template_key order by template_key')).rows;
    assert.deepEqual(queued, [{ template_key: 'appointment_cancelled', count: 1 }, { template_key: 'appointment_confirmation', count: 1 }, { template_key: 'appointment_reminder', count: 1 }, { template_key: 'appointment_thank_you', count: 1 }]);
    console.log('PASS only confirmation/hourly reminder automated; disabled queue inserts skipped, manual and historic logs retained');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
