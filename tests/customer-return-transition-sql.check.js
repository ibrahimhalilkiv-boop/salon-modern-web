// In-memory PostgreSQL fixture: no live notifications or customer messages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.argv[2] ? path.resolve(process.argv[2]) : '@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema private; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select '00000000-0000-0000-0000-000000000001'::uuid$$;
      create table public.booking_settings(id boolean primary key,whatsapp_return_auto_enabled boolean not null default false);
      create table public.whatsapp_meta_template_mappings(template_key text primary key,approval_status text,approved_content_hash text);
      create table public.message_templates(template_key text primary key,content text);
      create table public.whatsapp_message_logs(idempotency_key text unique,template_key text,client_id uuid,scheduled_for timestamptz,next_attempt_at timestamptz,metadata jsonb);
      create table public.profiles(id uuid primary key,username text,role text,active boolean);
      create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,kind text,title text,body text);
      create table public.customer_return_contacts(client_id uuid,last_visit date,contacted_by uuid,primary key(client_id,last_visit));
      create table private.salon_return_daily_runs(digest_day date primary key,recipient_id uuid,notification_id uuid,created_at timestamptz default now());
      create function private.salon_return_due_rows(date)
      returns table(client_id uuid,client_name text,phone text,last_visit date,average_days integer,elapsed_days integer,state text,has_consent boolean)
      language sql stable as $$select '00000000-0000-0000-0000-000000000002'::uuid,'Örnek Müşteri'::text,'905000000001'::text,
      current_date-20,14,20,'due'::text,true$$;
      insert into public.booking_settings values(true,false);
      insert into public.profiles values('00000000-0000-0000-0000-000000000001','halil.kiv','manager',true);
      insert into public.message_templates values('customer_return_reminder','Merhaba {musteri_adi}');
      insert into public.whatsapp_meta_template_mappings values('customer_return_reminder','pending',null);
    `);
    const staged = fs.readFileSync('supabase/migrations/20261020235500_guard_return_activation.sql', 'utf8');
    const autoFunction = staged.match(/CREATE OR REPLACE FUNCTION private\.salon_enqueue_auto_returns\(\)[\s\S]*?\$function\$\s*;/i)?.[0];
    assert(autoFunction, 'Current automatic enqueue function found');
    await db.exec(autoFunction);
    const digest = fs.readFileSync('supabase/migrations/20261020235600_close_manual_return_digest_on_auto_mode.sql', 'utf8');
    await db.exec(digest);
    const call = async name => (await db.query(`select private.${name}() as result`)).rows[0].result;

    assert.equal((await call('salon_enqueue_auto_returns')).status, 'disabled_or_unapproved');
    assert.equal((await call('salon_enqueue_daily_return_digest')).status, 'created');
    assert.equal((await call('salon_enqueue_daily_return_digest')).status, 'already_created');
    assert.equal((await db.query("select count(*)::integer as count from public.notifications where kind='customer_return_due'")).rows[0].count, 1);
    const mark = async () => (await db.query("select public.salon_mark_return_contact('00000000-0000-0000-0000-000000000002',current_date-20) as marked")).rows[0].marked;
    assert.equal(await mark(), true, 'Owner can record an actual manual contact');
    assert.equal(await mark(), false, 'Repeated manual contact cannot duplicate the record');

    await db.exec('update public.booking_settings set whatsapp_return_auto_enabled=true');
    await assert.rejects(mark, /Otomatik geri çağırma açıkken manuel kayıt kapalı/, 'Old clients cannot record manual contacts after handover');
    assert.equal((await call('salon_enqueue_auto_returns')).status, 'disabled_or_unapproved', 'Pending Meta approval blocks automatic messages');
    assert.equal((await call('salon_enqueue_daily_return_digest')).status, 'auto_enabled_digest_disabled', 'Manual digest stays off during transition');
    await db.exec("update public.whatsapp_meta_template_mappings set approval_status='approved',approved_content_hash='wrong-hash'");
    assert.equal((await call('salon_enqueue_auto_returns')).status, 'disabled_or_unapproved', 'Wrong approved text hash blocks automatic messages');
    assert.equal((await db.query('select count(*)::integer as count from public.whatsapp_message_logs')).rows[0].count, 0);
    console.log('PASS return digest idempotency, manual handover, Meta approval and content hash gates');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
