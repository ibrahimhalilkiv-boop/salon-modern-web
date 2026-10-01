CREATE OR REPLACE FUNCTION public.calculate_daily_cash_summary(p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_service numeric(12,2); v_product numeric(12,2); v_product_cash numeric(12,2);
  v_service_debt numeric(12,2); v_product_debt numeric(12,2); v_collected numeric(12,2);
  v_expenses numeric(12,2); v_commission numeric(12,2); v_target numeric(12,2); v_cash numeric(12,2);
  v_pre_reserve numeric(12,2); v_contribution numeric(12,2); v_remaining numeric(12,2); v_balance numeric(12,2);
  v_closing public.daily_cash_closings%rowtype;
  v_mode text := 'single_cash';
begin
  if not private.is_manager() then
    raise exception 'Bu işlem yalnızca yöneticilere açıktır.' using errcode='42501';
  end if;

  select coalesce(sum(a.amount),0),
         coalesce(sum(a.debt_original_amount),0),
         coalesce(sum(round(a.amount*p.commission_pct/100.0,2)),0)
    into v_service,v_service_debt,v_commission
    from public.appointments a
    join public.profiles p on p.id=a.employee_id
   where (a.scheduled_at at time zone 'Europe/Istanbul')::date=p_date
     and a.status<>'cancelled';

  select coalesce(sum(total_amount),0),
         coalesce(sum(total_amount) filter(where payment_status='paid'),0),
         coalesce(sum(total_amount) filter(where payment_status='debt'),0)
    into v_product,v_product_cash,v_product_debt
    from public.product_sales
   where (sold_at at time zone 'Europe/Istanbul')::date=p_date
     and status='completed';

  select coalesce(sum(amount),0)
    into v_collected
    from public.customer_debt_payments
   where (paid_at at time zone 'Europe/Istanbul')::date=p_date;

  select coalesce(sum(amount),0)
    into v_expenses
    from public.business_expenses
   where expense_date=p_date
     and account_scope='daily';

  select coalesce((
    select daily_amount
      from public.finance_reserve_rules
     where effective_from<=p_date
     order by effective_from desc
     limit 1
  ),0) into v_target;

  v_cash:=greatest(0,v_service-v_service_debt)+v_product_cash+v_collected;
  v_pre_reserve:=greatest(0,v_cash-v_expenses-v_commission);
  v_contribution:=least(v_target,v_pre_reserve);
  v_remaining:=greatest(0,v_pre_reserve-v_contribution);

  select coalesce(sum(amount),0) into v_balance
    from public.reserve_ledger;

  select * into v_closing
    from public.daily_cash_closings
   where business_date=p_date;

  if found then
    v_mode:=v_closing.accounting_mode;
  end if;

  return jsonb_build_object(
    'business_date',p_date,
    'service_turnover',v_service,
    'product_turnover',v_product,
    'gross_turnover',v_service+v_product,
    'unpaid_debt_amount',v_service_debt+v_product_debt,
    'debt_collections',v_collected,
    'distributable_revenue',v_cash,
    'daily_expenses',v_expenses,
    'commission_total',v_commission,
    'reserve_target',v_target,
    'reserve_contribution',v_contribution,
    'distributable_amount',v_remaining,
    'cash_amount',v_remaining,
    'single_cash_amount',v_remaining,
    'accounting_mode',v_mode,
    'partner_one_amount',case when v_mode='partner_split' then round(v_remaining/2,2) else 0 end,
    'partner_two_amount',case when v_mode='partner_split' then v_remaining-round(v_remaining/2,2) else 0 end,
    'reserve_balance',v_balance,
    'closing_status',coalesce(v_closing.status,'open'),
    'closing_revision',coalesce(v_closing.revision,0)
  );
end;
$function$

