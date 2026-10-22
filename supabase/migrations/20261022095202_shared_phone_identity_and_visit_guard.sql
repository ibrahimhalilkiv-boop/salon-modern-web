-- Idempotent online tokens bind to the named customer as well as the telephone.
create or replace function public.create_confirmed_online_booking(p_booking jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare
  token uuid := (p_booking->>'public_token')::uuid;
  preferred uuid := (p_booking->>'employee_id')::uuid;
  chosen_employee uuid;
  candidate uuid;
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
  if token is null or normalized_phone is null then raise exception 'Geçersiz randevu bilgisi.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(token::text,0));
  select * into existing from public.online_booking_requests where public_token=token;
  if found then
    if existing.status<>'approved' or lower(trim(existing.client_name))<>lower(trim(p_booking->>'client_name'))
      or private.normalize_tr_phone(existing.phone_normalized)<>normalized_phone
      or existing.service_id<>service or (preferred is not null and existing.employee_id<>preferred)
      or existing.scheduled_at<>starts then raise exception 'Tekrarlanan kayıt bilgileri eşleşmiyor.'; end if;
    return jsonb_build_object('id',existing.id,'public_token',token,'appointment_id',existing.appointment_id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(normalized_phone,1));
  if not public.can_create_online_booking(normalized_phone) then
    raise exception 'Online randevu oluşturma işleminiz için lütfen Salon Modern ile iletişime geçiniz.';
  end if;
  if (select count(*) from public.online_booking_requests
      where private.normalize_tr_phone(phone_normalized)=normalized_phone and created_at>=now()-interval '30 minutes')>=3 then
    raise exception 'Çok fazla randevu isteği.';
  end if;
  if exists(select 1 from public.appointments a where a.status<>'cancelled' and a.scheduled_at=starts
      and lower(trim(a.client_name))=lower(trim(p_booking->>'client_name'))) then
    raise exception 'Bu müşteri için aynı saatte randevu zaten mevcut.' using errcode='23505';
  end if;
  select * into tariff from public.services where id=service and active;
  if not found then raise exception 'Hizmet bulunamadı.'; end if;
  expected_duration:=private.online_booking_duration(service);
  if expected_duration is null or duration<>expected_duration then
    raise exception 'Online hizmet süresi değişti. Müsait saatleri yenileyin.';
  end if;
  perform private.check_online_booking_window(starts,duration);
  for candidate in select id from public.profiles where active and username is distinct from 'salon.modern'
    and (preferred is null or id=preferred) order by id loop
    perform pg_advisory_xact_lock(hashtextextended(candidate::text,93));
    if private.online_slot_available(candidate,starts,duration) then chosen_employee:=candidate; exit; end if;
  end loop;
  if chosen_employee is null then raise exception 'Seçilen saat artık müsait değil.' using errcode='23P01'; end if;
  local_start:=starts at time zone 'Europe/Istanbul';
  select id into client from public.clients where lower(trim(full_name))=lower(trim(p_booking->>'client_name')) order by id limit 1;
  if client is null then
    insert into public.clients(full_name,phone) values(p_booking->>'client_name',p_booking->>'phone') returning id into client;
  end if;
  insert into public.appointments(client_id,client_name,client_phone,service_id,amount,employee_id,scheduled_at,note,status,source)
    values(client,p_booking->>'client_name',p_booking->>'phone',service,tariff.price,chosen_employee,starts,p_booking->>'note','confirmed','online')
    returning id into appointment;
  insert into public.online_booking_requests(client_name,phone,phone_normalized,service_id,service_name,amount,employee_id,scheduled_at,duration_minutes,note,request_ip_hash,public_token,status,appointment_id,reviewed_at)
    values(p_booking->>'client_name',p_booking->>'phone',normalized_phone,service,tariff.name,tariff.price,chosen_employee,starts,duration,p_booking->>'note',p_booking->>'request_ip_hash',token,'approved',appointment,now()) returning id into request_id;
  insert into public.notifications(recipient_id,appointment_id,kind,title,body)
    select id,appointment,'booking_request','Yeni online randevu',
      (p_booking->>'client_name')||' · '||tariff.name||' · '||to_char(local_start,'DD.MM.YYYY HH24:MI')
    from public.profiles where active and role='manager' and id<>chosen_employee;
  return jsonb_build_object('id',request_id,'public_token',token,'appointment_id',appointment,'employee_id',chosen_employee);
end $$;
revoke all on function public.create_confirmed_online_booking(jsonb) from public,anon,authenticated;
grant execute on function public.create_confirmed_online_booking(jsonb) to service_role;


-- Preserve duplicate prevention by client identity while allowing family members to share a number.
create or replace function private.reject_appointment_during_closed_time()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.employee_id::text,93));
  if tg_op='UPDATE' and old.source='online' and new.source is distinct from 'online' then
    raise exception 'Online randevunun kaynağı değiştirilemez.';
  end if;
  if new.source='online' and new.staff_overlap_override then
    raise exception 'Online randevuda çakışma istisnası kullanılamaz.';
  end if;
  if new.staff_overlap_override and (tg_op='INSERT' or not old.staff_overlap_override or
       (new.employee_id,new.scheduled_at,new.duration_minutes) is distinct from (old.employee_id,old.scheduled_at,old.duration_minutes)) then
    if not exists(select 1 from public.profiles where id=auth.uid() and active and
      (role='manager' or (role='employee' and id=new.employee_id and (tg_op='INSERT' or id=old.employee_id)))) then
      raise exception 'Çakışma istisnası yalnız yetkili personele açıktır.' using errcode='42501';
    end if;
  end if;
  if new.status='cancelled' then return new; end if;
  if tg_op='UPDATE' and old.status<>'cancelled' and
    (new.employee_id,new.scheduled_at,new.duration_minutes,new.online_protection_minutes,new.source)
      is not distinct from
    (old.employee_id,old.scheduled_at,old.duration_minutes,old.online_protection_minutes,old.source) then
    return new;
  end if;
  if new.source='online' then
    if not private.online_slot_available(new.employee_id,new.scheduled_at,
      greatest(new.duration_minutes,coalesce(new.online_protection_minutes,new.duration_minutes)),new.id) then
      raise exception 'Seçilen saat artık müsait değil.' using errcode='23P01';
    end if;
  else
    if exists(select 1 from public.closed_time_slots c where c.employee_id=new.employee_id
      and c.starts_at<new.scheduled_at+make_interval(mins=>new.duration_minutes) and c.ends_at>new.scheduled_at) then
      raise exception 'Bu çalışanın seçilen saati kapalıdır.';
    end if;
    if exists(select 1 from public.appointments a where a.id is distinct from new.id
      and a.status<>'cancelled' and a.scheduled_at=new.scheduled_at
      and (a.client_id=new.client_id or lower(trim(a.client_name))=lower(trim(new.client_name)))) then
      raise exception 'Bu müşteri için aynı saatte randevu zaten mevcut.' using errcode='23505';
    end if;
  end if;
  return new;
