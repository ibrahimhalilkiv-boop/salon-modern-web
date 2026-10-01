-- Read-only aggregation of the existing daily accounting rules.
create or replace function public.calculate_cash_period_summary(p_start date,p_end date)
returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,public as $$
declare totals jsonb; main_expenses numeric; fund_open numeric; fund_close numeric;
  posted_contribution numeric; fund_expenses numeric; fund_adjustments numeric;
begin
  if not private.is_manager() then
    raise exception 'Bu işlem yalnızca yöneticilere açıktır.' using errcode='42501';
  end if;
  if p_start is null or p_end is null or p_start>p_end then
    raise exception 'Başlangıç ve bitiş tarihlerini kontrol edin.' using errcode='22023';
  end if;
  if p_end-p_start>3660 then
    raise exception 'Tek raporda en fazla 10 yıllık tarih aralığı seçilebilir.' using errcode='22023';
  end if;
  with days as (
    select d::date as day from generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d
  ), summaries as materialized (
    select public.calculate_daily_cash_summary(day) as s from days
  )
  select jsonb_build_object(
    'service_turnover',coalesce(sum((s->>'service_turnover')::numeric),0),
    'product_turnover',coalesce(sum((s->>'product_turnover')::numeric),0),
    'gross_turnover',coalesce(sum((s->>'gross_turnover')::numeric),0),
    'unpaid_debt_amount',coalesce(sum((s->>'unpaid_debt_amount')::numeric),0),
    'debt_collections',coalesce(sum((s->>'debt_collections')::numeric),0),
    'distributable_revenue',coalesce(sum((s->>'distributable_revenue')::numeric),0),
    'daily_expenses',coalesce(sum((s->>'daily_expenses')::numeric),0),
    'commission_total',coalesce(sum((s->>'commission_total')::numeric),0),
    'reserve_contribution',coalesce(sum((s->>'reserve_contribution')::numeric),0),
    'distributable_amount',coalesce(sum((s->>'distributable_amount')::numeric),0),
    'day_count',count(*),
    'closed_days',count(*) filter(where s->>'closing_status'='closed'),
    'dirty_days',count(*) filter(where s->>'closing_status'='dirty')
  ) into totals from summaries;
  select coalesce(sum(amount),0) into main_expenses from public.business_expenses
    where expense_date between p_start and p_end and account_scope='reserve';
  select coalesce(sum(amount) filter(where entry_date<p_start),0),
    coalesce(sum(amount),0),
    coalesce(sum(amount) filter(where entry_date>=p_start and entry_type='contribution'),0),
    -coalesce(sum(amount) filter(where entry_date>=p_start and entry_type='main_expense'),0),
    coalesce(sum(amount) filter(where entry_date>=p_start and entry_type not in ('contribution','main_expense')),0)
    into fund_open,fund_close,posted_contribution,fund_expenses,fund_adjustments
    from public.reserve_ledger where entry_date<=p_end;
  return totals||jsonb_build_object('start_date',p_start,'end_date',p_end,
    'main_expenses',main_expenses,'all_expenses',main_expenses+(totals->>'daily_expenses')::numeric,
    'fund_opening_balance',fund_open,'fund_closing_balance',fund_close,
    'fund_posted_contribution',posted_contribution,'fund_main_expenses',fund_expenses,
    'fund_adjustments',fund_adjustments);
end $$;
revoke all on function public.calculate_cash_period_summary(date,date) from public,anon;
grant execute on function public.calculate_cash_period_summary(date,date) to authenticated;
