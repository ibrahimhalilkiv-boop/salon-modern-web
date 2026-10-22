-- A closed daily cash book must be reconciled before an appointment is removed.
create or replace function public.manager_delete_erroneous_appointment(p_appointment_id uuid,p_reason text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare v_row public.appointments%rowtype;
begin
  if auth.uid() is null or not private.is_manager() then raise exception 'Yalnız yönetici hatalı kaydı silebilir.' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Silme nedeni gereklidir.'; end if;
  select * into v_row from public.appointments where id=p_appointment_id for update;
  if not found then raise exception 'Randevu bulunamadı.'; end if;
  if exists(select 1 from public.customer_debts where appointment_id=p_appointment_id) then
    raise exception 'Borç/ödeme bağlantısı olan randevu kalıcı silinemez.';
  end if;
  if exists(select 1 from public.daily_cash_closings
    where business_date=(v_row.scheduled_at at time zone 'Europe/Istanbul')::date and status='closed') then
    raise exception 'Bu günün kasası kapalı. Hatalı kaydı silmeden önce kasa mutabakatı gerekir.';
  end if;
  delete from public.online_booking_requests where appointment_id=p_appointment_id;
  delete from public.appointments where id=p_appointment_id;
  insert into public.salon_audit_log(actor_id,action,entity_type,entity_id,after_data)
    values(auth.uid(),'delete','appointment',p_appointment_id,jsonb_build_object('reason',left(trim(p_reason),500)));
  return jsonb_build_object('id',p_appointment_id,'deleted',true);
end $$;
revoke all on function public.manager_delete_erroneous_appointment(uuid,text) from public,anon;
grant execute on function public.manager_delete_erroneous_appointment(uuid,text) to authenticated;
