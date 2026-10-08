-- Keep cancellation notices out of Meta until the business phone is ready.
-- Historical failures and every other WhatsApp template remain unchanged.
alter table public.whatsapp_message_logs
  drop constraint whatsapp_message_logs_status_check,
  add constraint whatsapp_message_logs_status_check check (status = any (array[
    'queued','sending','sent','delivered','read','failed','delivery_unknown',
    'awaiting_meta_approval','suppressed_safe_mode','skipped_template_missing',
    'skipped_template_invalid','skipped_no_phone','skipped_event_invalid','manual_pending'
  ]));

create or replace function private.enqueue_appointment_whatsapp_message()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $$
begin
  if tg_op='INSERT' and coalesce(new.status,'')<>'cancelled' then
    perform private.enqueue_whatsapp_message('appointment_confirmation:'||new.id::text,'appointment_confirmation',new.id,new.client_id);
  elsif tg_op='UPDATE' and old.status is distinct from new.status and new.status='cancelled' then
    if new.cancellation_source in ('admin','staff') then
      insert into public.whatsapp_message_logs(
        idempotency_key,template_key,appointment_id,client_id,scheduled_for,next_attempt_at,status,metadata
      ) values (
        'appointment_cancelled:'||new.id::text,'appointment_cancelled',new.id,new.client_id,
        now(),now(),'manual_pending',jsonb_build_object('channel','manual_wa_me')
      ) on conflict(idempotency_key) do nothing;
    end if;
  elsif tg_op='UPDATE' and coalesce(new.status,'')<>'cancelled' and
    (new.scheduled_at,new.employee_id) is distinct from (old.scheduled_at,old.employee_id) then
    perform private.enqueue_whatsapp_message('appointment_update:'||new.id::text||':'||txid_current()::text,'appointment_update',new.id,new.client_id);
  end if;
  return new;
end $$;
revoke all on function private.enqueue_appointment_whatsapp_message() from public,anon,authenticated;

create or replace function public.get_manual_cancel_whatsapp(p_appointment_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,private as $$
declare
  v_appointment public.appointments%rowtype;
  v_client public.clients%rowtype;
  v_status text;
  v_phone text;
  v_staff text;
begin
  if auth.uid() is null or not private.is_active_salon_user() then
    raise exception 'Oturum gerekli.' using errcode='42501';
  end if;
  select * into v_appointment from public.appointments where id=p_appointment_id;
  if not found or v_appointment.status<>'cancelled' or
    v_appointment.cancellation_source not in ('admin','staff') or
    (not private.is_manager() and v_appointment.employee_id is distinct from auth.uid()) then
    raise exception 'İptal bildirimi erişilebilir değil.' using errcode='42501';
  end if;
  select status into v_status from public.whatsapp_message_logs
  where idempotency_key='appointment_cancelled:'||v_appointment.id::text;
  if v_status is distinct from 'manual_pending' then
    return jsonb_build_object('status',case when v_status in ('sent','delivered','read') then 'already_sent' else 'unavailable' end);
  end if;
  select * into v_client from public.clients where id=v_appointment.client_id;
  if not found or v_client.whatsapp_marketing_opt_out_at is not null then
    return jsonb_build_object('status','contact_declined');
  end if;
  v_phone:=coalesce(private.normalize_tr_phone(v_appointment.client_phone),private.normalize_tr_phone(v_client.phone));
  if v_phone is null then return jsonb_build_object('status','invalid_phone'); end if;
  select full_name into v_staff from public.profiles where id=v_appointment.employee_id;
  return jsonb_build_object(
    'status','ready','appointment_id',v_appointment.id,'client_name',v_appointment.client_name,
    'phone',v_phone,'scheduled_at',v_appointment.scheduled_at,
    'staff_name',coalesce(nullif(v_staff,''),'Salon Modern')
  );
end $$;
revoke all on function public.get_manual_cancel_whatsapp(uuid) from public,anon;
grant execute on function public.get_manual_cancel_whatsapp(uuid) to authenticated;

create or replace function public.mark_manual_cancel_whatsapp_sent(p_appointment_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
  v_appointment public.appointments%rowtype;
  v_log public.whatsapp_message_logs%rowtype;
begin
  if auth.uid() is null or not private.is_active_salon_user() then
    raise exception 'Oturum gerekli.' using errcode='42501';
  end if;
  select * into v_appointment from public.appointments where id=p_appointment_id;
  if not found or v_appointment.status<>'cancelled' or
    v_appointment.cancellation_source not in ('admin','staff') or
    (not private.is_manager() and v_appointment.employee_id is distinct from auth.uid()) then
    raise exception 'İptal bildirimi erişilebilir değil.' using errcode='42501';
  end if;
  select * into v_log from public.whatsapp_message_logs
  where idempotency_key='appointment_cancelled:'||v_appointment.id::text for update;
  if not found then raise exception 'Manuel iptal bildirimi bulunamadı.'; end if;
  if v_log.status='sent' and v_log.metadata->>'channel'='manual_wa_me' then
    return jsonb_build_object('status','already_recorded','replayed',true);
  end if;
  if v_log.status<>'manual_pending' then raise exception 'İptal bildirimi manuel gönderime uygun değil.'; end if;
  update public.whatsapp_message_logs set status='sent',sent_at=now(),status_at=now(),
    updated_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||
      jsonb_build_object('channel','manual_wa_me','confirmed_by',auth.uid())
  where id=v_log.id;
  return jsonb_build_object('status','sent','manual',true);
end $$;
revoke all on function public.mark_manual_cancel_whatsapp_sent(uuid) from public,anon;
grant execute on function public.mark_manual_cancel_whatsapp_sent(uuid) to authenticated;
