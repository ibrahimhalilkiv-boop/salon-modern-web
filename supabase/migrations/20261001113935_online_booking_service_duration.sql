-- Match the existing services/appointments duration validation; do not rewrite existing rows.
alter table public.online_booking_requests drop constraint online_booking_requests_duration_minutes_check;
alter table public.online_booking_requests add constraint online_booking_requests_duration_minutes_check check(duration_minutes between 15 and 120 and duration_minutes % 15 = 0);

create or replace function public.create_confirmed_online_booking(p_booking jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
  token uuid := (p_booking->>'public_token')::uuid;
  employee uuid := (p_booking->>'employee_id')::uuid;
  service uuid := (p_booking->>'service_id')::uuid;
  starts timestamptz := (p_booking->>'scheduled_at')::timestamptz;
  duration integer := (p_booking->>'duration_minutes')::integer;
  local_start timestamp; day date; opening time; closing time;
  settings public.booking_settings%rowtype; special public.booking_schedule_overrides%rowtype;
  existing public.online_booking_requests%rowtype; tariff public.services%rowtype;
  client uuid; appointment uuid; request_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Yetkisiz işlem.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(token::text,0));
  select * into existing from public.online_booking_requests where public_token=token;
  if found then
    if existing.status<>'approved' or existing.phone_normalized<>p_booking->>'phone_normalized'
      or existing.service_id<>service or existing.employee_id<>employee or existing.scheduled_at<>starts then
      raise exception 'Tekrarlanan kayıt bilgileri eşleşmiyor.';
    end if;
    return jsonb_build_object('id',existing.id,'public_token',token,'appointment_id',existing.appointment_id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_booking->>'phone_normalized',1));
  if (select count(*) from public.online_booking_requests where phone_normalized=p_booking->>'phone_normalized' and created_at>=now()-interval '30 minutes')>=3 then
    raise exception 'Çok fazla randevu isteği.';
  end if;
  if duration < 15 or duration > 120 or duration % 15 <> 0 or duration is null or starts<=now() or starts>now()+interval '90 days' then raise exception 'Geçersiz randevu.'; end if;
  select * into tariff from public.services where id=service and active;
  if not found then raise exception 'Hizmet bulunamadı.'; end if;
  if tariff.duration_minutes is null or duration <> tariff.duration_minutes then raise exception 'Hizmet süresi değişti. Müsait saatleri yenileyin.'; end if;
  if not exists(select 1 from public.profiles where id=employee and active and username is distinct from 'salon.modern') then raise exception 'Çalışan bulunamadı.'; end if;
  local_start:=starts at time zone 'Europe/Istanbul'; day:=local_start::date;
  select * into settings from public.booking_settings where id=true;
  select * into special from public.booking_schedule_overrides where schedule_date=day;
  if settings.online_booking_enabled=false or special.is_closed=true or
     (special.schedule_date is null and extract(dow from day)=0) then raise exception 'Online randevu kapalı.'; end if;
  opening:=coalesce(special.open_time,settings.default_open_time,'09:00'::time);
  closing:=coalesce(special.close_time,settings.default_close_time,'19:00'::time);
  if local_start::time<opening or local_start::time>'19:00'::time or
     local_start+make_interval(mins=>duration)>day+closing or extract(second from local_start)<>0 or
     (duration>=60 and extract(minute from local_start)<>0) or
     (duration<60 and extract(minute from local_start) not in (0,30)) then raise exception 'Saat müsait değil.'; end if;
  if duration<60 and extract(minute from local_start)=30 and exists(
    select 1 from public.appointments where employee_id=employee and status<>'cancelled' and duration_minutes>=45
      and scheduled_at+make_interval(mins=>duration_minutes)=starts
  ) then raise exception 'Sonraki tam saati seçin.'; end if;
  select id into client from public.clients where regexp_replace(phone,'[^0-9]','','g') in
    (p_booking->>'phone_normalized',substring(p_booking->>'phone_normalized' from 2),'0'||substring(p_booking->>'phone_normalized' from 3))
    order by id limit 1;
  if client is null then
    insert into public.clients(full_name,phone) values(p_booking->>'client_name',p_booking->>'phone') returning id into client;
  end if;
  -- Existing exclusion constraint and closed-slot trigger reject concurrent overlaps.
  insert into public.appointments(client_id,client_name,client_phone,service_id,amount,employee_id,scheduled_at,duration_minutes,note,status,source)
    values(client,p_booking->>'client_name',p_booking->>'phone',service,tariff.price,employee,starts,duration,p_booking->>'note','confirmed','online')
    returning id into appointment;
  insert into public.online_booking_requests(client_name,phone,phone_normalized,service_id,service_name,amount,employee_id,scheduled_at,duration_minutes,note,request_ip_hash,public_token,status,appointment_id,reviewed_at)
    values(p_booking->>'client_name',p_booking->>'phone',p_booking->>'phone_normalized',service,tariff.name,tariff.price,employee,starts,duration,p_booking->>'note',p_booking->>'request_ip_hash',token,'approved',appointment,now()) returning id into request_id;
  insert into public.notifications(recipient_id,appointment_id,kind,title,body)
    select id,appointment,'booking_request','Yeni online randevu',
      (p_booking->>'client_name')||' · '||tariff.name||' · '||to_char(local_start,'DD.MM.YYYY HH24:MI')
    from public.profiles where active and role='manager' and id<>employee;
  return jsonb_build_object('id',request_id,'public_token',token,'appointment_id',appointment);
end $$;
revoke all on function public.create_confirmed_online_booking(jsonb) from public,anon,authenticated;
grant execute on function public.create_confirmed_online_booking(jsonb) to service_role;
