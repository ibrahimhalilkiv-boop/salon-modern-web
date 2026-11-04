-- Serialize a new linked debt with cancellation of the same appointment.
-- Standalone customer debts remain available.
create or replace function private.reject_debt_for_cancelled_appointment()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_status text;
begin
  if new.appointment_id is null then return new; end if;
  select status into v_status from public.appointments
    where id=new.appointment_id for update;
  if not found then raise exception 'Randevu bulunamadı.' using errcode='23503'; end if;
  if v_status='cancelled' then
    raise exception 'İptal edilmiş randevuya borç eklenemez.' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.reject_debt_for_cancelled_appointment() from public,anon,authenticated;
create trigger customer_debts_reject_cancelled_appointment
before insert or update of appointment_id on public.customer_debts
for each row execute function private.reject_debt_for_cancelled_appointment();