end $$;


-- Only completed visits count in customer interval analysis.
CREATE OR REPLACE FUNCTION public.salon_client_visit_summary(p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 500)
 RETURNS TABLE(client_id uuid, visit_count integer, last_visit date, average_days integer, preferred_employee_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with caller as materialized (
    select p.id, p.role from public.profiles p
    where p.id = (select auth.uid()) and p.active
      and p.role in ('manager','employee')
  ), selected_clients as materialized (
    select c.id from public.clients c cross join caller u
    where c.active and (p_after is null or c.id > p_after)
      and (u.role = 'manager' or exists (
        select 1 from public.appointments own
        where own.client_id = c.id and own.employee_id = u.id
      ))
    order by c.id
    limit least(greatest(p_limit, 1), 500)
  ), eligible as (
    select a.client_id, a.employee_id,
           (a.scheduled_at at time zone 'Europe/Istanbul')::date as visit_day
    from public.appointments a
    join selected_clients c on c.id = a.client_id
    where a.status = 'completed' and a.scheduled_at < now()
      and (a.scheduled_at at time zone 'Europe/Istanbul')::date
          <= (now() at time zone 'Europe/Istanbul')::date
  ), visited_days as (
    select distinct e.client_id, e.visit_day from eligible e
  ), intervals as (
    select d.client_id, d.visit_day,
           d.visit_day - lag(d.visit_day) over (partition by d.client_id order by d.visit_day) as gap_days
    from visited_days d
  ), summaries as (
    select i.client_id, count(*)::integer as visit_count,
           max(i.visit_day) as last_visit,
           greatest(1, round(avg(i.gap_days) filter (where i.gap_days > 0))::integer) as average_days
    from intervals i group by i.client_id
  ), employees as (
    select e.client_id, e.employee_id,
           row_number() over (partition by e.client_id order by count(*) desc, e.employee_id) as rank
    from eligible e where e.employee_id is not null
    group by e.client_id, e.employee_id
  )
  select c.id, coalesce(s.visit_count, 0), s.last_visit, s.average_days, e.employee_id
  from selected_clients c
  left join summaries s on s.client_id = c.id
  left join employees e on e.client_id = c.id and e.rank = 1
  order by c.id;
$function$
