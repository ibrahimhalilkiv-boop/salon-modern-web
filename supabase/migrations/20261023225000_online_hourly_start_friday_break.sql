-- Online slots start at HH:00 only; unavailable hours remain visible.
-- Friday 12:00-14:00 is strictly blocked, including overlapping services.
-- Keep the existing service-specific duration and clash protection.

CREATE OR REPLACE FUNCTION private.check_online_booking_window(p_start timestamp with time zone, p_duration integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    extract(second from local_start)<>0 or extract(minute from local_start)::integer<>0 then
    raise exception 'Saat müsait değil.';
  end if;
  if extract(isodow from day)=5 and local_start<day+time '14:00' and
    local_start+make_interval(mins=>p_duration)>day+time '12:00' then
    raise exception 'Cuma 12.00-14.00 saatleri online randevuya kapalıdır.';
  end if;
end $function$


CREATE OR REPLACE FUNCTION private.online_slot_available(p_employee uuid, p_start timestamp with time zone, p_duration integer, p_exclude uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select p_start is not null and p_duration>0
    and not (
      extract(isodow from (p_start at time zone 'Europe/Istanbul')::date)=5
      and (p_start at time zone 'Europe/Istanbul') <
        (p_start at time zone 'Europe/Istanbul')::date + time '14:00'
      and (p_start at time zone 'Europe/Istanbul') + make_interval(mins=>p_duration) >
        (p_start at time zone 'Europe/Istanbul')::date + time '12:00'
    )
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
$function$


CREATE OR REPLACE FUNCTION public.online_booking_slots(p_service uuid, p_day date, p_employee uuid DEFAULT NULL::uuid, p_exclude uuid DEFAULT NULL::uuid, p_duration_override integer DEFAULT NULL::integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  duration integer;
  settings public.booking_settings%rowtype;
  special public.booking_schedule_overrides%rowtype;
  opening time; closing time;
  opening_minute integer; closing_minute integer;
  minute integer; starts timestamptz; local_time timestamp;
  employee_ids uuid[];
  slots jsonb := '[]'::jsonb;
  all_slots jsonb := '[]'::jsonb;
  slot_status text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Yetkisiz işlem.' using errcode='42501'; end if;
  if p_day is null or p_day < (now() at time zone 'Europe/Istanbul')::date or
    p_day > (now() at time zone 'Europe/Istanbul')::date + 90 then
    raise exception 'Geçersiz tarih.';
  end if;
  if p_duration_override is not null and p_exclude is not null then
    duration := p_duration_override;
  else
    duration := private.online_booking_duration(p_service);
  end if;
  if duration is null or duration <= 0 then raise exception 'Hizmet süresi tanımlı değil.'; end if;
  select * into settings from public.booking_settings where id=true;
  select * into special from public.booking_schedule_overrides where schedule_date=p_day;
  if settings.online_booking_enabled=false or special.is_closed=true or
    (special.schedule_date is null and extract(dow from p_day)=0) then
    return jsonb_build_object('durationMinutes',duration,'slots',slots,'allSlots',all_slots);
  end if;
  opening:=coalesce(special.open_time,settings.default_open_time,'09:00'::time);
  closing:=coalesce(special.close_time,settings.default_close_time,'20:00'::time);
  opening_minute := extract(hour from opening)::integer*60 + extract(minute from opening)::integer;
  closing_minute := extract(hour from closing)::integer*60 + extract(minute from closing)::integer;
  -- Show every clock-hour start in the working window, including booked/closed ones.
  for minute in select generate_series(((opening_minute+59)/60)*60,closing_minute-1,60) loop
    local_time := p_day + make_interval(mins=>minute);
    starts := local_time at time zone 'Europe/Istanbul';
    employee_ids := '{}'::uuid[];
    slot_status := 'available';
    if minute+duration > closing_minute or
      (extract(isodow from p_day)=5 and local_time < p_day+time '14:00'
        and local_time+make_interval(mins=>duration) > p_day+time '12:00') then
      slot_status := 'closed';
    elsif starts<=now() or starts>now()+interval '90 days' then
      slot_status := 'past';
    else
      select coalesce(array_agg(p.id order by p.id),'{}'::uuid[]) into employee_ids
      from public.profiles p
      where p.active and p.username is distinct from 'salon.modern'
        and (p_employee is null or p.id=p_employee)
        and private.online_slot_available(p.id,starts,duration,p_exclude);
      if cardinality(employee_ids)=0 then slot_status := 'busy'; end if;
    end if;
    all_slots := all_slots || jsonb_build_array(jsonb_build_object(
      'time',to_char(local_time,'HH24:MI'),'available',slot_status='available','status',slot_status));
    if slot_status='available' then
      slots := slots || jsonb_build_array(jsonb_build_object(
        'time',to_char(local_time,'HH24:MI'),'employeeIds',employee_ids));
    end if;
  end loop;
  return jsonb_build_object('durationMinutes',duration,'slots',slots,'allSlots',all_slots);
end $function$;
