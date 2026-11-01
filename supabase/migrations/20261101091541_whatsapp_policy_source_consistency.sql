-- Preserve the live PR #2 policy across migrations and future deployments.
-- Existing message logs remain untouched.
CREATE OR REPLACE FUNCTION private.enqueue_appointment_whatsapp_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  if tg_op = 'INSERT'
     and coalesce(new.status, '') <> 'cancelled'
     and new.scheduled_at > now()
  then
    perform private.enqueue_whatsapp_message(
      'appointment_confirmation:' || new.id::text,
      'appointment_confirmation',
      new.id,
      new.client_id
    );
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION private.enqueue_whatsapp_message(p_key text, p_template_key text, p_appointment_id uuid, p_client_id uuid, p_scheduled_for timestamp with time zone DEFAULT now())
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  if p_template_key in ('appointment_cancelled','appointment_update') then
    return;
  end if;
  insert into public.whatsapp_message_logs (
    idempotency_key, template_key, appointment_id,
    client_id, scheduled_for, next_attempt_at
  )
  values (
    p_key, p_template_key, p_appointment_id,
    p_client_id, p_scheduled_for, greatest(now(), p_scheduled_for)
  )
  on conflict (idempotency_key) do nothing;
end
$function$;

DO $trigger$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.appointments'::regclass
      AND tgname = 'appointments_enqueue_meta_message'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER appointments_enqueue_meta_message
      AFTER INSERT OR UPDATE OF scheduled_at, employee_id, status ON public.appointments
      FOR EACH ROW EXECUTE FUNCTION private.enqueue_appointment_whatsapp_message();
  END IF;
END
$trigger$;
