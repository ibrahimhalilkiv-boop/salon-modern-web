-- Online booking reserves the four approved services for 60 minutes and all
-- remaining services for 30 minutes. Service master durations and manually-
-- created appointments are intentionally unchanged.
create or replace function private.online_booking_duration(p_service uuid)
returns integer
language sql
stable
security invoker
set search_path=pg_catalog,public
as $$
  select case when s.id in (
    '2638b0ff-a6e0-412c-b212-0f4d238d9be1'::uuid,
    '620dbf23-22f9-4362-85a4-eed7c377e9be'::uuid,
    '0cdc2d09-b75e-4545-ba73-1c01665400c7'::uuid,
    '65f7f4ae-77ff-4409-b10a-5607a05aceee'::uuid
  ) then 60 else 30 end
  from public.services s
  where s.active and s.id=p_service
$$;

revoke all on function private.online_booking_duration(uuid) from public,anon,authenticated;
grant execute on function private.online_booking_duration(uuid) to service_role;

create or replace function public.create_confirmed_online_booking(p_booking jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare
  token uuid := (p_booking->>'public_token')::uuid;
  employee uuid := (p_booking->>'employee_id')::uuid;
  service uuid := (p_booking->>'service_id')::uuid;
  starts timestamptz := (p_booking->>'scheduled_at')::timestamptz;
  duration integer := (p_booking->>'duration_minutes')::integer;
  expected_duration integer;
  local_start timestamp;
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
  select * into tariff from public.services where id=service and active;
  if not found then raise exception 'Hizmet bulunamadı.'; end if;
  expected_duration:=private.online_booking_duration(service);
  if expected_duration is null or duration<>expected_duration then raise exception 'Online hizmet süresi değişti. Müsait saatleri yenileyin.'; end if;
  perform private.check_online_booking_window(starts,duration);
  if not exists(select 1 from public.profiles where id=employee and active and username is distinct from 'salon.modern') then raise exception 'Çalışan bulunamadı.'; end if;
  local_start:=starts at time zone 'Europe/Istanbul';
  select id into client from public.clients where regexp_replace(phone,'[^0-9]','','g') in
    (p_booking->>'phone_normalized',substring(p_booking->>'phone_normalized' from 2),'0'||substring(p_booking->>'phone_normalized' from 3))
    order by id limit 1;
  if client is null then
    insert into public.clients(full_name,phone) values(p_booking->>'client_name',p_booking->>'phone') returning id into client;
  end if;
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
