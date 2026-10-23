-- Friday 12:00-13:30 is unavailable to customers in Europe/Istanbul.
-- Keep existing appointments and staff-created bookings unchanged.
-- The same overlap check is used by availability (including the appointment
-- trigger) and by the final online booking/reschedule validation.

create or replace function private.online_slot_available(
  p_employee uuid, p_start timestamptz, p_duration integer, p_exclude uuid default null
) returns boolean language sql volatile security invoker set search_path=pg_catalog,public as $$
  select p_start is not null and p_duration>0
    and not (
      extract(isodow from (p_start at time zone 'Europe/Istanbul')::date)=5
      and (p_start at time zone 'Europe/Istanbul') <
        (p_start at time zone 'Europe/Istanbul')::date + time '13:30'
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
$$;

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
  if extract(isodow from day)=5 and local_start<day+time '13:30' and
    local_start+make_interval(mins=>p_duration)>day+time '12:00' then
    raise exception 'Cuma 12.00-13.30 saatleri online randevuya kapalıdır.';
  end if;
end $$;
