-- Keep staff-created appointments from overlapping on the same employee.
-- This mirrors the live function installed as migration 20261112181128.
create or replace function private.reject_appointment_during_closed_time()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  new_busy_end timestamptz;
begin
  -- Serialize writes per employee so concurrent devices cannot both claim a slot.
  perform pg_advisory_xact_lock(hashtextextended(new.employee_id::text, 93));

  if tg_op = 'UPDATE' and old.source = 'online' and new.source is distinct from 'online' then
    raise exception 'Online randevunun kaynağı değiştirilemez.';
  end if;

  if new.source = 'online' and new.staff_overlap_override then
    raise exception 'Online randevuda çakışma istisnası kullanılamaz.';
  end if;

  if new.staff_overlap_override and (
    tg_op = 'INSERT'
    or not old.staff_overlap_override
    or (new.employee_id, new.scheduled_at, new.duration_minutes)
      is distinct from (old.employee_id, old.scheduled_at, old.duration_minutes)
  ) then
    if not exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and active
        and (
          role = 'manager'
          or (role = 'employee' and id = new.employee_id and (tg_op = 'INSERT' or id = old.employee_id))
        )
    ) then
      raise exception 'Çakışma istisnası yalnız yetkili personele açıktır.' using errcode = '42501';
    end if;
  end if;

  if new.status = 'cancelled' then
    return new;
  end if;

  -- Allow non-scheduling edits to legacy records that may already overlap.
  if tg_op = 'UPDATE'
    and old.status <> 'cancelled'
    and (new.employee_id, new.scheduled_at, new.duration_minutes, new.online_protection_minutes, new.source)
      is not distinct from
        (old.employee_id, old.scheduled_at, old.duration_minutes, old.online_protection_minutes, old.source)
  then
    return new;
  end if;

  if new.source = 'online' then
    if not private.online_slot_available(
      new.employee_id,
      new.scheduled_at,
      greatest(new.duration_minutes, coalesce(new.online_protection_minutes, new.duration_minutes)),
      new.id
    ) then
      raise exception 'Seçilen saat artık müsait değil.' using errcode = '23P01';
    end if;
  else
    if exists (
      select 1
      from public.closed_time_slots c
      where c.employee_id = new.employee_id
        and c.starts_at < new.scheduled_at + make_interval(mins => new.duration_minutes)
        and c.ends_at > new.scheduled_at
    ) then
      raise exception 'Bu çalışanın seçilen saati kapalıdır.';
    end if;

    if not new.staff_overlap_override then
      new_busy_end := new.scheduled_at + make_interval(
        mins => greatest(new.duration_minutes, coalesce(new.online_protection_minutes, new.duration_minutes))
      );

      if exists (
        select 1
        from public.appointments a
        where a.id is distinct from new.id
          and a.employee_id = new.employee_id
          and a.status <> 'cancelled'
          and a.scheduled_at < new_busy_end
          and coalesce(
            a.online_reserved_end,
            a.scheduled_end,
            a.scheduled_at + make_interval(
              mins => greatest(a.duration_minutes, coalesce(a.online_protection_minutes, a.duration_minutes))
            )
          ) > new.scheduled_at
      ) then
        raise exception 'Bu çalışan seçilen saat aralığında zaten dolu.' using errcode = '23P01';
      end if;
    end if;

    if exists (
      select 1
      from public.appointments a
      where a.id is distinct from new.id
        and a.status <> 'cancelled'
        and a.scheduled_at = new.scheduled_at
        and (
          a.client_id = new.client_id
          or lower(trim(a.client_name)) = lower(trim(new.client_name))
        )
    ) then
      raise exception 'Bu müşteri için aynı saatte randevu zaten mevcut.' using errcode = '23505';
    end if;
  end if;

  return new;
end
$function$;
