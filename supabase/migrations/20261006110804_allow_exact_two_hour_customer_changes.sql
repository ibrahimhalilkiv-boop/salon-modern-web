-- Customer self-service remains available at exactly two hours before the
-- appointment. Only appointments with less than two hours remaining are
-- blocked. Token, revision, row locking and conflict controls stay unchanged.
create or replace function public.manage_customer_online_booking(p_token uuid,p_operation uuid,p_revision integer,p_action text,p_start timestamptz default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare request public.online_booking_requests%rowtype; appointment public.appointments%rowtype;
  old_start timestamptz; notification_kind text; notification_title text; notification_body text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Yetkisiz işlem.' using errcode='42501'; end if;
  if p_operation is null or p_action not in ('update','cancel') then raise exception 'Geçersiz işlem.'; end if;
  select * into request from public.online_booking_requests where public_token=p_token for update;
  if not found or request.appointment_id is null then raise exception 'Randevu bulunamadı.'; end if;
  if request.last_customer_operation=p_operation then
    return jsonb_build_object('status',request.status,'revision',request.customer_revision,'replayed',true);
  end if;
  if p_revision is distinct from request.customer_revision then raise exception 'Randevu değişti. Bilgileri yenileyin.'; end if;
  select * into appointment from public.appointments where id=request.appointment_id for update;
  if not found or appointment.status<>'confirmed' or request.status<>'approved' or appointment.scheduled_at<=now() then
    raise exception 'Bu randevu artık değiştirilemez.';
  end if;
  if appointment.scheduled_at<now()+interval '2 hours' then
    raise exception 'Randevunuza 2 saatten az kaldığı için online değişiklik veya iptal yapılamamaktadır. Lütfen Salon Modern ile iletişime geçiniz.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(appointment.employee_id::text,93));
  old_start:=appointment.scheduled_at;
  if p_action='update' then
    perform private.check_online_booking_window(p_start,appointment.duration_minutes);
    if exists(select 1 from public.appointments a where a.employee_id=appointment.employee_id and a.id<>appointment.id
      and a.status<>'cancelled' and a.scheduled_at<p_start+make_interval(mins=>appointment.duration_minutes) and a.scheduled_end>p_start) then
      raise exception 'Seçilen saat artık müsait değil.';
    end if;
    if exists(select 1 from public.closed_time_slots c where c.employee_id=appointment.employee_id
      and p_start<c.ends_at and p_start+make_interval(mins=>appointment.duration_minutes)>c.starts_at) then raise exception 'Seçilen saat kapalı.'; end if;
    if p_start<>old_start then
      update public.appointments set scheduled_at=p_start,staff_overlap_override=false where id=appointment.id;
      notification_kind:='appointment_update'; notification_title:='Randevu güncellendi';
      notification_body:=appointment.client_name||' · Eski: '||to_char(old_start at time zone 'Europe/Istanbul','DD.MM.YYYY HH24:MI')||
        ' · Yeni: '||to_char(p_start at time zone 'Europe/Istanbul','DD.MM.YYYY HH24:MI')||' · '||appointment.service_name;
    end if;
    update public.online_booking_requests set scheduled_at=p_start,employee_id=appointment.employee_id,duration_minutes=appointment.duration_minutes,
      customer_revision=customer_revision+1,last_customer_operation=p_operation where id=request.id;
  else
    update public.appointments set status='cancelled',staff_overlap_override=false where id=appointment.id;
    update public.online_booking_requests set status='cancelled',customer_revision=customer_revision+1,last_customer_operation=p_operation where id=request.id;
    notification_kind:='appointment_cancelled'; notification_title:='Randevu iptal edildi';
    notification_body:=appointment.client_name||' · '||to_char(old_start at time zone 'Europe/Istanbul','DD.MM.YYYY HH24:MI')||' · '||appointment.service_name||' · Müşteri tarafından iptal edildi';
  end if;
  if notification_kind is not null then
    notification_body:=left(notification_body||' · '||coalesce((select full_name from public.profiles where id=appointment.employee_id),''),500);
    insert into public.notifications(recipient_id,appointment_id,kind,title,body)
      select id,appointment.id,notification_kind,notification_title,notification_body from public.profiles
      where active and role='manager' and (id<>appointment.employee_id or
        coalesce(auth.uid(),appointment.updated_by,appointment.created_by)=appointment.employee_id);
  end if;
  return jsonb_build_object('status',case when p_action='cancel' then 'cancelled' else 'approved' end,'revision',request.customer_revision+1);
end $$;

revoke all on function public.manage_customer_online_booking(uuid,uuid,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.manage_customer_online_booking(uuid,uuid,integer,text,timestamptz) to service_role;
