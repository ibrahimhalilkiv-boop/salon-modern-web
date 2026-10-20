-- Prepare Meta-approved marketing follow-ups; no automatic sending until explicitly activated.
alter table public.booking_settings
  add column if not exists whatsapp_return_auto_enabled boolean not null default false;

alter table public.whatsapp_message_logs
  drop constraint whatsapp_message_logs_template_key_check;
alter table public.whatsapp_message_logs
  add constraint whatsapp_message_logs_template_key_check check (template_key=any(array[
  'appointment_confirmation','appointment_update','appointment_reminder',
  'appointment_cancelled','appointment_thank_you','customer_return_reminder']));

alter table public.whatsapp_meta_template_mappings
  drop constraint whatsapp_meta_template_mappings_template_key_check;
alter table public.whatsapp_meta_template_mappings
  add constraint whatsapp_meta_template_mappings_template_key_check check (template_key=any(array[
  'appointment_confirmation','appointment_update','appointment_reminder',
  'appointment_cancelled','appointment_thank_you','customer_return_reminder']));

-- This is an advertising / rebooking template, not a utility reminder.
insert into public.message_templates(template_key,title,content)
values (
  'customer_return_reminder','Müşteri geliş hatırlatması',
  E'Merhaba {musteri_adi} 👋\n\nSalon Modern''den selamlar.\n\nDüzenli bakım alışkanlığınıza göre tıraş zamanınız gelmiş olabilir. Yeni bir randevu planlamak isterseniz bu mesaja yanıt verebilirsiniz.\n\nSalon Modern'
)
on conflict(template_key) do update
  set content=excluded.content,updated_at=now();

insert into public.whatsapp_meta_template_mappings(
  template_key,meta_template_name,language_code,placeholder_order,approval_status,approved_content_hash
) values (
  'customer_return_reminder','salon_modern_tiras_hatirlatma_v1','tr',
  '["{musteri_adi}"]'::jsonb,'pending',null
)
on conflict(template_key) do update
  set meta_template_name=excluded.meta_template_name,
      language_code=excluded.language_code,
      placeholder_order=excluded.placeholder_order,
      approval_status='pending',
      approved_content_hash=null,
      approved_at=null,
      updated_at=now();

-- This is called by the dispatcher for every claimed auto return message before sending.
create or replace function public.salon_auto_return_send_is_current(p_log_id uuid)
returns boolean
language sql stable security definer set search_path=pg_catalog
as $$
select exists(
  select 1
  from public.whatsapp_message_logs l
  join public.clients c on c.id=l.client_id
  join public.booking_settings settings on settings.id=true
  join public.whatsapp_meta_template_mappings mapping
    on mapping.template_key='customer_return_reminder'
  where l.id=p_log_id and l.template_key='customer_return_reminder'
    and l.status='sending'
    and l.appointment_id is null
    and settings.whatsapp_return_auto_enabled
    and mapping.approval_status='approved'
    and mapping.approved_content_hash is not null
    and c.whatsapp_marketing_opt_in is true
    and c.whatsapp_marketing_opt_in_at is not null
    and c.whatsapp_marketing_opt_out_at is null
    and c.active is true and c.deleted_at is null
    and l.next_attempt_at <= now()
    and l.scheduled_for >= now()-interval '65 minutes'
    and exists(
      select 1 from private.salon_return_due_rows(
        (now() at time zone 'Europe/Istanbul')::date
      ) due where due.client_id=l.client_id and due.has_consent
        and l.idempotency_key='customer_return_reminder:'||due.phone||':'||due.last_visit::text
    )
)
$$;
revoke all on function public.salon_auto_return_send_is_current(uuid) from public,anon,authenticated;
grant execute on function public.salon_auto_return_send_is_current(uuid) to service_role;

-- Send at most one message per phone and visit cycle, using existing idempotency logs.
create or replace function private.salon_enqueue_auto_returns()
returns jsonb language plpgsql security definer set search_path=pg_catalog
as $$
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
$$;
revoke all on function private.salon_enqueue_auto_returns() from public,anon,authenticated;

-- Keep the existing 09:00 digest until automated delivery is EXPLICITLY enabled.
create or replace function private.salon_enqueue_daily_return_digest()
returns jsonb
language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_day date:=(now() at time zone 'Europe/Istanbul')::date;
 v_owner uuid;
 v_count integer;
 v_notif uuid;
 v_row integer;
begin
 if (select s.whatsapp_return_auto_enabled
     from public.booking_settings s where s.id=true) is true
 then return jsonb_build_object('status','auto_enabled_digest_disabled'); end if;

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
$$;
revoke all on function private.salon_enqueue_daily_return_digest() from public,anon,authenticated;

-- Activation later requires verified Meta approval and a deliberate owner action.
create or replace function public.salon_set_return_auto_enabled(p_enabled boolean)
returns jsonb
language plpgsql security definer set search_path=pg_catalog
as $$
declare v_status text;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id=auth.uid() and p.username='halil.kiv'
      and p.role='manager' and p.active is true
  ) then raise exception 'Sadece hesap sahibi ayarlayabilir.' using errcode='42501'; end if;
  if p_enabled then
    select m.approval_status into v_status
    from public.whatsapp_meta_template_mappings m where m.template_key='customer_return_reminder';
    if not exists (
      select 1 from public.whatsapp_meta_template_mappings m
      where m.template_key='customer_return_reminder'
        and m.approval_status='approved' and m.approved_content_hash is not null
        and m.meta_template_name='salon_modern_tiras_hatirlatma_v1'
    ) then
      raise exception 'Meta pazarlama şablonu henüz onaylanmadı.' using errcode='22023';
    end if;
  end if;
  update public.booking_settings
  set whatsapp_return_auto_enabled=coalesce(p_enabled,false),
      updated_at=now(),updated_by=auth.uid()
  where id=true;
  return jsonb_build_object('enabled',coalesce(p_enabled,false),
                            'digest_enabled',not coalesce(p_enabled,false));
end;
$$;
revoke all on function public.salon_set_return_auto_enabled(boolean) from public,anon;
grant execute on function public.salon_set_return_auto_enabled(boolean) to authenticated;

-- UTC cron: 08:00 -> 11:00 Istanbul; remains inert until explicitly activated.
select cron.schedule('salon-modern-auto-return-marketing',
                     '0 8 * * *',
                     'select private.salon_enqueue_auto_returns()');
