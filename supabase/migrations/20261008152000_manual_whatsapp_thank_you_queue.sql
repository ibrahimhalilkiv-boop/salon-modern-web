-- Temporary, user-initiated wa.me thank-you queue. The same idempotency key as
-- the Meta automation prevents manual and future automatic double delivery.

create or replace function public.list_manual_whatsapp_thank_yous()
returns table(
  appointment_id uuid,
  client_id uuid,
  client_name text,
  client_phone text,
  scheduled_at timestamptz,
  completed_at timestamptz,
  eligible_at timestamptz
) language sql stable security definer
set search_path=pg_catalog,public,private as $$
  select a.id,a.client_id,c.full_name,c.phone,a.scheduled_at,a.completed_at,
    a.completed_at+make_interval(mins=>s.whatsapp_thank_you_delay_minutes)
  from public.appointments a
  join public.clients c on c.id=a.client_id
  join public.booking_settings s on s.id=true
  where auth.uid() is not null
    and private.is_active_salon_user()
    and (private.is_manager() or a.employee_id=auth.uid())
    and a.status='completed' and a.completed_at is not null
    and a.completed_at+make_interval(mins=>s.whatsapp_thank_you_delay_minutes)<=now()
    and c.whatsapp_marketing_opt_in and c.whatsapp_marketing_opt_in_at is not null
    and c.whatsapp_marketing_opt_out_at is null
    and nullif(private.normalize_tr_phone(c.phone),'') is not null
    and not exists (
      select 1 from public.whatsapp_message_logs l
      where l.idempotency_key='appointment_thank_you:'||a.id::text
    )
  order by a.completed_at;
$$;

revoke all on function public.list_manual_whatsapp_thank_yous() from public,anon;
grant execute on function public.list_manual_whatsapp_thank_yous() to authenticated;

create or replace function public.mark_manual_whatsapp_thank_you_sent(p_appointment_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
  v_appointment public.appointments%rowtype;
  v_client public.clients%rowtype;
  v_delay integer:=120;
  v_key text:='appointment_thank_you:'||p_appointment_id::text;
  v_log_id uuid;
begin
  if auth.uid() is null or not private.is_active_salon_user() then
    raise exception 'Oturum gerekli.' using errcode='42501';
  end if;
  select * into v_appointment from public.appointments where id=p_appointment_id for update;
  if not found then raise exception 'Randevu bulunamadı.'; end if;
  if not private.is_manager() and v_appointment.employee_id is distinct from auth.uid() then
    raise exception 'Bu kayıt için yetkiniz yok.' using errcode='42501';
  end if;
  if v_appointment.status<>'completed' or v_appointment.completed_at is null then
    raise exception 'Yalnız tamamlanmış randevu kapatılabilir.';
  end if;
  select * into v_client from public.clients where id=v_appointment.client_id;
  if not found or not v_client.whatsapp_marketing_opt_in
     or v_client.whatsapp_marketing_opt_in_at is null
     or v_client.whatsapp_marketing_opt_out_at is not null then
    raise exception 'Müşterinin geçerli pazarlama iletişim izni yok.';
  end if;
  select coalesce(whatsapp_thank_you_delay_minutes,120) into v_delay
  from public.booking_settings where id=true;
  if v_appointment.completed_at+make_interval(mins=>v_delay)>now() then
    raise exception 'Teşekkür mesajı için bekleme süresi henüz dolmadı.';
  end if;
  select id into v_log_id from public.whatsapp_message_logs where idempotency_key=v_key;
  if found then
    return jsonb_build_object('appointment_id',v_appointment.id,'status','already_recorded','replayed',true);
  end if;
  insert into public.whatsapp_message_logs(
    idempotency_key,template_key,appointment_id,client_id,scheduled_for,next_attempt_at,
    status,attempt_count,sent_at,status_at,metadata,last_error
  ) values (
    v_key,'appointment_thank_you',v_appointment.id,v_appointment.client_id,
    v_appointment.completed_at+make_interval(mins=>v_delay),now(),
    'sent',0,now(),now(),jsonb_build_object('channel','manual_wa_me','confirmed_by',auth.uid()),null
  ) returning id into v_log_id;
  return jsonb_build_object('appointment_id',v_appointment.id,'message_log_id',v_log_id,'status','sent','manual',true);
end $$;

revoke all on function public.mark_manual_whatsapp_thank_you_sent(uuid) from public,anon;
grant execute on function public.mark_manual_whatsapp_thank_you_sent(uuid) to authenticated;
