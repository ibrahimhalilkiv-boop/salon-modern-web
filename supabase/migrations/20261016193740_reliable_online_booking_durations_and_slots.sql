-- Keep the displayed calendar duration and the online reservation guard separate.
-- Existing appointment rows retain their original duration and end timestamp.
set lock_timeout = '5s';

alter table public.services add column online_duration_minutes integer;
update public.services s
set online_duration_minutes = greatest(s.duration_minutes, coalesce(private.online_booking_duration(s.id), s.duration_minutes));
alter table public.services alter column online_duration_minutes set not null;
alter table public.services add constraint services_online_duration_minutes_check
  check (online_duration_minutes >= duration_minutes and online_duration_minutes > 0);

alter table public.appointments add column online_protection_minutes integer;
alter table public.appointments add column online_reserved_end timestamptz;
alter table public.appointments add constraint appointments_online_protection_minutes_check
  check (online_protection_minutes is null or online_protection_minutes >= duration_minutes);

create or replace function private.online_booking_duration(p_service uuid) returns integer
language sql stable security invoker set search_path=pg_catalog,public as $$
  select greatest(s.duration_minutes,s.online_duration_minutes)
  from public.services s where s.id=p_service and s.active
$$;
revoke all on function private.online_booking_duration(uuid) from public,anon,authenticated;
grant execute on function private.online_booking_duration(uuid) to service_role;

create or replace function private.set_appointment_service_snapshot() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare selected_service public.services%rowtype;
begin
  select * into selected_service from public.services where id=new.service_id and active;
  if not found then raise exception 'Seçilen işlem bulunamadı veya pasif.'; end if;
  new.service_name:=selected_service.name;
  if new.amount is null or new.amount<0 then new.amount:=selected_service.price; end if;
  if tg_op='INSERT' then
    new.duration_minutes:=selected_service.duration_minutes;
    new.online_protection_minutes:=selected_service.online_duration_minutes;
  elsif new.service_id is distinct from old.service_id then
    new.duration_minutes:=selected_service.duration_minutes;
    new.online_protection_minutes:=selected_service.online_duration_minutes;
  else
    new.duration_minutes:=old.duration_minutes;
    new.online_protection_minutes:=old.online_protection_minutes;
  end if;
  return new;
end $$;

create or replace function public.set_appointment_end() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  new.scheduled_end:=new.scheduled_at+make_interval(mins=>new.duration_minutes);
  new.online_reserved_end:=new.scheduled_at+make_interval(mins=>greatest(new.duration_minutes,coalesce(new.online_protection_minutes,new.duration_minutes)));
  return new;
end $$;
drop trigger trg_set_appointment_end on public.appointments;
create trigger trg_set_appointment_end before insert or update of scheduled_at,duration_minutes,service_id,online_protection_minutes
  on public.appointments for each row execute function public.set_appointment_end();

-- A legacy row without a snapshot still protects the online duration of its service.
-- Manual appointments may use their real calendar duration when staff deliberately
-- place someone in the guarded tail; customers never see that tail as free.
create or replace function private.online_slot_available(
  p_employee uuid,p_start timestamptz,p_duration integer,p_exclude uuid default null
) returns boolean language sql stable security invoker set search_path=pg_catalog,public as $$
  select p_start is not null and p_duration>0
    and exists(select 1 from public.profiles p where p.id=p_employee and p.active and p.username is distinct from 'salon.modern')
    and not exists(
      select 1 from public.appointments a left join public.services s on s.id=a.service_id
      where a.employee_id=p_employee and a.id is distinct from p_exclude and a.status<>'cancelled'
        and a.scheduled_at<p_start+make_interval(mins=>p_duration)
        and coalesce(a.online_reserved_end,
          a.scheduled_at+make_interval(mins=>greatest(a.duration_minutes,coalesce(s.online_duration_minutes,a.duration_minutes))),
          a.scheduled_end)>p_start
    )
    and not exists(
      select 1 from public.closed_time_slots c where c.employee_id=p_employee
        and c.starts_at<p_start+make_interval(mins=>p_duration) and c.ends_at>p_start
    )
