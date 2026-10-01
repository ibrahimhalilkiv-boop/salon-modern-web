-- Permit authorized staff overlaps; preserve online exclusion and closed-time protection.
-- No existing appointment rows are modified.
set lock_timeout = '5s';
alter table public.appointments drop constraint appointments_no_overlap;
alter table public.appointments add constraint appointments_no_overlap
  exclude using gist (employee_id with =, tstzrange(scheduled_at,scheduled_end,'[)') with &&)
  where (status <> 'cancelled' and source = 'online');

create or replace function private.reject_appointment_during_closed_time()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_start timestamp; v_end timestamp;
begin
  -- All writers coordinate on the assigned employee, including manual writers.
  perform pg_advisory_xact_lock(hashtextextended(new.employee_id::text,93));
  if tg_op='UPDATE' and old.source='online' and new.source is distinct from 'online' then
    raise exception 'Online randevunun kaynağı değiştirilemez.' using errcode='P0001';
  end if;
  v_start:=new.scheduled_at at time zone 'Europe/Istanbul';
  v_end:=v_start+make_interval(mins=>coalesce(new.duration_minutes,60));
  if exists(select 1 from public.closed_time_slots c where c.employee_id=new.employee_id
    and v_start<(c.ends_at at time zone 'Europe/Istanbul')
    and v_end>(c.starts_at at time zone 'Europe/Istanbul')) then
    raise exception 'Bu çalışanın seçilen saati kapalıdır. Lütfen başka bir saat seçin.' using errcode='P0001';
  end if;
  -- Online records must never be added over any active appointment, irrespective of source.
  if new.source='online' and new.status<>'cancelled' and exists(
    select 1 from public.appointments a where a.employee_id=new.employee_id
      and a.id is distinct from new.id and a.status<>'cancelled'
      and a.scheduled_at<new.scheduled_at+make_interval(mins=>coalesce(new.duration_minutes,60))
      and a.scheduled_at+make_interval(mins=>coalesce(a.duration_minutes,60))>new.scheduled_at
  ) then
    raise exception 'Bu çalışanın seçilen saatinde çakışan bir randevu var. Lütfen başka bir saat seçin.' using errcode='P0001';
  end if;
  return new;
end $$;
drop trigger appointments_validate_schedule on public.appointments;
create trigger appointments_validate_schedule
before insert or update of scheduled_at,duration_minutes,service_id,employee_id,source,status
on public.appointments for each row execute function private.reject_appointment_during_closed_time();
