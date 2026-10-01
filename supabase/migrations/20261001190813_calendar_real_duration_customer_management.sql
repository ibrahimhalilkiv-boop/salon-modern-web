-- Additive changes only; never rewrite historical appointments or requests.
set lock_timeout='5s';
grant usage on schema private to service_role;
alter table public.services drop constraint services_duration_minutes_check;
alter table public.services add constraint services_duration_minutes_check check(duration_minutes>0);
alter table public.appointments drop constraint appointments_duration_minutes_check;
alter table public.appointments add constraint appointments_duration_minutes_check check(duration_minutes>0);
alter table public.online_booking_requests drop constraint online_booking_requests_duration_minutes_check;
alter table public.online_booking_requests add constraint online_booking_requests_duration_minutes_check check(duration_minutes>0);
alter table public.online_booking_requests drop constraint online_booking_requests_status_check;
alter table public.online_booking_requests add constraint online_booking_requests_status_check check(status in ('pending','approved','rejected','cancelled'));
alter table public.appointments add column staff_overlap_override boolean not null default false;
alter table public.online_booking_requests add column customer_revision integer not null default 0;
alter table public.online_booking_requests add column last_customer_operation uuid;

create or replace function private.set_appointment_service_snapshot() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare selected_service public.services%rowtype;
begin
  select * into selected_service from public.services where id=new.service_id and active;
  if not found then raise exception 'Seçilen işlem bulunamadı veya pasif.'; end if;
  new.service_name:=selected_service.name;
  if new.amount is null or new.amount<0 then new.amount:=selected_service.price; end if;
  if tg_op='INSERT' then
    if new.source is distinct from 'online' or new.duration_minutes is null then new.duration_minutes:=selected_service.duration_minutes; end if;
  elsif new.service_id is distinct from old.service_id then
    new.duration_minutes:=selected_service.duration_minutes;
  else
    new.duration_minutes:=old.duration_minutes;
  end if;
  return new;
end $$;

drop trigger trg_set_appointment_end on public.appointments;
create trigger trg_set_appointment_end before insert or update of scheduled_at,duration_minutes,service_id
on public.appointments for each row execute function public.set_appointment_end();

alter table public.appointments drop constraint appointments_no_overlap;
alter table public.appointments add constraint appointments_no_overlap
exclude using gist(employee_id with =,tstzrange(scheduled_at,scheduled_end,'[)') with &&)
where(status<>'cancelled' and source='online' and not staff_overlap_override);

create or replace function private.reject_appointment_during_closed_time() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.employee_id::text,93));
  if tg_op='UPDATE' and old.source='online' and new.source is distinct from 'online' then
    raise exception 'Online randevunun kaynağı değiştirilemez.';
  end if;
  if new.staff_overlap_override and (tg_op='INSERT' or not old.staff_overlap_override or
       (new.employee_id,new.scheduled_at,new.duration_minutes) is distinct from (old.employee_id,old.scheduled_at,old.duration_minutes)) then
    if not exists(select 1 from public.profiles where id=auth.uid() and active and
      (role='manager' or (role='employee' and id=new.employee_id and (tg_op='INSERT' or id=old.employee_id)))) then
      raise exception 'Çakışma istisnası yalnız yetkili personele açıktır.' using errcode='42501';
    end if;
  end if;
  if new.status='cancelled' then return new; end if;
  if exists(select 1 from public.closed_time_slots c where c.employee_id=new.employee_id
    and new.scheduled_at<c.ends_at and new.scheduled_at+make_interval(mins=>new.duration_minutes)>c.starts_at) then
    raise exception 'Bu çalışanın seçilen saati kapalıdır.';
  end if;
  if new.source='online' and not new.staff_overlap_override and exists(
    select 1 from public.appointments a where a.employee_id=new.employee_id and a.id is distinct from new.id
      and a.status<>'cancelled' and a.scheduled_at<new.scheduled_at+make_interval(mins=>new.duration_minutes)
      and a.scheduled_end>new.scheduled_at) then
    raise exception 'Seçilen saat artık müsait değil.';
  end if;
  return new;
end $$;
drop trigger appointments_validate_schedule on public.appointments;
create trigger appointments_validate_schedule before insert or update of scheduled_at,duration_minutes,service_id,employee_id,source,status,staff_overlap_override
on public.appointments for each row execute function private.reject_appointment_during_closed_time();

-- Shared server-side rules for initial booking and token-scoped customer changes.
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
    extract(second from local_start)<>0 or extract(minute from local_start)::integer%15<>0 then raise exception 'Saat müsait değil.'; end if;
end $$;
revoke all on function private.check_online_booking_window(timestamptz,integer) from public,anon,authenticated;
grant execute on function private.check_online_booking_window(timestamptz,integer) to service_role;

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
  -- The existing assignment trigger already informs the assigned employee when actor differs.
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
  perform private.check_online_booking_window(starts,duration);
  select * into tariff from public.services where id=service and active;
  if not found then raise exception 'Hizmet bulunamadı.'; end if;
  if tariff.duration_minutes is null or duration <> tariff.duration_minutes then raise exception 'Hizmet süresi değişti. Müsait saatleri yenileyin.'; end if;
  if not exists(select 1 from public.profiles where id=employee and active and username is distinct from 'salon.modern') then raise exception 'Çalışan bulunamadı.'; end if;
  local_start:=starts at time zone 'Europe/Istanbul'; day:=local_start::date;
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
