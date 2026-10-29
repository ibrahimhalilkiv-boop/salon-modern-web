-- Thank-you drafts are manager initiated and available only on completion day.
update public.booking_settings
set whatsapp_thank_you_enabled = false
where id = true and whatsapp_thank_you_enabled is distinct from false;

alter table public.booking_settings
  add constraint booking_settings_no_automatic_thank_you
  check (whatsapp_thank_you_enabled = false);

-- Preserve sent and manual audit rows; stop only provider work that has not sent.
update public.whatsapp_message_logs
set status = 'skipped_event_invalid', last_error = 'automatic_thank_you_disabled',
    status_at = now(), updated_at = now()
where template_key = 'appointment_thank_you'
  and status in ('queued', 'failed', 'awaiting_meta_approval');

create or replace function public.whatsapp_enqueue_due_thank_yous()
returns jsonb language sql security invoker
set search_path = pg_catalog, public as $$
  select jsonb_build_object('appointment_thank_yous_enqueued', 0);
$$;
revoke all on function public.whatsapp_enqueue_due_thank_yous() from public, anon, authenticated;
grant execute on function public.whatsapp_enqueue_due_thank_yous() to service_role;

create or replace function public.list_manual_whatsapp_thank_yous()
returns table(appointment_id uuid, client_id uuid, client_name text, client_phone text,
 scheduled_at timestamptz, completed_at timestamptz, eligible_at timestamptz)
language sql stable security definer
set search_path = pg_catalog, public, private as $$
 select a.id, a.client_id, c.full_name, c.phone, a.scheduled_at, a.completed_at, a.completed_at
 from public.appointments a join public.clients c on c.id = a.client_id
 where auth.uid() is not null and private.is_active_salon_user() and private.is_manager()
   and a.status = 'completed' and a.completed_at is not null
   and a.completed_at >= ((now() at time zone 'Europe/Istanbul')::date at time zone 'Europe/Istanbul')
   and a.completed_at < (((now() at time zone 'Europe/Istanbul')::date + 1) at time zone 'Europe/Istanbul')
   and c.whatsapp_marketing_opt_out_at is null
   and private.normalize_tr_phone(c.phone) is not null
   and not exists(select 1 from public.whatsapp_message_logs l
     where l.idempotency_key = 'appointment_thank_you:' || a.id::text)
 order by a.completed_at;
$$;
revoke all on function public.list_manual_whatsapp_thank_yous() from public, anon;
grant execute on function public.list_manual_whatsapp_thank_yous() to authenticated;
