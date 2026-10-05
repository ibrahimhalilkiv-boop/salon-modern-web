create or replace function private.normalize_tr_phone(p_raw text)
returns text language sql immutable security invoker
set search_path=pg_catalog as $$
  with value as (select regexp_replace(coalesce(p_raw,''),'[^0-9]','','g') digits)
  select case
    when digits ~ '^905[0-9]{9}$' then digits
    when digits ~ '^00905[0-9]{9}$' then substring(digits from 3)
    when digits ~ '^05[0-9]{9}$' then '90'||substring(digits from 2)
    when digits ~ '^5[0-9]{9}$' then '90'||digits
    else null
  end from value
$$;

create or replace function public.can_create_online_booking(p_phone text)
returns boolean language sql stable security invoker
set search_path=pg_catalog,public,private as $$
  -- This project is a single-business database, so public.appointments is the
  -- Salon Modern tenant boundary. Other businesses use separate projects.
  with input as (
    select private.normalize_tr_phone(p_phone) phone
  )
  select i.phone is not null and (
    select count(*)<2
    from public.appointments a
    where a.status='no_show'
      and a.scheduled_at>=now()-interval '6 months'
      and a.scheduled_at<=now()
      and (
        private.normalize_tr_phone(a.client_phone)=i.phone
        or exists (
          select 1 from public.clients c
          where c.id=a.client_id and private.normalize_tr_phone(c.phone)=i.phone
        )
      )
  )
  from input i
$$;

revoke all on function private.normalize_tr_phone(text) from public,anon,authenticated;
revoke all on function public.can_create_online_booking(text) from public,anon,authenticated;
grant execute on function private.normalize_tr_phone(text) to service_role;
grant execute on function public.can_create_online_booking(text) to service_role;

create or replace function private.check_online_booking_window(p_start timestamptz,p_duration integer) returns void
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare local_start timestamp:=p_start at time zone 'Europe/Istanbul'; day date:=local_start::date;
  settings public.booking_settings%rowtype; special public.booking_schedule_overrides%rowtype;
  opening time; closing time;
begin
  if p_duration is null or p_duration<=0 or p_start<=now() or p_start>now()+interval '90 days' then raise exception 'Geçersiz randevu.'; end if;
  select * into settings from public.booking_settings where id=true;
  select * into special from public.booking_schedule_overrides where schedule_date=day;
  if settings.online_booking_enabled=false or special.is_closed=true or
    (special.schedule_date is null and extract(dow from day)=0) then raise exception 'Online randevu kapalı.'; end if;
  opening:=coalesce(special.open_time,settings.default_open_time,'09:00'::time);
  closing:=coalesce(special.close_time,settings.default_close_time,'19:00'::time);
  if local_start::time<opening or local_start::time>'19:00'::time or
    local_start+make_interval(mins=>p_duration)>day+closing or
    extract(second from local_start)<>0 or extract(minute from local_start)::integer%30<>0 then raise exception 'Saat müsait değil.'; end if;
end $$;

create or replace function public.create_confirmed_online_booking(p_booking jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare
  token uuid := (p_booking->>'public_token')::uuid;
  employee uuid := (p_booking->>'employee_id')::uuid;
  service uuid := (p_booking->>'service_id')::uuid;
  starts timestamptz := (p_booking->>'scheduled_at')::timestamptz;
  duration integer := (p_booking->>'duration_minutes')::integer;
  normalized_phone text := private.normalize_tr_phone(p_booking->>'phone_normalized');
  expected_duration integer;
  local_start timestamp;
  existing public.online_booking_requests%rowtype; tariff public.services%rowtype;
  client uuid; appointment uuid; request_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Yetkisiz işlem.' using errcode='42501'; end if;
  if normalized_phone is null then raise exception 'Geçersiz telefon numarası.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(token::text,0));
  select * into existing from public.online_booking_requests where public_token=token;
  if found then
    if existing.status<>'approved' or private.normalize_tr_phone(existing.phone_normalized)<>normalized_phone
      or existing.service_id<>service or existing.employee_id<>employee or existing.scheduled_at<>starts then
      raise exception 'Tekrarlanan kayıt bilgileri eşleşmiyor.';
    end if;
    return jsonb_build_object('id',existing.id,'public_token',token,'appointment_id',existing.appointment_id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(normalized_phone,1));
  if not public.can_create_online_booking(normalized_phone) then
    raise exception 'Online randevu oluşturma işleminiz için lütfen Salon Modern ile iletişime geçiniz.';
  end if;
  if (select count(*) from public.online_booking_requests where private.normalize_tr_phone(phone_normalized)=normalized_phone and created_at>=now()-interval '30 minutes')>=3 then
    raise exception 'Çok fazla randevu isteği.';
  end if;
  select * into tariff from public.services where id=service and active;
  if not found then raise exception 'Hizmet bulunamadı.'; end if;
  expected_duration:=private.online_booking_duration(service);
  if expected_duration is null or duration<>expected_duration then raise exception 'Online hizmet süresi değişti. Müsait saatleri yenileyin.'; end if;
  perform private.check_online_booking_window(starts,duration);
  if not exists(select 1 from public.profiles where id=employee and active and username is distinct from 'salon.modern') then raise exception 'Çalışan bulunamadı.'; end if;
  local_start:=starts at time zone 'Europe/Istanbul';
  select id into client from public.clients where private.normalize_tr_phone(phone)=normalized_phone order by id limit 1;
  if client is null then
    insert into public.clients(full_name,phone) values(p_booking->>'client_name',p_booking->>'phone') returning id into client;
  end if;
  insert into public.appointments(client_id,client_name,client_phone,service_id,amount,employee_id,scheduled_at,duration_minutes,note,status,source)
    values(client,p_booking->>'client_name',p_booking->>'phone',service,tariff.price,employee,starts,duration,p_booking->>'note','confirmed','online')
    returning id into appointment;
  insert into public.online_booking_requests(client_name,phone,phone_normalized,service_id,service_name,amount,employee_id,scheduled_at,duration_minutes,note,request_ip_hash,public_token,status,appointment_id,reviewed_at)
    values(p_booking->>'client_name',p_booking->>'phone',normalized_phone,service,tariff.name,tariff.price,employee,starts,duration,p_booking->>'note',p_booking->>'request_ip_hash',token,'approved',appointment,now()) returning id into request_id;
  insert into public.notifications(recipient_id,appointment_id,kind,title,body)
    select id,appointment,'booking_request','Yeni online randevu',
      (p_booking->>'client_name')||' · '||tariff.name||' · '||to_char(local_start,'DD.MM.YYYY HH24:MI')
    from public.profiles where active and role='manager' and id<>employee;
  return jsonb_build_object('id',request_id,'public_token',token,'appointment_id',appointment);
end $$;

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
  if appointment.scheduled_at<=now()+interval '2 hours' then
    raise exception 'Randevunuza 2 saat veya daha az kaldığı için online değişiklik veya iptal yapılamamaktadır. Lütfen Salon Modern ile iletişime geçiniz.';
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

revoke all on function public.create_confirmed_online_booking(jsonb) from public,anon,authenticated;
grant execute on function public.create_confirmed_online_booking(jsonb) to service_role;
revoke all on function public.manage_customer_online_booking(uuid,uuid,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.manage_customer_online_booking(uuid,uuid,integer,text,timestamptz) to service_role;
