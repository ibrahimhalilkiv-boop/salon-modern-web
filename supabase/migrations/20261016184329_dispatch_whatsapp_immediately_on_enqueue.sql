-- Salon Modern: nudge the existing secured YCloud dispatcher as soon as
-- new, currently-due appointment messages commit to the queue.
-- The original one-minute cron remains enabled as a durable fallback.
-- AFTER INSERT ... FOR EACH STATEMENT emits at most one HTTP request per
-- insert statement, including batch reminder enqueues.
create or replace function private.dispatch_whatsapp_on_queue_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_secret text;
begin
  -- A failed or future-due row never triggers an immediate dispatch.
  if not exists (
    select 1 from new_whatsapp_rows r
    where r.status = 'queued'
      and r.next_attempt_at <= now()
      and r.template_key in (
        'appointment_confirmation',
        'appointment_update',
        'appointment_cancelled',
        'appointment_reminder'
      )
  ) then
    return null;
  end if;

  -- Reuse the EXACT same Vault credential and Edge endpoint as the
  -- existing cron; never expose this secret to the application or logs.
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'whatsapp_dispatch_secret';

  if nullif(v_secret, '') is null then
    -- Do not block appointment writes if the dispatcher is unavailable.
    -- The existing cron remains the fallback.
    return null;
  end if;

  perform net.http_post(
    url := 'https://oxuwwjsakhcqimjsfris.supabase.co/functions/v1/whatsapp-outbound-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-salon-dispatch-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
  return null;
exception when others then
  -- Preserve successful appointment transactions; next cron run retries.
  -- Only the SQLSTATE is logged, never the Vault secret or customer data.
  raise warning 'WhatsApp immediate dispatch deferred to cron (SQLSTATE: %)', SQLSTATE;
  return null;
end;
$function$;

revoke all on function private.dispatch_whatsapp_on_queue_insert()
  from public, anon, authenticated;

drop trigger if exists whatsapp_message_logs_immediate_dispatch
  on public.whatsapp_message_logs;

create trigger whatsapp_message_logs_immediate_dispatch
after insert on public.whatsapp_message_logs
referencing new table as new_whatsapp_rows
for each statement
execute function private.dispatch_whatsapp_on_queue_insert();
