CREATE OR REPLACE FUNCTION private.salon_enqueue_auto_returns()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_count integer:=0;
  v_day date:=(now() at time zone 'Europe/Istanbul')::date;
begin
  if not exists (
    select 1
    from public.booking_settings s
    join public.whatsapp_meta_template_mappings m
      on m.template_key='customer_return_reminder'
    where s.id=true and s.whatsapp_return_auto_enabled
      and m.approval_status='approved'
      and m.approved_content_hash is not null
      and m.approved_content_hash=encode(sha256(convert_to((
        select t.content from public.message_templates t where t.template_key='customer_return_reminder'
      ),'UTF8')),'hex')
  ) then return jsonb_build_object('status','disabled_or_unapproved','queued',0); end if;

  -- Scheduled daily for 11:00 Istanbul, not as a 24/7 loop.
  if (now() at time zone 'Europe/Istanbul')::time < time '11:00'
     or (now() at time zone 'Europe/Istanbul')::time > time '11:20'
  then return jsonb_build_object('status','out_of_window','queued',0); end if;

  insert into public.whatsapp_message_logs(
    idempotency_key,template_key,client_id,scheduled_for,next_attempt_at,metadata
  )
  select 'customer_return_reminder:'||d.phone||':'||d.last_visit::text,
    'customer_return_reminder',d.client_id,now(),now(),
    jsonb_build_object('channel','meta','category','MARKETING','last_visit',d.last_visit,'phone',d.phone)
  from private.salon_return_due_rows(v_day) d
  where d.has_consent
    and not exists (
      select 1 from public.whatsapp_message_logs l
      where l.template_key='customer_return_reminder'
        and l.idempotency_key='customer_return_reminder:'||d.phone||':'||d.last_visit::text
    )
  on conflict(idempotency_key) do nothing;
  get diagnostics v_count=row_count;
  return jsonb_build_object('status','prepared','queued',v_count);
end;
$function$
;

CREATE OR REPLACE FUNCTION private.salon_enqueue_daily_return_digest()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 v_day date:=(now() at time zone 'Europe/Istanbul')::date;
 v_owner uuid;
 v_count integer;
 v_notif uuid;
 v_row integer;
begin
 if exists(
   select 1 from public.booking_settings s
   join public.whatsapp_meta_template_mappings m on m.template_key='customer_return_reminder'
   join public.message_templates t on t.template_key='customer_return_reminder'
   where s.id=true and s.whatsapp_return_auto_enabled
     and m.approval_status='approved'
     and m.approved_content_hash=encode(sha256(convert_to(t.content,'UTF8')),'hex')
 ) then return jsonb_build_object('status','auto_enabled_digest_disabled'); end if;

 select p.id into v_owner from public.profiles p
 where p.username='halil.kiv' and p.role='manager' and p.active=true
 limit 1;
 if v_owner is null then return jsonb_build_object('status','no_owner'); end if;
 insert into private.salon_return_daily_runs(digest_day,recipient_id)
 values (v_day,v_owner)
 on conflict (digest_day) do nothing;
 get diagnostics v_row=row_count;
 if v_row=0 then return jsonb_build_object('status','already_created','day',v_day); end if;
 select count(*) into v_count from private.salon_return_due_rows(v_day);
 insert into public.notifications(recipient_id,kind,title,body)
 values (
   v_owner,'customer_return_due','Tıraş süresi dolan müşteriler',
   case when v_count=0
        then 'Bugün tıraş zamanı gelen müşteri bulunmuyor. Listeyi görmek için dokunun.'
        else v_count::text||' müşterinin tıraş zamanı geldi. Listeyi açıp WhatsApp mesajlarını tek tek hazırlayabilirsiniz.'
   end
 ) returning id into v_notif;
 update private.salon_return_daily_runs set notification_id=v_notif where digest_day=v_day;
 return jsonb_build_object('status','created','day',v_day,'count',v_count,'notification_id',v_notif);
end;
$function$
;


-- Prevent the existing general settings UPDATE permission from bypassing owner activation.
create or replace function private.salon_return_activation_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if new.whatsapp_return_auto_enabled is true and old.whatsapp_return_auto_enabled is distinct from true then
    if not exists (
      select 1 from public.profiles p
      where p.id=auth.uid() and p.username='halil.kiv'
        and p.role='manager' and p.active
    ) then raise exception 'Otomatik pazarlama yalnızca hesap sahibi tarafından açılabilir.' using errcode='42501'; end if;
    if not exists (
      select 1 from public.whatsapp_meta_template_mappings m
      join public.message_templates t on t.template_key=m.template_key
      where m.template_key='customer_return_reminder'
        and m.meta_template_name='salon_modern_tiras_hatirlatma_v1'
        and m.approval_status='approved'
        and m.approved_content_hash=encode(sha256(convert_to(t.content,'UTF8')),'hex')
    ) then raise exception 'Onaylı ve içerikle eşleşen Meta şablonu gerekli.' using errcode='22023'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists salon_return_activation_guard on public.booking_settings;
create trigger salon_return_activation_guard
before update of whatsapp_return_auto_enabled on public.booking_settings
for each row execute function private.salon_return_activation_guard();
revoke all on function private.salon_return_activation_guard() from public,anon,authenticated;
