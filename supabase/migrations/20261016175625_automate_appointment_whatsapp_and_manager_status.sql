-- Future business cancellations use the existing idempotent YCloud queue.
-- Existing manual_pending and historical failed rows are deliberately untouched.
create or replace function private.enqueue_appointment_whatsapp_message()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $$
begin
  if tg_op='INSERT' and coalesce(new.status,'')<>'cancelled' then
    perform private.enqueue_whatsapp_message('appointment_confirmation:'||new.id::text,'appointment_confirmation',new.id,new.client_id);
  elsif tg_op='UPDATE' and old.status is distinct from new.status and new.status='cancelled' then
    if new.cancellation_source in ('admin','staff') then
      perform private.enqueue_whatsapp_message('appointment_cancelled:'||new.id::text,'appointment_cancelled',new.id,new.client_id);
    end if;
  elsif tg_op='UPDATE' and coalesce(new.status,'')<>'cancelled' and
    (new.scheduled_at,new.employee_id) is distinct from (old.scheduled_at,old.employee_id) then
    perform private.enqueue_whatsapp_message('appointment_update:'||new.id::text||':'||txid_current()::text,'appointment_update',new.id,new.client_id);
  end if;
  return new;
end $$;
revoke all on function private.enqueue_appointment_whatsapp_message() from public,anon,authenticated;

-- Message logs stay private; only a manager may read a minimal status summary.
create or replace function public.appointment_whatsapp_status(p_appointment_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,private as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not private.is_active_salon_user() or not private.is_manager() then
    raise exception 'Yönetici yetkisi gerekli.' using errcode='42501';
  end if;
  if not exists(select 1 from public.appointments where id=p_appointment_id) then
    raise exception 'Randevu bulunamadı.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',l.id,'template_key',l.template_key,
    'status',case when l.status='failed' and l.metadata->>'manual_handled'='true' then 'manual_handled'
                  when l.status='failed' and l.metadata->>'channel'='manual_fallback' then 'manual_pending'
                  else l.status end,
    'can_manual',l.status='failed' and l.metadata->>'provider'='ycloud'
      and l.metadata->>'manual_handled' is distinct from 'true'
      and ((l.template_key='appointment_cancelled' and a.status='cancelled') or
           (l.template_key<>'appointment_cancelled' and a.status<>'cancelled' and a.scheduled_at>now()))
      and not exists(select 1 from public.whatsapp_message_logs x
        where x.appointment_id=l.appointment_id and x.template_key=l.template_key
          and x.id<>l.id and x.status in ('queued','sending','delivery_unknown')),
    'can_mark',l.status='failed' and l.metadata->>'channel'='manual_fallback'
      and l.metadata->>'manual_handled' is distinct from 'true',
    'can_legacy_manual',l.status='manual_pending' and l.metadata->>'channel'='manual_wa_me'
  ) order by l.created_at desc),'[]'::jsonb) into v_result
  from (select distinct on (template_key) id,appointment_id,template_key,status,metadata,created_at
        from public.whatsapp_message_logs
        where appointment_id=p_appointment_id
          and template_key in ('appointment_confirmation','appointment_update','appointment_reminder','appointment_cancelled')
        order by template_key,created_at desc,id desc) l
  join public.appointments a on a.id=l.appointment_id;
  return v_result;
end $$;
revoke all on function public.appointment_whatsapp_status(uuid) from public,anon;
grant execute on function public.appointment_whatsapp_status(uuid) to authenticated;