$$;
revoke all on function private.online_slot_available(uuid,timestamptz,integer,uuid) from public,anon;
grant execute on function private.online_slot_available(uuid,timestamptz,integer,uuid) to authenticated,service_role;

create or replace function private.reject_appointment_during_closed_time() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
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
    -- Staff retain the existing ability to deliberately overlap different customers.
    -- An exact duplicate for the same customer/time is still rejected.
    if exists(select 1 from public.appointments a where a.id is distinct from new.id
      and a.status<>'cancelled' and a.scheduled_at=new.scheduled_at
      and ((new.client_id is not null and a.client_id=new.client_id)
        or (private.normalize_tr_phone(new.client_phone) is not null
          and private.normalize_tr_phone(a.client_phone)=private.normalize_tr_phone(new.client_phone)))) then
      raise exception 'Bu müşteri için aynı saatte randevu zaten mevcut.' using errcode='23505';
    end if;
  end if;
  return new;
end $$;
drop trigger appointments_validate_schedule on public.appointments;
create trigger appointments_validate_schedule before insert or update of scheduled_at,duration_minutes,service_id,employee_id,source,status,staff_overlap_override,online_protection_minutes
  on public.appointments for each row execute function private.reject_appointment_during_closed_time();

alter table public.appointments drop constraint appointments_no_overlap;
alter table public.appointments add constraint appointments_no_overlap
  exclude using gist(employee_id with =,tstzrange(scheduled_at,coalesce(online_reserved_end,scheduled_end),'[)') with &&)
  where(status<>'cancelled' and source='online');

-- The current live default opens at 09:00; the requested standard day starts 08:30.
update public.booking_settings set default_open_time='08:30' where id=true;

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
  opening:=coalesce(special.open_time,settings.default_open_time,'08:30'::time);
  closing:=coalesce(special.close_time,settings.default_close_time,'20:00'::time);
  if local_start::time<opening or local_start+make_interval(mins=>p_duration)>day+closing or
    extract(second from local_start)<>0 or extract(minute from local_start)::integer%30<>0 then
    raise exception 'Saat müsait değil.';
  end if;
end $$;
revoke all on function private.check_online_booking_window(timestamptz,integer) from public,anon;
grant execute on function private.check_online_booking_window(timestamptz,integer) to authenticated,service_role;

