-- The existing debt DELETE trigger treats an open debt as paid. A cancelled
-- appointment has no service debt, so allow its untouched linked debt to go.
create or replace function private.convert_open_debt_delete_to_payment()
returns trigger language plpgsql set search_path=pg_catalog,public,private as $$
begin
  if old.appointment_id is not null and old.status='open'
    and coalesce(old.paid_amount,0)=0 and old.product_sale_id is null
    and not exists(select 1 from public.customer_debt_payments p where p.debt_id=old.id)
    and exists(select 1 from public.appointments a
      where a.id=old.appointment_id and a.status='cancelled') then
    return old;
  end if;

  if old.status='open' and old.amount>0 then
    if not private.is_manager() then
      raise exception 'Bu işlem yalnızca yöneticiler tarafından yapılabilir.' using errcode='42501';
    end if;
    insert into public.customer_debt_payments
      (debt_id,client_id,client_name,amount,paid_at,recorded_by)
    values (old.id,old.client_id,old.client_name,old.amount,now(),auth.uid());
    update public.customer_debts
      set amount=0,paid_amount=paid_amount+old.amount,status='paid',
          paid_at=now(),updated_at=now()
      where id=old.id;
    return null;
  end if;
  return old;
end $$;
revoke all on function private.convert_open_debt_delete_to_payment() from public,anon,authenticated;

create or replace function private.clear_debt_on_appointment_cancellation()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare v_debt public.customer_debts%rowtype;
begin
  if new.status<>'cancelled' or old.status='cancelled' then return new; end if;
  select * into v_debt from public.customer_debts
    where appointment_id=new.id for update;
  if not found then return new; end if;
  if v_debt.status<>'open' or coalesce(v_debt.paid_amount,0)>0
    or v_debt.product_sale_id is not null
    or exists(select 1 from public.customer_debt_payments p where p.debt_id=v_debt.id) then
    raise exception 'Ödeme geçmişi olan randevu iptal edilmeden önce yönetici finans kaydını uzlaştırmalıdır.'
      using errcode='23514';
  end if;
  delete from public.customer_debts where id=v_debt.id;
  if exists(select 1 from public.customer_debts where id=v_debt.id) then
    raise exception 'İptal edilen randevunun borcu kaldırılamadı.';
  end if;
  return new;
end $$;
revoke all on function private.clear_debt_on_appointment_cancellation() from public,anon,authenticated;
drop trigger if exists appointments_clear_debt_on_cancel on public.appointments;
create trigger appointments_clear_debt_on_cancel
after update of status on public.appointments
for each row when (new.status='cancelled' and old.status is distinct from new.status)
execute function private.clear_debt_on_appointment_cancellation();

-- Repair only prior cancellations with an unpaid appointment-only debt.
delete from public.customer_debts d using public.appointments a
where d.appointment_id=a.id and a.status='cancelled' and d.status='open'
  and coalesce(d.paid_amount,0)=0 and d.product_sale_id is null
  and not exists(select 1 from public.customer_debt_payments p where p.debt_id=d.id);
