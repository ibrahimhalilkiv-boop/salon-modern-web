-- Only appointment confirmation and the 60-minute reminder may be automated.
-- Keep historical message logs for audit and manual thank-you records intact.
update public.booking_settings
set whatsapp_return_auto_enabled=false, appointment_reminder_minutes=60, updated_at=now()
where id=true and (whatsapp_return_auto_enabled is distinct from false
                   or appointment_reminder_minutes is distinct from 60);

alter table public.booking_settings
  add constraint booking_settings_only_confirmation_and_hourly_reminder
  check (whatsapp_return_auto_enabled is false and appointment_reminder_minutes=60);

-- Clear obsolete provider mappings. Manual message bodies remain available.
update public.whatsapp_meta_template_mappings
set meta_template_name=null, placeholder_order='[]'::jsonb,
    approved_content_hash=null, approval_status='unconfigured',
    approved_at=null, updated_at=now()
where template_key in ('appointment_update','appointment_cancelled',
                       'appointment_thank_you','customer_return_reminder');

-- Template edits for manual-only messages must not create pending Meta work.
create or replace function private.mark_meta_template_pending()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $$
begin
  if tg_op='UPDATE' then
    if new.content is not distinct from old.content then return new; end if;
  end if;
  if new.template_key in ('appointment_confirmation','appointment_reminder') then
    update public.whatsapp_meta_template_mappings
    set approval_status=case when approval_status='approved' then 'pending' else approval_status end,
        updated_at=now()
    where template_key=new.template_key;
  end if;
  return new;
end $$;
revoke all on function private.mark_meta_template_pending() from public,anon,authenticated;

-- Guard the log table as well as the existing enqueue functions, including
-- direct service-role inserts. Existing update/cancel audit rows are untouched.
create or replace function private.skip_disabled_whatsapp_queue_insert()
returns trigger language plpgsql security definer
set search_path=pg_catalog as $$
begin
  if new.template_key in ('appointment_update','appointment_cancelled','customer_return_reminder') then
    return null;
  end if;
  return new;
end $$;
revoke all on function private.skip_disabled_whatsapp_queue_insert() from public,anon,authenticated;

drop trigger if exists whatsapp_logs_skip_disabled_queue_insert on public.whatsapp_message_logs;
create trigger whatsapp_logs_skip_disabled_queue_insert
before insert on public.whatsapp_message_logs
for each row execute function private.skip_disabled_whatsapp_queue_insert();