create or replace function public.online_booking_slots(
  p_service uuid,p_day date,p_employee uuid default null,p_exclude uuid default null,p_duration_override integer default null
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare duration integer; settings public.booking_settings%rowtype; special public.booking_schedule_overrides%rowtype;
  opening time; closing time; minute integer; starts timestamptz; employee_ids uuid[]; slots jsonb:='[]'::jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Yetkisiz işlem.' using errcode='42501'; end if;
  if p_day is null or p_day<(now() at time zone 'Europe/Istanbul')::date or
    p_day>(now() at time zone 'Europe/Istanbul')::date+90 then
    raise exception 'Geçersiz tarih.';
  end if;
  if p_duration_override is not null and p_exclude is not null then
    duration:=p_duration_override;
  else
    duration:=private.online_booking_duration(p_service);
  end if;
  if duration is null or duration<=0 then raise exception 'Hizmet süresi tanımlı değil.'; end if;
  select * into settings from public.booking_settings where id=true;
  select * into special from public.booking_schedule_overrides where schedule_date=p_day;
  if settings.online_booking_enabled=false or special.is_closed=true or
    (special.schedule_date is null and extract(dow from p_day)=0) then
    return jsonb_build_object('durationMinutes',duration,'slots',slots);
  end if;
  opening:=coalesce(special.open_time,settings.default_open_time,'08:30'::time);
  closing:=coalesce(special.close_time,settings.default_close_time,'20:00'::time);
  for minute in select generate_series(
    ((extract(hour from opening)::integer*60+extract(minute from opening)::integer+29)/30)*30,
    least(24*60,extract(hour from closing)::integer*60+extract(minute from closing)::integer-duration),30
  ) loop
    starts:=(p_day+make_interval(mins=>minute)) at time zone 'Europe/Istanbul';
    if starts<=now() or starts>now()+interval '90 days' then continue; end if;
    select coalesce(array_agg(p.id order by p.id),'{}'::uuid[]) into employee_ids
    from public.profiles p where p.active and p.username is distinct from 'salon.modern'
      and (p_employee is null or p.id=p_employee)
      and private.online_slot_available(p.id,starts,duration,p_exclude);
    if cardinality(employee_ids)>0 then
      slots:=slots||jsonb_build_array(jsonb_build_object(
        'time',to_char(p_day+make_interval(mins=>minute),'HH24:MI'),'employeeIds',employee_ids));
    end if;
  end loop;
  return jsonb_build_object('durationMinutes',duration,'slots',slots);
end $$;
revoke all on function public.online_booking_slots(uuid,date,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.online_booking_slots(uuid,date,uuid,uuid,integer) to service_role;

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
    if existing.status<>'approved' or private.normalize_tr_phone(existing.phone_normalized)<>normalized_phone
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
      and private.normalize_tr_phone(a.client_phone)=normalized_phone) then
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
  select id into client from public.clients where private.normalize_tr_phone(phone)=normalized_phone order by id limit 1;
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

-- The legacy pending-request approval used a fixed 30 minutes. Its manager-only
-- entry point now uses the same service duration, time window and slot checks.
create or replace function public.approve_online_booking_request(p_request_id uuid) returns uuid
language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare v_request public.online_booking_requests%rowtype; tariff public.services%rowtype;
  v_client_id uuid; v_appointment_id uuid; chosen_employee uuid; candidate uuid; duration integer;
begin
  if not private.is_manager() then raise exception 'Bu işlem yalnızca yöneticilere açıktır.' using errcode='42501'; end if;
  select * into v_request from public.online_booking_requests where id=p_request_id for update;
  if not found then raise exception 'Randevu talebi bulunamadı.'; end if;
  if v_request.status<>'pending' then raise exception 'Bu talep daha önce sonuçlandırılmış.'; end if;
  select * into tariff from public.services where id=v_request.service_id and active;
  if not found then raise exception 'Hizmet bulunamadı.'; end if;
  duration:=greatest(tariff.duration_minutes,tariff.online_duration_minutes);
  perform private.check_online_booking_window(v_request.scheduled_at,duration);
  for candidate in select id from public.profiles where active and username is distinct from 'salon.modern'
    and (v_request.employee_id is null or id=v_request.employee_id) order by id loop
    perform pg_advisory_xact_lock(hashtextextended(candidate::text,93));
    if private.online_slot_available(candidate,v_request.scheduled_at,duration) then chosen_employee:=candidate; exit; end if;
  end loop;
  if chosen_employee is null then raise exception 'Seçilen saat artık müsait değil.' using errcode='23P01'; end if;
  if exists(select 1 from public.appointments a where a.status<>'cancelled' and a.scheduled_at=v_request.scheduled_at
      and private.normalize_tr_phone(a.client_phone)=private.normalize_tr_phone(v_request.phone_normalized)) then
    raise exception 'Bu müşteri için aynı saatte randevu zaten mevcut.' using errcode='23505';
  end if;
  select id into v_client_id from public.clients
  where private.normalize_tr_phone(phone)=private.normalize_tr_phone(v_request.phone_normalized)
  order by updated_at desc limit 1;
  if v_client_id is null then
    insert into public.clients(full_name,phone) values(trim(v_request.client_name),v_request.phone) returning id into v_client_id;
  else
    update public.clients set phone=coalesce(nullif(phone,''),v_request.phone),updated_at=now() where id=v_client_id;
  end if;
  insert into public.appointments(client_id,client_name,client_phone,service_id,service_name,amount,
    employee_id,scheduled_at,note,created_by,status,source)
  values(v_client_id,trim(v_request.client_name),v_request.phone,v_request.service_id,v_request.service_name,
    v_request.amount,chosen_employee,v_request.scheduled_at,'Müşteri çevrim içi talebi',auth.uid(),'confirmed','online')
  returning id into v_appointment_id;
  update public.online_booking_requests set status='approved',appointment_id=v_appointment_id,
    employee_id=chosen_employee,duration_minutes=duration,
    reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=p_request_id;
  return v_appointment_id;
end $$;

-- Preserve token, revision, exact two-hour boundary and cancellation metadata.
-- Rescheduling checks the original online protection snapshot, not the shorter
-- internal calendar duration.
create or replace function public.manage_customer_online_booking(p_token uuid,p_operation uuid,p_revision integer,p_action text,p_start timestamptz default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare request public.online_booking_requests%rowtype; appointment public.appointments%rowtype;
  old_start timestamptz; notification_kind text; notification_title text; notification_body text;
  protected_minutes integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Yetkisiz işlem.' using errcode='42501'; end if;
  if p_operation is null or p_action not in ('update','cancel') then raise exception 'Geçersiz işlem.'; end if;
  select * into request from public.online_booking_requests where public_token=p_token for update;
  if not found or request.appointment_id is null then raise exception 'Randevu bulunamadı.'; end if;
  if request.last_customer_operation=p_operation then return jsonb_build_object('status',request.status,'revision',request.customer_revision,'replayed',true); end if;
  if p_revision is distinct from request.customer_revision then raise exception 'Randevu değişti. Bilgileri yenileyin.'; end if;
  select * into appointment from public.appointments where id=request.appointment_id for update;
  if not found or appointment.status<>'confirmed' or request.status<>'approved' or appointment.scheduled_at<=now() then raise exception 'Bu randevu artık değiştirilemez.'; end if;
  if appointment.scheduled_at<now()+interval '2 hours' then
    raise exception 'Randevunuza 2 saatten az kaldığı için online değişiklik veya iptal yapılamamaktadır. Lütfen Salon Modern ile iletişime geçiniz.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(appointment.employee_id::text,93));
  old_start:=appointment.scheduled_at;
  protected_minutes:=greatest(appointment.duration_minutes,
    coalesce(appointment.online_protection_minutes,private.online_booking_duration(appointment.service_id),appointment.duration_minutes));
  if p_action='update' then
    perform private.check_online_booking_window(p_start,protected_minutes);
    if not private.online_slot_available(appointment.employee_id,p_start,protected_minutes,appointment.id) then
      raise exception 'Seçilen saat artık müsait değil.';
    end if;
    if p_start<>old_start then
      update public.appointments set scheduled_at=p_start,staff_overlap_override=false where id=appointment.id;
      notification_kind:='appointment_update'; notification_title:='Randevu güncellendi';
      notification_body:=appointment.client_name||' · Eski: '||to_char(old_start at time zone 'Europe/Istanbul','DD.MM.YYYY HH24:MI')||' · Yeni: '||to_char(p_start at time zone 'Europe/Istanbul','DD.MM.YYYY HH24:MI')||' · '||appointment.service_name;
    end if;
    update public.online_booking_requests set scheduled_at=p_start,employee_id=appointment.employee_id,duration_minutes=protected_minutes,
      customer_revision=customer_revision+1,last_customer_operation=p_operation where id=request.id;
  else
    perform set_config('salon.cancellation_source','customer',true);
    update public.appointments set status='cancelled',staff_overlap_override=false where id=appointment.id;
    update public.online_booking_requests set status='cancelled',customer_revision=customer_revision+1,last_customer_operation=p_operation where id=request.id;
    notification_kind:='appointment_cancelled'; notification_title:='Randevu iptal edildi';
    notification_body:=appointment.client_name||' · '||to_char(old_start at time zone 'Europe/Istanbul','DD.MM.YYYY HH24:MI')||' · '||appointment.service_name||' · Müşteri tarafından iptal edildi';
  end if;
  if notification_kind is not null then
    notification_body:=left(notification_body||' · '||coalesce((select full_name from public.profiles where id=appointment.employee_id),''),500);
    insert into public.notifications(recipient_id,appointment_id,kind,title,body)
      select id,appointment.id,notification_kind,notification_title,notification_body from public.profiles
      where active and role='manager' and (id<>appointment.employee_id or coalesce(auth.uid(),appointment.updated_by,appointment.created_by)=appointment.employee_id);
  end if;
  return jsonb_build_object('status',case when p_action='cancel' then 'cancelled' else 'approved' end,'revision',request.customer_revision+1);
end $$;
revoke all on function public.manage_customer_online_booking(uuid,uuid,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.manage_customer_online_booking(uuid,uuid,integer,text,timestamptz) to service_role;
