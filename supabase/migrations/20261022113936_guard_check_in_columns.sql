-- RLS limits rows; this also protects the new arrival metadata on direct writes.
create or replace function private.guard_appointment_check_in()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare v_actor uuid:=auth.uid();
begin
  if (new.checked_in_at,new.checked_in_by) is not distinct from
     (old.checked_in_at,old.checked_in_by) then return new; end if;
  if v_actor is null or not private.is_active_salon_user() or
     (not private.is_manager() and old.employee_id is distinct from v_actor) then
    raise exception 'Geldi kaydı için yetki gerekli.' using errcode='42501';
  end if;
  if old.status not in ('confirmed','completed') or
     new.status not in ('confirmed','completed') or
     (new.checked_in_at is null) is distinct from (new.checked_in_by is null) then
    raise exception 'Bu randevunun Geldi bilgisi değiştirilemez.';
  end if;
  if new.checked_in_at is not null and
     (new.scheduled_at>now() or new.checked_in_by is distinct from v_actor or
      new.checked_in_at<now()-interval '1 minute' or
      new.checked_in_at>now()+interval '1 minute') then
    raise exception 'Geldi zamanı ve kaydeden çalışan geçersiz.';
  end if;
  return new;
end $$;
drop trigger if exists appointments_guard_check_in on public.appointments;
create trigger appointments_guard_check_in
before update of checked_in_at,checked_in_by on public.appointments
for each row execute function private.guard_appointment_check_in();
