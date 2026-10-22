-- A recorded arrival must be undone before the booking can become a no-show.
create or replace function private.prevent_no_show_after_check_in()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $$
begin
  if new.status='no_show' and old.status is distinct from new.status
    and old.checked_in_at is not null then
    raise exception 'Geldi işaretini geri almadan Gelmedi seçilemez.';
  end if;
  return new;
end $$;
drop trigger if exists appointments_prevent_no_show_after_check_in on public.appointments;
create trigger appointments_prevent_no_show_after_check_in
before update of status on public.appointments for each row
execute function private.prevent_no_show_after_check_in();
