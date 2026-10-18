-- Reuse the salon's existing atomic debt-payment RPC behind MORİ's manager approval.
alter table public.salon_ai_actions drop constraint salon_ai_actions_kind_check;
alter table public.salon_ai_actions add constraint salon_ai_actions_kind_check check
  (kind in ('appointment_create','appointment_move','appointment_cancel','client_create','client_update','expense_create','commission_update','service_price_update','debt_payment'));

create or replace function public.salon_ai_commit_debt_payment(p_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$
declare
  proposal public.salon_ai_actions%rowtype;
  debt public.customer_debts%rowtype;
  paid public.customer_debts%rowtype;
  payment numeric;
  outcome jsonb;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode='42501'; end if;
  select * into proposal from public.salon_ai_actions where id=p_id and user_id=auth.uid() for update;
  if not found or proposal.kind<>'debt_payment' then raise exception 'Ödeme onayı bulunamadı.' using errcode='42501'; end if;
  if proposal.state='applied' then return proposal.result; end if;
  if proposal.state<>'pending' or proposal.expires_at<now() then raise exception 'Ödeme onayı süresi doldu.'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role='manager') then
    raise exception 'Yönetici onayı gerekli.' using errcode='42501';
  end if;
  select * into debt from public.customer_debts where id=(proposal.payload->>'debt_id')::uuid and status='open' for update;
  if not found then raise exception 'Açık borç kaydı bulunamadı.'; end if;
  payment:=(proposal.payload->>'amount')::numeric;
  if payment<=0 or payment>debt.amount then raise exception 'Ödeme tutarı kalan borcu aşamaz.'; end if;
  paid:=public.record_customer_debt_payment(debt.id,payment);
  outcome:=jsonb_build_object('kind','debt_payment','debt_id',paid.id,'client_name',paid.client_name,
    'paid_amount',payment,'remaining_amount',paid.amount,'status',paid.status);
  update public.salon_ai_actions set state='applied',result=outcome,applied_at=now() where id=proposal.id;
  return outcome;
end $$;
revoke all on function public.salon_ai_commit_debt_payment(uuid) from public,anon;
grant execute on function public.salon_ai_commit_debt_payment(uuid) to authenticated;
