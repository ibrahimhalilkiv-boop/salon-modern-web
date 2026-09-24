create or replace function private.convert_open_debt_delete_to_payment()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if current_setting('salon.appointment_debt_cascade', true) = 'on' then
    return old;
  end if;

  if old.status = 'open' and old.amount > 0 then
    if not private.is_manager() then
      raise exception 'Bu işlem yalnızca yöneticiler tarafından yapılabilir.'
        using errcode = '42501';
    end if;

    insert into public.customer_debt_payments(
      debt_id, client_id, client_name, amount, paid_at, recorded_by
    ) values (
      old.id, old.client_id, old.client_name, old.amount, now(), auth.uid()
    );

    update public.customer_debts
       set amount = 0,
           paid_amount = paid_amount + old.amount,
           status = 'paid',
           paid_at = now(),
           updated_at = now()
     where id = old.id;

    return null;
  end if;

  return old;
end;
$$;

create or replace function private.delete_linked_debt_before_appointment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform set_config('salon.appointment_debt_cascade', 'on', true);
  delete from public.customer_debts where appointment_id = old.id;
  perform set_config('salon.appointment_debt_cascade', 'off', true);
  return old;
end;
$$;

revoke all on function private.delete_linked_debt_before_appointment() from public, anon, authenticated;

drop trigger if exists appointments_delete_linked_debt on public.appointments;
create trigger appointments_delete_linked_debt
before delete on public.appointments
for each row execute function private.delete_linked_debt_before_appointment();

create unique index if not exists customer_debts_one_per_appointment_idx
on public.customer_debts(appointment_id)
where appointment_id is not null;