-- Reserve a terminal YCloud failure before opening a manual draft. Keep the
-- failed state so a late webhook cannot upgrade it after a manual handoff.
create or replace function public.prepare_manual_appointment_whatsapp(p_log_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
  v_appointment public.appointments%rowtype;
  v_log public.whatsapp_message_logs%rowtype;
  v_phone text;
  v_staff text;
  v_client public.clients%rowtype;
begin
  if auth.uid() is null or not private.is_active_salon_user() or not private.is_manager() then
    raise exception 'Yönetici yetkisi gerekli.' using errcode='42501';
  end if;
  select a.* into v_appointment from public.appointments a
    join public.whatsapp_message_logs l on l.appointment_id=a.id
    where l.id=p_log_id for update of a;
  if not found then raise exception 'Randevu bulunamadı.' using errcode='42501'; end if;
  select * into v_log from public.whatsapp_message_logs where id=p_log_id for update;
  if v_log.status<>'failed' or v_log.metadata->>'provider' is distinct from 'ycloud' or
     v_log.metadata->>'manual_handled'='true' or
     v_log.template_key not in ('appointment_confirmation','appointment_update','appointment_reminder','appointment_cancelled') then
    raise exception 'Manuel gönderim için kesin başarısızlık yok.' using errcode='42501';
  end if;
  if exists(select 1 from public.whatsapp_message_logs x
    where x.appointment_id=v_log.appointment_id and x.template_key=v_log.template_key and x.id<>v_log.id
      and (x.created_at>v_log.created_at or x.status in ('queued','sending','delivery_unknown'))) then
    raise exception 'Yeni veya sonucu belirsiz gönderim var.' using errcode='42501';
  end if;
  if (v_log.template_key='appointment_cancelled') is distinct from (v_appointment.status='cancelled') then
    raise exception 'Randevu durumu değişti.' using errcode='42501';
  end if;
  if v_log.template_key<>'appointment_cancelled' and v_appointment.scheduled_at<=now() then
    raise exception 'Randevu zamanı geçti.' using errcode='42501';
  end if;
  select * into v_client from public.clients where id=v_appointment.client_id;
  if v_client.whatsapp_marketing_opt_out_at is not null then
    raise exception 'Müşteri WhatsApp iletişimini reddetmiş.' using errcode='42501';
  end if;
  v_phone:=coalesce(private.normalize_tr_phone(v_appointment.client_phone),private.normalize_tr_phone(v_client.phone));
  if v_phone is null then raise exception 'Geçerli müşteri telefonu yok.' using errcode='42501'; end if;
  select full_name into v_staff from public.profiles where id=v_appointment.employee_id;
  update public.whatsapp_message_logs set updated_at=now(),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('channel','manual_fallback','reserved_by',auth.uid())
    where id=v_log.id;
  return jsonb_build_object('id',v_log.id,'template_key',v_log.template_key,'phone',v_phone,
    'client_name',v_appointment.client_name,'scheduled_at',v_appointment.scheduled_at,
    'staff_name',coalesce(nullif(v_staff,''),'Salon Modern'),
    'service_name',v_appointment.service_name,'amount',v_appointment.amount);
end $$;
revoke all on function public.prepare_manual_appointment_whatsapp(uuid) from public,anon;
grant execute on function public.prepare_manual_appointment_whatsapp(uuid) to authenticated;

create or replace function public.mark_manual_appointment_whatsapp_handled(p_log_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare v_log public.whatsapp_message_logs%rowtype;
begin
  if auth.uid() is null or not private.is_active_salon_user() or not private.is_manager() then
    raise exception 'Yönetici yetkisi gerekli.' using errcode='42501';
  end if;
  select * into v_log from public.whatsapp_message_logs where id=p_log_id for update;
  if not found or v_log.status<>'failed' or v_log.metadata->>'channel'<>'manual_fallback' or
     v_log.metadata->>'manual_handled'='true' then
    raise exception 'Manuel gönderim bekleyen kayıt bulunamadı.' using errcode='42501';
  end if;
  update public.whatsapp_message_logs set updated_at=now(),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('manual_handled',true,'confirmed_by',auth.uid())
    where id=v_log.id;
  return jsonb_build_object('status','manual_handled');
end $$;
revoke all on function public.mark_manual_appointment_whatsapp_handled(uuid) from public,anon;
grant execute on function public.mark_manual_appointment_whatsapp_handled(uuid) to authenticated;
