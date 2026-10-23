-- Retire the arrival action while retaining historical arrival timestamps.
revoke execute on function public.set_appointment_check_in(uuid, boolean)
  from public, anon, authenticated, service_role;

create or replace function private.guard_appointment_check_in()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private as $$
begin
  if (new.checked_in_at, new.checked_in_by) is distinct from
     (old.checked_in_at, old.checked_in_by) then
    raise exception 'Geldi işlemi kaldırıldı.' using errcode = '42501';
  end if;
  return new;
end $$;

-- Old arrival flags must not block the remaining Gelmedi action.
drop trigger if exists appointments_prevent_no_show_after_check_in
  on public.appointments;
