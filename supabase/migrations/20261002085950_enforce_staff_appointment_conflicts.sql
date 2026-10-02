-- Preserve existing records, override values, RLS and the employee lock.
create or replace function private.reject_appointment_during_closed_time()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.employee_id::text,93));
  if tg_op='UPDATE' and old.source='online' and new.source is distinct from 'online' then
    raise exception 'Online randevunun kaynağı değiştirilemez.';
  end if;
  if new.status='cancelled' then return new; end if;
  -- Financial/customer edits to legacy overlaps must remain possible.
  if tg_op='UPDATE' and old.status<>'cancelled' and
    (new.employee_id,new.scheduled_at,new.duration_minutes) is not distinct from
    (old.employee_id,old.scheduled_at,old.duration_minutes) then
    return new;
  end if;
  if exists(select 1 from public.closed_time_slots c where c.employee_id=new.employee_id
    and new.scheduled_at<c.ends_at
    and new.scheduled_at+make_interval(mins=>new.duration_minutes)>c.starts_at) then
    raise exception 'Bu çalışanın seçilen saati kapalıdır.';
  end if;
  -- Every source is strict; staff_overlap_override is deliberately ignored.
  if exists(select 1 from public.appointments a
    where a.employee_id=new.employee_id and a.id is distinct from new.id
      and a.status<>'cancelled'
      and a.scheduled_at<new.scheduled_at+make_interval(mins=>new.duration_minutes)
      and a.scheduled_end>new.scheduled_at) then
    raise exception 'Bu saat dolu' using errcode='23P01';
  end if;
  return new;
end $$;
