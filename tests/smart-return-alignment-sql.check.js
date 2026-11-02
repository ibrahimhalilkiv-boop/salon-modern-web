// Isolated PGlite fixture. It never creates a live customer or sends WhatsApp.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.argv[2] ? path.resolve(process.argv[2]) : '@electric-sql/pglite');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date());
const dayAgo = n => new Date(Date.parse(today + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10);

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema private;
      create table public.clients(id uuid primary key,full_name text,phone text,active boolean default true,
        deleted_at timestamptz,whatsapp_marketing_opt_in boolean,whatsapp_marketing_opt_in_at timestamptz,
        whatsapp_marketing_opt_out_at timestamptz);
      create table public.appointments(id uuid primary key default gen_random_uuid(),client_id uuid,status text,scheduled_at timestamptz);
      create table public.customer_return_contacts(client_id uuid,contacted_at timestamptz);
      create table public.booking_settings(id boolean primary key,whatsapp_return_auto_enabled boolean,updated_at timestamptz);
      create table public.message_templates(template_key text primary key,content text,updated_at timestamptz);
      create table public.whatsapp_meta_template_mappings(template_key text primary key,approval_status text,
        approved_content_hash text,approved_at timestamptz,updated_at timestamptz);
      create function private.normalize_tr_phone(text) returns text language sql immutable as $$select $1$$;
      create function private.mark_meta_template_pending() returns trigger language plpgsql as $$begin return new; end$$;
      create trigger message_templates_mark_meta_pending after insert or update on public.message_templates
        for each row execute function private.mark_meta_template_pending();
      insert into public.booking_settings(id,whatsapp_return_auto_enabled) values(true,true);
      insert into public.message_templates(template_key,content) values('customer_return_reminder','Old text');
      insert into public.whatsapp_meta_template_mappings(template_key,approval_status,approved_content_hash)
        values('customer_return_reminder','approved','old-hash');
    `);
    await db.query('insert into public.clients(id,full_name,phone) values($1,\'Completed customer\',\'905000000001\'),($2,\'Unfinished customer\',\'905000000002\')', [id(1), id(2)]);
    for (const n of [42, 28, 14]) {
      await db.query('insert into public.appointments(client_id,status,scheduled_at) values($1,\'completed\',$2)', [id(1), dayAgo(n) + 'T12:00:00+03:00']);
    }
    for (const n of [42, 28]) {
      await db.query('insert into public.appointments(client_id,status,scheduled_at) values($1,\'completed\',$2)', [id(2), dayAgo(n) + 'T12:00:00+03:00']);
    }
    await db.query('insert into public.appointments(client_id,status,scheduled_at) values($1,\'confirmed\',$2)', [id(2), dayAgo(14) + 'T12:00:00+03:00']);
    await db.exec(fs.readFileSync('supabase/migrations/20261102084424_align_smart_return_visits_and_message.sql', 'utf8'));
    const due = await db.query('select client_id from private.salon_return_due_rows($1::date)', [today]);
    assert.deepEqual(due.rows.map(row => row.client_id), [id(1)], 'Only completed visits count toward the due list');
    const state = (await db.query(`select s.whatsapp_return_auto_enabled,t.content,m.approval_status,m.approved_content_hash
      from public.booking_settings s cross join public.message_templates t cross join public.whatsapp_meta_template_mappings m`)).rows[0];
    assert.equal(state.whatsapp_return_auto_enabled, false, 'Changing text keeps automatic sending off');
    assert.equal(state.approval_status, 'pending');
    assert.equal(state.approved_content_hash, null);
    assert.match(state.content, /https:\/\/app\.salonmodern\.com\.tr\/randevu\//);
    assert.match(state.content, /Düzenli bakım alışkanlığınıza göre tıraş zamanınız gelmiştir/);
    await db.exec(`update public.booking_settings set whatsapp_return_auto_enabled=true;
      update public.whatsapp_meta_template_mappings set approval_status='approved',approved_content_hash='approved-hash';
      update public.message_templates set content=content||' Güncellendi.' where template_key='customer_return_reminder';`);
    const edited = (await db.query(`select s.whatsapp_return_auto_enabled,m.approval_status,m.approved_content_hash
      from public.booking_settings s cross join public.whatsapp_meta_template_mappings m`)).rows[0];
    assert.equal(edited.whatsapp_return_auto_enabled, false, 'Later text edit also turns automation off');
    assert.equal(edited.approval_status, 'pending');
    assert.equal(edited.approved_content_hash, null);
    await db.query('insert into public.appointments(client_id,status,scheduled_at) values($1,\'confirmed\',$2)', [id(1), new Date(Date.now() + 7 * 86400000).toISOString()]);
    assert.equal((await db.query('select count(*)::int as n from private.salon_return_due_rows($1::date)', [today])).rows[0].n, 0,
      'A future confirmed booking suppresses follow-up');
    console.log('PASS completed-only return list, future booking suppression, new link, Meta reapproval and auto-off');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
