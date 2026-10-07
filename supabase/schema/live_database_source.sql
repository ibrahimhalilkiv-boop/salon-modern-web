-- Read-only source snapshot recovered from the live Salon Modern database on 2026-10-07.
-- These definitions were missing from the repository migration files available at recovery time.
-- This is not a migration and was not applied to production. Review dependencies and grants before reuse.

-- private.auto_close_daily_cash(p_date date)
CREATE OR REPLACE FUNCTION private.auto_close_daily_cash(p_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_target date := coalesce(p_date, (now() at time zone 'Europe/Istanbul')::date - 1);
  v_actor uuid;
  v_closing_id uuid;
  v_dirty record;
  v_reclosed integer := 0;
begin
  if v_target >= v_today then
    raise exception 'Bugün veya gelecek tarih otomatik kapatılamaz.';
  end if;

  select p.id
    into v_actor
    from public.profiles p
   where p.active
     and p.role = 'manager'
   order by p.id
   limit 1;

  if v_actor is null then
    raise exception 'Otomatik kapanış için aktif yönetici bulunamadı.';
  end if;

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_closing_id := public.close_daily_cash(v_target);

  for v_dirty in
    select business_date
      from public.daily_cash_closings
     where status = 'dirty'
       and business_date < v_target
     order by business_date
  loop
    perform public.close_daily_cash(v_dirty.business_date);
    v_reclosed := v_reclosed + 1;
  end loop;

  return jsonb_build_object(
    'business_date', v_target,
    'closing_id', v_closing_id,
    'actor_id', v_actor,
    'reclosed_dirty_days', v_reclosed
  );
end;
$function$;

-- private.can_manage_all_appointments()
CREATE OR REPLACE FUNCTION private.can_manage_all_appointments()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select (select auth.uid()) is not null
     and exists (
       select 1
       from public.profiles p
       where p.id = (select auth.uid())
         and p.active
         and p.can_manage_all_appointments
     );
$function$;

-- private.create_profile_for_new_user()
CREATE OR REPLACE FUNCTION private.create_profile_for_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  chosen_username text;
  chosen_name text;
begin
  chosen_username := lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)));
  chosen_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), chosen_username);
  insert into public.profiles (id, username, full_name) values (new.id, chosen_username, chosen_name);
  return new;
end;
$function$;

-- private.enqueue_appointment_whatsapp_message()
CREATE OR REPLACE FUNCTION private.enqueue_appointment_whatsapp_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
 if tg_op='INSERT' and coalesce(new.status,'')<>'cancelled' then
   perform private.enqueue_whatsapp_message('appointment_confirmation:'||new.id::text,'appointment_confirmation',new.id,new.client_id);
 elsif tg_op='UPDATE' and old.status is distinct from new.status and new.status='cancelled' then
   perform private.enqueue_whatsapp_message('appointment_cancelled:'||new.id::text,'appointment_cancelled',new.id,new.client_id);
 elsif tg_op='UPDATE' and coalesce(new.status,'')<>'cancelled' and (new.scheduled_at,new.employee_id) is distinct from (old.scheduled_at,old.employee_id) then
   perform private.enqueue_whatsapp_message('appointment_update:'||new.id::text||':'||txid_current()::text,'appointment_update',new.id,new.client_id);
 end if;
 return new;
end;
$function$;

-- private.enqueue_whatsapp_message(p_key text, p_template_key text, p_appointment_id uuid, p_client_id uuid, p_scheduled_for timestamp with time zone)
CREATE OR REPLACE FUNCTION private.enqueue_whatsapp_message(p_key text, p_template_key text, p_appointment_id uuid, p_client_id uuid, p_scheduled_for timestamp with time zone DEFAULT now())
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
 insert into public.whatsapp_message_logs(idempotency_key,template_key,appointment_id,client_id,scheduled_for,next_attempt_at) values(p_key,p_template_key,p_appointment_id,p_client_id,p_scheduled_for,greatest(now(),p_scheduled_for)) on conflict(idempotency_key) do nothing;
end;
$function$;

-- private.initialize_customer_debt_amounts()
CREATE OR REPLACE FUNCTION private.initialize_customer_debt_amounts()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ begin new.paid_amount:=coalesce(new.paid_amount,0); new.original_amount:=coalesce(new.original_amount,new.amount+new.paid_amount); return new; end; $function$;

-- private.is_active_salon_user()
CREATE OR REPLACE FUNCTION private.is_active_salon_user()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.active
  );
$function$;

-- private.is_manager()
CREATE OR REPLACE FUNCTION private.is_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'manager' and p.active
  );
$function$;

-- private.mark_meta_template_pending()
CREATE OR REPLACE FUNCTION private.mark_meta_template_pending()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
 if new.template_key in ('appointment_confirmation','appointment_update','appointment_reminder','appointment_cancelled') and (tg_op='INSERT' or new.content is distinct from old.content) then
   update public.whatsapp_meta_template_mappings set approval_status=case when approval_status='approved' then 'pending' else approval_status end,updated_at=now() where template_key=new.template_key;
 end if;
 return new;
end;
$function$;

-- private.refresh_closed_cash_after_debt_payment()
CREATE OR REPLACE FUNCTION private.refresh_closed_cash_after_debt_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_date date := (new.paid_at at time zone 'Europe/Istanbul')::date;
begin
  if private.is_manager()
     and exists (
       select 1
       from public.daily_cash_closings
       where business_date = v_date
     )
  then
    perform public.close_daily_cash(v_date);
  end if;

  return new;
end;
$function$;

-- private.reject_closed_time_with_appointments()
CREATE OR REPLACE FUNCTION private.reject_closed_time_with_appointments()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if exists (
    select 1
    from public.appointments a
    where a.employee_id = new.employee_id
      and a.scheduled_at < new.ends_at
      and a.scheduled_at + make_interval(mins => coalesce(a.duration_minutes, 60)) > new.starts_at
  ) then
    raise exception 'Bu zaman aralığında seçili çalışanın kayıtlı randevusu var. Önce randevuyu başka bir saate taşıyın.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

-- private.set_salon_actor()
CREATE OR REPLACE FUNCTION private.set_salon_actor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor uuid := (select auth.uid());
begin
  if tg_table_name = 'appointments' then
    if tg_op = 'INSERT' then
      new.created_by := coalesce(new.created_by, v_actor);
    else
      new.updated_by := coalesce(v_actor, new.updated_by);
    end if;
  elsif tg_table_name = 'clients' then
    if tg_op = 'INSERT' then
      new.created_by := coalesce(new.created_by, v_actor);
      new.updated_by := coalesce(new.updated_by, v_actor);
    else
      new.updated_by := coalesce(v_actor, new.updated_by);
      if new.active is false and old.active is true then
        new.deleted_at := coalesce(new.deleted_at, now());
        new.deleted_by := coalesce(new.deleted_by, v_actor);
      elsif new.active is true and old.active is false then
        new.deleted_at := null;
        new.deleted_by := null;
      end if;
    end if;
  end if;
  return new;
end;
$function$;

-- private.set_updated_at()
CREATE OR REPLACE FUNCTION private.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

-- private.sync_recurring_appointment_tariff()
CREATE OR REPLACE FUNCTION private.sync_recurring_appointment_tariff()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.price is distinct from old.price then
    update public.appointments
       set amount = new.price,
           tariff_price_snapshot = new.price
     where service_id = new.id
       and recurrence_group_id is not null
       and scheduled_at >= now()
       and status <> 'cancelled'
       and amount is not distinct from tariff_price_snapshot;
  end if;
  return new;
end;
$function$;

-- private.update_client_from_appointment()
CREATE OR REPLACE FUNCTION private.update_client_from_appointment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.client_id is not null then
    update public.clients
    set
      phone = case
        when nullif(btrim(phone), '') is null
         and nullif(btrim(new.client_phone), '') is not null
          then btrim(new.client_phone)
        else phone
      end,
      last_service_id = case
        when last_appointment_at is null or new.scheduled_at >= last_appointment_at
          then new.service_id
        else last_service_id
      end,
      last_employee_id = case
        when last_appointment_at is null or new.scheduled_at >= last_appointment_at
          then new.employee_id
        else last_employee_id
      end,
      last_appointment_at = case
        when last_appointment_at is null or new.scheduled_at >= last_appointment_at
          then new.scheduled_at
        else last_appointment_at
      end,
      updated_at = now()
    where id = new.client_id;
  end if;
  return new;
end;
$function$;

-- private.v230_audit_finance_row()
CREATE OR REPLACE FUNCTION private.v230_audit_finance_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_entity text;
begin v_entity:=case tg_table_name when 'products' then 'product' when 'product_sales' then 'product_sale' when 'inventory_movements' then 'inventory_movement' when 'business_expenses' then 'business_expense' when 'cash_adjustments' then 'cash_adjustment' when 'finance_reserve_rules' then 'finance_reserve_rule' when 'daily_cash_closings' then 'daily_cash_closing' when 'salon_partners' then 'salon_partner' when 'reserve_ledger' then 'reserve_ledger' end;
insert into public.salon_audit_log(actor_id,action,entity_type,entity_id,before_data,after_data) values(auth.uid(),lower(tg_op),v_entity,case when tg_op='DELETE' then old.id else new.id end,case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end); return coalesce(new,old); end; $function$;

-- private.v230_capture_debt_snapshot()
CREATE OR REPLACE FUNCTION private.v230_capture_debt_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.appointment_id is not null then
    update public.appointments
    set debt_original_amount = greatest(debt_original_amount, new.original_amount), updated_at = now()
    where id = new.appointment_id;
  end if;
  return new;
end;
$function$;

-- private.v230_dirty_appointment_day()
CREATE OR REPLACE FUNCTION private.v230_dirty_appointment_day()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if tg_op <> 'INSERT' then perform private.v230_mark_closing_dirty((old.scheduled_at at time zone 'Europe/Istanbul')::date); end if;
  if tg_op <> 'DELETE' then perform private.v230_mark_closing_dirty((new.scheduled_at at time zone 'Europe/Istanbul')::date); end if;
  return coalesce(new, old);
end; $function$;

-- private.v230_dirty_expense_day()
CREATE OR REPLACE FUNCTION private.v230_dirty_expense_day()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if tg_op <> 'INSERT' then perform private.v230_mark_closing_dirty(old.expense_date); end if;
  if tg_op <> 'DELETE' then perform private.v230_mark_closing_dirty(new.expense_date); end if;
  return coalesce(new, old);
end; $function$;

-- private.v230_dirty_payment_day()
CREATE OR REPLACE FUNCTION private.v230_dirty_payment_day()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if tg_op <> 'INSERT' then perform private.v230_mark_closing_dirty((old.paid_at at time zone 'Europe/Istanbul')::date); end if;
  if tg_op <> 'DELETE' then perform private.v230_mark_closing_dirty((new.paid_at at time zone 'Europe/Istanbul')::date); end if;
  return coalesce(new, old);
end; $function$;

-- private.v230_dirty_sale_day()
CREATE OR REPLACE FUNCTION private.v230_dirty_sale_day()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if tg_op <> 'INSERT' then perform private.v230_mark_closing_dirty((old.sold_at at time zone 'Europe/Istanbul')::date); end if;
  if tg_op <> 'DELETE' then perform private.v230_mark_closing_dirty((new.sold_at at time zone 'Europe/Istanbul')::date); end if;
  return coalesce(new, old);
end; $function$;

-- private.v230_mark_closing_dirty(p_date date)
CREATE OR REPLACE FUNCTION private.v230_mark_closing_dirty(p_date date)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  update public.daily_cash_closings set status = 'dirty', updated_at = now()
  where business_date = p_date and status = 'closed';
$function$;

-- private.v230_sync_reserve_expense()
CREATE OR REPLACE FUNCTION private.v230_sync_reserve_expense()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if tg_op = 'DELETE' then
    delete from public.reserve_ledger where source_expense_id = old.id;
    return old;
  end if;
  if new.account_scope = 'reserve' then
    insert into public.reserve_ledger(entry_date, entry_type, amount, source_expense_id, note, created_by)
    values(new.expense_date, 'main_expense', -new.amount, new.id,
      concat(new.category, case when btrim(new.description) <> '' then ' · ' || new.description else '' end), new.created_by)
    on conflict (source_expense_id) where source_expense_id is not null
    do update set entry_date = excluded.entry_date, amount = excluded.amount, note = excluded.note;
  else
    delete from public.reserve_ledger where source_expense_id = new.id;
  end if;
  return new;
end;
$function$;

-- private.v230_touch_updated_at()
CREATE OR REPLACE FUNCTION private.v230_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

-- private.v230_validate_reserve_rule()
CREATE OR REPLACE FUNCTION private.v230_validate_reserve_rule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_last_closed date;
begin
  select max(business_date) into v_last_closed
  from public.daily_cash_closings where status='closed';
  if v_last_closed is not null and new.effective_from <= v_last_closed then
    raise exception 'Yeni fon ayarı en son kapatılan günden (%) sonra başlamalıdır.',v_last_closed;
  end if;
  return new;
end;
$function$;

-- private.v233_dirty_adjustment_day()
CREATE OR REPLACE FUNCTION private.v233_dirty_adjustment_day()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin if tg_op <> 'INSERT' then perform private.v230_mark_closing_dirty(old.entry_date); end if; if tg_op <> 'DELETE' then perform private.v230_mark_closing_dirty(new.entry_date); end if; return coalesce(new,old); end; $function$;

-- private.v233_prepare_cash_adjustment()
CREATE OR REPLACE FUNCTION private.v233_prepare_cash_adjustment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin new.updated_at:=now(); new.updated_by:=auth.uid(); if tg_op='INSERT' then new.created_by:=auth.uid(); end if; return new; end; $function$;

-- private.write_salon_audit_log()
CREATE OR REPLACE FUNCTION private.write_salon_audit_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_entity_type text;
  v_entity_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  v_entity_type := case tg_table_name
    when 'appointments' then 'appointment'
    when 'clients' then 'client'
  end;
  v_entity_id := case when tg_op = 'DELETE' then old.id else new.id end;

  if tg_op in ('UPDATE', 'DELETE') then
    v_before := to_jsonb(old) - array['client_phone'];
    if tg_table_name = 'clients' then
      v_before := v_before - array['phone'];
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_after := to_jsonb(new) - array['client_phone'];
    if tg_table_name = 'clients' then
      v_after := v_after - array['phone'];
    end if;
  end if;

  insert into public.salon_audit_log (
    actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    v_actor, lower(tg_op), v_entity_type, v_entity_id, v_before, v_after
  );

  return coalesce(new, old);
end;
$function$;

-- public.add_reserve_adjustment(p_entry_date date, p_amount numeric, p_note text, p_opening boolean)
CREATE OR REPLACE FUNCTION public.add_reserve_adjustment(p_entry_date date, p_amount numeric, p_note text, p_opening boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_id uuid;
begin
  if not private.is_manager() then raise exception 'Bu işlem yalnızca yöneticilere açıktır.' using errcode='42501'; end if;
  if p_amount is null or p_amount=0 then raise exception 'Fon tutarı sıfır olamaz.'; end if;
  insert into public.reserve_ledger(entry_date,entry_type,amount,note)
    values(p_entry_date,case when p_opening then 'opening' else 'adjustment' end,p_amount,nullif(btrim(p_note),'')) returning id into v_id;
  return v_id;
end; $function$;

-- public.approve_online_booking_request(p_request_id uuid)
CREATE OR REPLACE FUNCTION public.approve_online_booking_request(p_request_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_request public.online_booking_requests%rowtype;
  v_client_id uuid;
  v_appointment_id uuid;
begin
  if not private.is_manager() then
    raise exception 'Bu iÅŸlem yalnÄ±zca yÃ¶neticilere aÃ§Ä±ktÄ±r.' using errcode = '42501';
  end if;
  select * into v_request from public.online_booking_requests where id=p_request_id for update;
  if not found then raise exception 'Randevu talebi bulunamadÄ±.'; end if;
  if v_request.status <> 'pending' then raise exception 'Bu talep daha Ã¶nce sonuÃ§landÄ±rÄ±lmÄ±ÅŸ.'; end if;

  select id into v_client_id from public.clients
  where regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g') in
    (v_request.phone_normalized, substring(v_request.phone_normalized from 2), '0'||substring(v_request.phone_normalized from 3))
  order by updated_at desc limit 1;
  if v_client_id is null then
    select id into v_client_id from public.clients where lower(trim(full_name))=lower(trim(v_request.client_name)) limit 1;
  end if;
  if v_client_id is null then
    insert into public.clients(full_name,phone) values(trim(v_request.client_name),v_request.phone) returning id into v_client_id;
  else
    update public.clients set phone=coalesce(nullif(phone,''),v_request.phone),updated_at=now() where id=v_client_id;
  end if;

  insert into public.appointments(client_id,client_name,client_phone,service_id,service_name,amount,
    employee_id,scheduled_at,duration_minutes,note,created_by,status,source)
  values(v_client_id,trim(v_request.client_name),v_request.phone,v_request.service_id,v_request.service_name,
    v_request.amount,v_request.employee_id,v_request.scheduled_at,30,'MÃ¼ÅŸteri Ã§evrim iÃ§i talebi',auth.uid(),'confirmed','online')
  returning id into v_appointment_id;

  update public.online_booking_requests set status='approved',appointment_id=v_appointment_id,
    reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=p_request_id;
  return v_appointment_id;
exception when exclusion_violation then
  raise exception 'SeÃ§ilen saat artÄ±k dolu. Talebi reddedip mÃ¼ÅŸteriden yeni saat isteyin.' using errcode='23P01';
end;
$function$;

-- public.assistant_execute_pending_action(p_action_id uuid)
CREATE OR REPLACE FUNCTION public.assistant_execute_pending_action(p_action_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_action public.assistant_pending_actions%rowtype;
  v_conversation public.assistant_conversations%rowtype;
  v_client public.clients%rowtype;
  v_service public.services%rowtype;
  v_employee public.profiles%rowtype;
  v_appointment public.appointments%rowtype;
  v_target_at timestamptz;
  v_target_employee uuid;
  v_result_id uuid;
begin
  select * into v_action
  from public.assistant_pending_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'Bekleyen işlem bulunamadı.' using errcode = 'P0002';
  end if;

  if v_action.status = 'executed' and nullif(v_action.payload->>'result_appointment_id', '') is not null then
    return jsonb_build_object(
      'ok', true,
      'appointment_id', v_action.payload->>'result_appointment_id',
      'idempotent', true
    );
  end if;

  if v_action.status <> 'pending' then
    raise exception 'İşlem artık beklemede değil.' using errcode = 'P0001';
  end if;
  if v_action.expires_at is not null and v_action.expires_at <= now() then
    update public.assistant_pending_actions set status = 'expired', updated_at = now() where id = v_action.id;
    raise exception 'İşlem onay süresi doldu.' using errcode = 'P0001';
  end if;
  if coalesce((v_action.payload->>'confirmation_ready')::boolean, false) is not true then
    raise exception 'Tarih, saat, çalışan ve hizmet kesinleşmedi.' using errcode = 'P0001';
  end if;

  select * into strict v_conversation
  from public.assistant_conversations
  where id = v_action.conversation_id
    and channel = 'whatsapp'
    and status = 'bot';

  if v_conversation.client_id is null then
    raise exception 'Randevu işlemi için müşteri eşleşmesi gerekli.' using errcode = 'P0001';
  end if;
  select * into strict v_client from public.clients where id = v_conversation.client_id and active;

  if v_action.action_type = 'create_appointment' then
    if (v_action.payload->>'client_id')::uuid is distinct from v_client.id then
      raise exception 'Müşteri eşleşmesi değişti.' using errcode = 'P0001';
    end if;
    select * into strict v_service
    from public.services
    where id = (v_action.payload->>'service_id')::uuid and active;
    select * into strict v_employee
    from public.profiles
    where id = (v_action.payload->>'employee_id')::uuid and active;
    v_target_at := (v_action.payload->>'scheduled_at')::timestamptz;
    if v_target_at <= now() then
      raise exception 'Geçmiş bir saate randevu oluşturulamaz.' using errcode = 'P0001';
    end if;

    insert into public.appointments (
      client_id, client_name, client_phone, service_id, service_name, amount,
      employee_id, scheduled_at, duration_minutes, note, status, source,
      created_by, updated_by
    ) values (
      v_client.id, v_client.full_name, v_client.phone, v_service.id, v_service.name, v_service.price,
      v_employee.id, v_target_at, v_service.duration_minutes,
      'WhatsApp Dijital Çalışan V3.1', 'confirmed', 'online', null, null
    ) returning id into v_result_id;

  elsif v_action.action_type = 'reschedule_appointment' then
    select * into strict v_appointment
    from public.appointments
    where id = (v_action.payload->>'appointment_id')::uuid
      and client_id = v_client.id
      and status <> 'cancelled'
    for update;

    if nullif(v_action.payload->>'expected_scheduled_at', '') is not null
       and v_appointment.scheduled_at is distinct from (v_action.payload->>'expected_scheduled_at')::timestamptz then
      raise exception 'Randevu başka bir işlemle değiştirildi; yeniden kontrol edin.' using errcode = 'P0001';
    end if;
    v_target_at := (v_action.payload->>'scheduled_at')::timestamptz;
    v_target_employee := coalesce(nullif(v_action.payload->>'employee_id', '')::uuid, v_appointment.employee_id);
    perform 1 from public.profiles where id = v_target_employee and active;
    if not found then raise exception 'Hedef çalışan aktif değil.' using errcode = 'P0001'; end if;
    if v_target_at <= now() then raise exception 'Randevu geçmiş bir saate taşınamaz.' using errcode = 'P0001'; end if;

    update public.appointments
       set scheduled_at = v_target_at,
           employee_id = v_target_employee,
           updated_by = null
     where id = v_appointment.id
     returning id into v_result_id;

  elsif v_action.action_type = 'cancel_appointment' then
    select * into strict v_appointment
    from public.appointments
    where id = (v_action.payload->>'appointment_id')::uuid
      and client_id = v_client.id
      and status <> 'cancelled'
    for update;

    if nullif(v_action.payload->>'expected_scheduled_at', '') is not null
       and v_appointment.scheduled_at is distinct from (v_action.payload->>'expected_scheduled_at')::timestamptz then
      raise exception 'Randevu başka bir işlemle değiştirildi; yeniden kontrol edin.' using errcode = 'P0001';
    end if;
    update public.appointments set status = 'cancelled', updated_by = null
    where id = v_appointment.id returning id into v_result_id;
  else
    raise exception 'Bu işlem türü randevu yürütücüsünde desteklenmiyor.' using errcode = 'P0001';
  end if;

  update public.assistant_pending_actions
     set status = 'executed',
         payload = payload || jsonb_build_object('result_appointment_id', v_result_id),
         updated_at = now()
   where id = v_action.id;

  return jsonb_build_object('ok', true, 'appointment_id', v_result_id, 'idempotent', false);
exception
  when no_data_found then
    raise exception 'İşlem için gerekli kayıt bulunamadı veya aktif değil.' using errcode = 'P0002';
end;
$function$;

-- public.assistant_lookup_client_context_by_phone(p_phone text)
CREATE OR REPLACE FUNCTION public.assistant_lookup_client_context_by_phone(p_phone text)
 RETURNS TABLE(client_id uuid, full_name text, phone text, note text, visit_count integer, last_visit_date date, average_visit_days integer, expected_next_visit_date date, last_service_id uuid, last_service_name text, last_employee_id uuid, last_employee_name text, preferred_employee_id uuid, preferred_employee_name text, preferred_service_id uuid, preferred_service_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select
    c.id,
    c.full_name,
    c.phone,
    c.note,
    coalesce(i.visit_count, 0),
    i.last_visit_date,
    i.average_visit_days,
    i.expected_next_visit_date,
    c.last_service_id,
    last_service.name,
    c.last_employee_id,
    last_employee.full_name,
    i.preferred_employee_id,
    preferred_employee.full_name,
    i.preferred_service_id,
    i.preferred_service_name
  from public.clients c
  left join public.client_visit_intelligence i on i.client_id = c.id
  left join public.services last_service on last_service.id = c.last_service_id
  left join public.profiles last_employee on last_employee.id = c.last_employee_id
  left join public.profiles preferred_employee on preferred_employee.id = i.preferred_employee_id
  where c.active
    and private.normalize_tr_phone(c.phone) = private.normalize_tr_phone(p_phone)
  order by i.last_visit_date desc nulls last, c.created_at desc;
$function$;

-- public.assistant_lookup_clients_by_phone(p_phone text)
CREATE OR REPLACE FUNCTION public.assistant_lookup_clients_by_phone(p_phone text)
 RETURNS TABLE(client_id uuid, full_name text, phone text, note text, visit_count integer, last_visit_date date, average_visit_days integer, expected_next_visit_date date, preferred_employee_id uuid, preferred_employee_name text, preferred_service_id uuid, preferred_service_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select
    c.id,
    c.full_name,
    c.phone,
    c.note,
    coalesce(i.visit_count, 0),
    i.last_visit_date,
    i.average_visit_days,
    i.expected_next_visit_date,
    i.preferred_employee_id,
    p.full_name,
    i.preferred_service_id,
    i.preferred_service_name
  from public.clients c
  left join public.client_visit_intelligence i on i.client_id = c.id
  left join public.profiles p on p.id = i.preferred_employee_id
  where c.active
    and private.normalize_tr_phone(c.phone) = private.normalize_tr_phone(p_phone)
  order by i.last_visit_date desc nulls last, c.created_at desc;
$function$;

-- public.calculate_daily_cash_summary(p_date date)
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
$function$;

-- public.close_daily_cash()
CREATE OR REPLACE FUNCTION public.close_daily_cash()
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.close_daily_cash((now() at time zone 'Europe/Istanbul')::date);
$function$;

-- public.close_daily_cash(p_date date)
CREATE OR REPLACE FUNCTION public.close_daily_cash(p_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v jsonb;
  v_closing_id uuid;
  v_revision integer;
  v_mode text;
  v_partner record;
  v_index integer:=0;
  v_count integer;
  v_paid numeric(12,2):=0;
  v_amount numeric(12,2);
begin
  if not private.is_manager() then
    raise exception 'Bu işlem yalnızca yöneticilere açıktır.' using errcode='42501';
  end if;

  select accounting_mode,coalesce(revision,0)+1
    into v_mode,v_revision
    from public.daily_cash_closings
   where business_date=p_date
   for update;

  v_mode:=coalesce(v_mode,'single_cash');
  v_revision:=coalesce(v_revision,1);
  v:=public.calculate_daily_cash_summary(p_date);

  insert into public.daily_cash_closings(
    business_date,service_turnover,product_turnover,gross_turnover,
    unpaid_debt_amount,debt_collections,distributable_revenue,
    daily_expenses,commission_total,reserve_target,reserve_contribution,
    distributable_amount,accounting_mode,status,revision,closed_by,closed_at
  )
  values(
    p_date,
    (v->>'service_turnover')::numeric,
    (v->>'product_turnover')::numeric,
    (v->>'gross_turnover')::numeric,
    (v->>'unpaid_debt_amount')::numeric,
    (v->>'debt_collections')::numeric,
    (v->>'distributable_revenue')::numeric,
    (v->>'daily_expenses')::numeric,
    (v->>'commission_total')::numeric,
    (v->>'reserve_target')::numeric,
    (v->>'reserve_contribution')::numeric,
    (v->>'distributable_amount')::numeric,
    v_mode,'closed',v_revision,auth.uid(),now()
  )
  on conflict(business_date) do update set
    service_turnover=excluded.service_turnover,
    product_turnover=excluded.product_turnover,
    gross_turnover=excluded.gross_turnover,
    unpaid_debt_amount=excluded.unpaid_debt_amount,
    debt_collections=excluded.debt_collections,
    distributable_revenue=excluded.distributable_revenue,
    daily_expenses=excluded.daily_expenses,
    commission_total=excluded.commission_total,
    reserve_target=excluded.reserve_target,
    reserve_contribution=excluded.reserve_contribution,
    distributable_amount=excluded.distributable_amount,
    accounting_mode=public.daily_cash_closings.accounting_mode,
    status='closed',
    revision=excluded.revision,
    closed_by=auth.uid(),
    closed_at=now()
  returning id,accounting_mode into v_closing_id,v_mode;

  if (v->>'reserve_contribution')::numeric > 0 then
    insert into public.reserve_ledger(
      entry_date,entry_type,amount,source_closing_id,note
    )
    values(
      p_date,'contribution',(v->>'reserve_contribution')::numeric,
      v_closing_id,'Günlük ana gider fonu'
    )
    on conflict(source_closing_id) where source_closing_id is not null
    do update set
      entry_date=excluded.entry_date,
      amount=excluded.amount,
      note=excluded.note;
  else
    delete from public.reserve_ledger
     where source_closing_id=v_closing_id;
  end if;

  if v_mode='partner_split' then
    select count(*) into v_count
      from public.salon_partners
     where active;

    if v_count<>2 or (select coalesce(sum(share_pct),0) from public.salon_partners where active)<>100 then
      raise exception 'Geçmiş ortaklı kapanış için iki aktif ortağın pay toplamı %%100 olmalıdır.';
    end if;

    delete from public.partner_allocations where closing_id=v_closing_id;
    for v_partner in
      select profile_id,share_pct
        from public.salon_partners
       where active
       order by created_at,profile_id
    loop
      v_index:=v_index+1;
      if v_index=v_count then
        v_amount:=(v->>'distributable_amount')::numeric-v_paid;
      else
        v_amount:=round((v->>'distributable_amount')::numeric*v_partner.share_pct/100.0,2);
        v_paid:=v_paid+v_amount;
      end if;
      insert into public.partner_allocations(closing_id,partner_id,share_pct,amount)
      values(v_closing_id,v_partner.profile_id,v_partner.share_pct,v_amount);
    end loop;
  else
    delete from public.partner_allocations where closing_id=v_closing_id;
  end if;

  return v_closing_id;
end;
$function$;

-- public.create_product(p_name text, p_sale_price numeric, p_initial_stock integer)
CREATE OR REPLACE FUNCTION public.create_product(p_name text, p_sale_price numeric, p_initial_stock integer DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_id uuid;
begin
  if not private.is_manager() then
    raise exception 'Bu işlem yalnızca yöneticilere açıktır.' using errcode='42501';
  end if;
  if nullif(btrim(p_name),'') is null then raise exception 'Ürün adı boş olamaz.'; end if;
  if p_sale_price is null or p_sale_price < 0 then raise exception 'Satış fiyatı geçersiz.'; end if;
  if p_initial_stock is null or p_initial_stock < 0 then raise exception 'İlk stok geçersiz.'; end if;
  insert into public.products(name,sale_price,stock_quantity)
  values(btrim(p_name),p_sale_price,0) returning id into v_id;
  if p_initial_stock > 0 then
    perform public.record_inventory_movement(v_id,p_initial_stock,'opening',now(),'İlk stok');
  end if;
  return v_id;
end;
$function$;

-- public.create_product_sale(p_sold_at timestamp with time zone, p_items jsonb)
CREATE OR REPLACE FUNCTION public.create_product_sale(p_sold_at timestamp with time zone, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_sale_id uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_total numeric(12,2) := 0;
begin
  if not private.is_manager() then raise exception 'Bu işlem yalnızca yöneticilere açıktır.' using errcode='42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Satış sepeti boş olamaz.'; end if;
  insert into public.product_sales(sold_at, total_amount) values(coalesce(p_sold_at, now()), 0) returning id into v_sale_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Ürün adedi geçersiz.'; end if;
    select * into v_product from public.products where id = (v_item->>'product_id')::uuid and active for update;
    if not found then raise exception 'Ürün bulunamadı veya pasif.'; end if;
    if v_product.stock_quantity < v_quantity then raise exception '% için stok yetersiz. Mevcut: %', v_product.name, v_product.stock_quantity; end if;
    update public.products set stock_quantity = stock_quantity - v_quantity where id = v_product.id;
    insert into public.product_sale_items(sale_id, product_id, product_name, quantity, unit_price)
      values(v_sale_id, v_product.id, v_product.name, v_quantity, v_product.sale_price);
    insert into public.inventory_movements(product_id, movement_type, quantity_delta, movement_at, product_sale_id, note)
      values(v_product.id, 'sale', -v_quantity, coalesce(p_sold_at, now()), v_sale_id, 'Ürün satışı');
    v_total := v_total + (v_quantity * v_product.sale_price);
  end loop;
  update public.product_sales set total_amount = v_total where id = v_sale_id;
  return v_sale_id;
end; $function$;

-- public.create_product_sale_with_debt(p_sold_at timestamp with time zone, p_items jsonb, p_client_id uuid, p_write_debt boolean)
CREATE OR REPLACE FUNCTION public.create_product_sale_with_debt(p_sold_at timestamp with time zone, p_items jsonb, p_client_id uuid DEFAULT NULL::uuid, p_write_debt boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_sale_id uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_client public.clients%rowtype;
  v_quantity integer;
  v_unit_price numeric(12,2);
  v_total numeric(12,2) := 0;
  v_sold_at timestamptz := coalesce(p_sold_at, now());
begin
  if not private.is_manager() then
    raise exception 'Bu işlem yalnızca yöneticilere açıktır.' using errcode='42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Satış sepeti boş olamaz.';
  end if;
  if p_client_id is not null then
    select * into v_client from public.clients where id = p_client_id and active;
    if not found then raise exception 'Müşteri bulunamadı veya pasif.'; end if;
  elsif p_write_debt then
    raise exception 'Borca yazılacak satış için müşteri seçmelisiniz.';
  end if;

  insert into public.product_sales(sold_at,total_amount,client_id,client_name_snapshot,payment_status)
  values(v_sold_at,0,p_client_id,v_client.full_name,case when p_write_debt then 'debt' else 'paid' end)
  returning id into v_sale_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Ürün adedi geçersiz.'; end if;
    select * into v_product
      from public.products
      where id = (v_item->>'product_id')::uuid and active
      for update;
    if not found then raise exception 'Ürün bulunamadı veya pasif.'; end if;
    if v_product.stock_quantity < v_quantity then
      raise exception '% için stok yetersiz. Mevcut: %',v_product.name,v_product.stock_quantity;
    end if;
    v_unit_price := case
      when v_item ? 'unit_price' then round((v_item->>'unit_price')::numeric,2)
      else v_product.sale_price
    end;
    if v_unit_price is null or v_unit_price < 0 then raise exception 'Satış fiyatı geçersiz.'; end if;
    update public.products set stock_quantity = stock_quantity - v_quantity where id = v_product.id;
    insert into public.product_sale_items(sale_id,product_id,product_name,quantity,unit_price)
      values(v_sale_id,v_product.id,v_product.name,v_quantity,v_unit_price);
    insert into public.inventory_movements(product_id,movement_type,quantity_delta,movement_at,product_sale_id,note)
      values(v_product.id,'sale',-v_quantity,v_sold_at,v_sale_id,'Ürün satışı');
    v_total := v_total + (v_quantity * v_unit_price);
  end loop;

  if p_write_debt and v_total <= 0 then raise exception 'Sıfır tutarlı satış borca yazılamaz.'; end if;
  update public.product_sales set total_amount = v_total where id = v_sale_id;

  if p_write_debt then
    insert into public.customer_debts(
      product_sale_id,appointment_id,client_id,client_name,amount,original_amount,paid_amount,debt_date,status
    ) values(
      v_sale_id,null,v_client.id,v_client.full_name,v_total,v_total,0,
      (v_sold_at at time zone 'Europe/Istanbul')::date,'open'
    );
  end if;
  return v_sale_id;
end;
$function$;

-- public.deactivate_push_device(p_device_id text)
CREATE OR REPLACE FUNCTION public.deactivate_push_device(p_device_id text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  update public.push_devices
     set active = false,
         updated_at = now()
   where device_id = trim(p_device_id)
     and user_id = (select auth.uid());
$function$;

-- public.delete_product_safe(p_product_id uuid)
CREATE OR REPLACE FUNCTION public.delete_product_safe(p_product_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_product public.products%rowtype;
  v_has_history boolean;
begin
  if not private.is_manager() then
    raise exception 'Bu işlem yalnızca yöneticilere açıktır.' using errcode = '42501';
  end if;

  select *
    into v_product
    from public.products
   where id = p_product_id
   for update;

  if not found then
    raise exception 'Ürün bulunamadı.';
  end if;

  select
    exists(select 1 from public.product_sale_items where product_id = p_product_id)
    or exists(select 1 from public.inventory_movements where product_id = p_product_id)
    into v_has_history;

  if v_has_history then
    update public.products set active = false where id = p_product_id;
    return 'deactivated';
  end if;

  delete from public.products where id = p_product_id;
  return 'deleted';
end;
$function$;

-- public.enforce_appointment_creator_from_auth()
CREATE OR REPLACE FUNCTION public.enforce_appointment_creator_from_auth()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  -- For normal authenticated app inserts, the database session is the source
  -- of truth. This prevents stale/local frontend user ids from misattributing
  -- the appointment creator. Server/service flows without an auth uid keep
  -- their explicitly supplied creator value.
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$function$;

-- public.get_daily_expense_details(p_date date)
CREATE OR REPLACE FUNCTION public.get_daily_expense_details(p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if not private.is_manager() then
    raise exception 'Bu işlem yalnızca yöneticilere açıktır.' using errcode='42501';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'category', e.category,
        'description', e.description,
        'amount', e.amount,
        'created_at', e.created_at
      )
      order by e.created_at, e.id
    )
    from public.business_expenses e
    where e.expense_date = p_date
      and e.account_scope = 'daily'
  ), '[]'::jsonb);
end;
$function$;

-- public.record_customer_debt_payment(p_debt_id uuid, p_amount numeric)
CREATE OR REPLACE FUNCTION public.record_customer_debt_payment(p_debt_id uuid, p_amount numeric)
 RETURNS customer_debts
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_debt public.customer_debts; v_payment numeric;
begin
 if not (select private.is_manager()) then raise exception 'Bu işlem yalnızca yöneticiler tarafından yapılabilir.'; end if;
 select * into v_debt from public.customer_debts where id=p_debt_id and status='open' for update;
 if v_debt.id is null then raise exception 'Açık borç kaydı bulunamadı.'; end if;
 v_payment:=round(coalesce(p_amount,0),2);
 if v_payment<=0 or v_payment>v_debt.amount then raise exception 'Ödeme tutarı 0 ile kalan borç arasında olmalıdır.'; end if;
 insert into public.customer_debt_payments(debt_id,client_id,client_name,amount,recorded_by) values(v_debt.id,v_debt.client_id,v_debt.client_name,v_payment,auth.uid());
 update public.customer_debts set amount=amount-v_payment,paid_amount=paid_amount+v_payment,status=case when amount-v_payment=0 then 'paid' else 'open' end,paid_at=case when amount-v_payment=0 then now() else null end,updated_at=now() where id=v_debt.id returning * into v_debt;
 return v_debt;
end; $function$;

-- public.record_inventory_movement(p_product_id uuid, p_quantity integer, p_kind text, p_movement_at timestamp with time zone, p_note text)
CREATE OR REPLACE FUNCTION public.record_inventory_movement(p_product_id uuid, p_quantity integer, p_kind text, p_movement_at timestamp with time zone, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_product public.products%rowtype; v_delta integer; v_id uuid;
begin
  if not private.is_manager() then raise exception 'Bu işlem yalnızca yöneticilere açıktır.' using errcode='42501'; end if;
  if p_kind not in ('opening','restock','usage','adjustment') then raise exception 'Stok hareketi türü geçersiz.'; end if;
  if p_quantity is null or p_quantity = 0 then raise exception 'Miktar sıfır olamaz.'; end if;
  v_delta := case when p_kind='usage' then -abs(p_quantity) when p_kind in ('opening','restock') then abs(p_quantity) else p_quantity end;
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'Ürün bulunamadı.'; end if;
  if v_product.stock_quantity + v_delta < 0 then raise exception '% için stok yetersiz. Mevcut: %',v_product.name,v_product.stock_quantity; end if;
  update public.products set stock_quantity=stock_quantity+v_delta where id=p_product_id;
  insert into public.inventory_movements(product_id,movement_type,quantity_delta,movement_at,note)
    values(p_product_id,p_kind,v_delta,coalesce(p_movement_at,now()),nullif(btrim(p_note),'')) returning id into v_id;
  return v_id;
end; $function$;

-- public.register_push_device(p_device_id text, p_fcm_token text)
CREATE OR REPLACE FUNCTION public.register_push_device(p_device_id text, p_fcm_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Oturum gerekli.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_device_id, ''))) not between 8 and 160
     or length(trim(coalesce(p_fcm_token, ''))) not between 20 and 4096 then
    raise exception 'Geçersiz bildirim cihazı.' using errcode = '22023';
  end if;

  delete from public.push_devices
   where fcm_token = trim(p_fcm_token)
     and device_id <> trim(p_device_id);

  insert into public.push_devices (
    user_id, device_id, fcm_token, platform, active, last_seen_at, updated_at
  ) values (
    v_user_id, trim(p_device_id), trim(p_fcm_token), 'android', true, now(), now()
  )
  on conflict (device_id) do update
    set user_id = excluded.user_id,
        fcm_token = excluded.fcm_token,
        platform = 'android',
        active = true,
        last_seen_at = now(),
        updated_at = now();
end;
$function$;

-- public.reject_online_booking_request(p_request_id uuid)
CREATE OR REPLACE FUNCTION public.reject_online_booking_request(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if not private.is_manager() then
    raise exception 'Bu iÅŸlem yalnÄ±zca yÃ¶neticilere aÃ§Ä±ktÄ±r.' using errcode='42501';
  end if;
  update public.online_booking_requests set status='rejected', reviewed_by=auth.uid(),
    reviewed_at=now(), updated_at=now() where id=p_request_id and status='pending';
  if not found then raise exception 'Bekleyen talep bulunamadÄ±.'; end if;
end;
$function$;

-- public.save_client_note(p_client_id uuid, p_note text)
CREATE OR REPLACE FUNCTION public.save_client_note(p_client_id uuid, p_note text)
 RETURNS TABLE(id uuid, note text, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := (select auth.uid());
  v_allowed boolean := false;
begin
  if v_user is null then
    raise exception 'Oturum gerekli';
  end if;

  select exists (
    select 1
    from public.profiles p
    where p.id = v_user
      and p.active is true
      and (
        p.role = 'manager'
        or exists (
          select 1
          from public.appointments a
          where a.client_id = p_client_id
            and a.employee_id = v_user
        )
      )
  ) into v_allowed;

  if not v_allowed then
    raise exception 'Bu müşteri notunu güncelleme yetkiniz yok';
  end if;

  if length(coalesce(p_note, '')) > 1000 then
    raise exception 'Müşteri notu en fazla 1000 karakter olabilir';
  end if;

  return query
  update public.clients c
     set note = nullif(btrim(p_note), ''),
         updated_by = v_user
   where c.id = p_client_id
     and c.active is true
  returning c.id, c.note, c.updated_at;

  if not found then
    raise exception 'Müşteri bulunamadı';
  end if;
end
$function$;

-- public.save_finance_reserve_rule(p_daily_amount numeric, p_effective_from date)
CREATE OR REPLACE FUNCTION public.save_finance_reserve_rule(p_daily_amount numeric, p_effective_from date)
 RETURNS finance_reserve_rules
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_rule public.finance_reserve_rules%rowtype;
begin
  if not private.is_manager() then
    raise exception 'Bu işlem yalnızca yöneticilere açıktır.' using errcode='42501';
  end if;
  if p_daily_amount is null or p_daily_amount < 0 then
    raise exception 'Günlük fon tutarı geçersiz.';
  end if;
  if p_effective_from is null then
    raise exception 'Yürürlük tarihi zorunludur.';
  end if;

  insert into public.finance_reserve_rules(daily_amount,effective_from,created_by)
  values(round(p_daily_amount,2),p_effective_from,auth.uid())
  on conflict(effective_from) do update
    set daily_amount=excluded.daily_amount,
        created_by=auth.uid(),
        created_at=now()
  returning * into v_rule;

  return v_rule;
end;
$function$;

-- public.set_appointment_end()
CREATE OR REPLACE FUNCTION public.set_appointment_end()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.scheduled_end := new.scheduled_at + (new.duration_minutes * interval '1 minute');
  return new;
end;
$function$;

-- public.set_product_active(p_product_id uuid, p_active boolean)
CREATE OR REPLACE FUNCTION public.set_product_active(p_product_id uuid, p_active boolean)
 RETURNS products
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_product public.products%rowtype;
begin
  if not private.is_manager() then
    raise exception 'Bu işlem yalnızca yöneticilere açıktır.' using errcode = '42501';
  end if;

  update public.products
     set active = p_active
   where id = p_product_id
   returning * into v_product;

  if not found then
    raise exception 'Ürün bulunamadı.';
  end if;

  return v_product;
end;
$function$;

-- public.update_appointment_price(p_appointment_id uuid, p_amount numeric)
CREATE OR REPLACE FUNCTION public.update_appointment_price(p_appointment_id uuid, p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_appointment public.appointments%rowtype;
  v_debt public.customer_debts%rowtype;
  v_amount numeric(12,2);
  v_remaining numeric(12,2);
  v_has_debt boolean := false;
begin
  if not private.is_manager() then
    raise exception 'Bu işlem yalnızca yöneticilere açıktır.' using errcode = '42501';
  end if;
  v_amount := round(p_amount, 2);
  if v_amount is null or v_amount < 0 then
    raise exception 'Ücret sıfırdan küçük olamaz.' using errcode = '22023';
  end if;
  select * into v_appointment from public.appointments where id = p_appointment_id for update;
  if not found then raise exception 'Randevu bulunamadı.' using errcode = 'P0002'; end if;
  select * into v_debt from public.customer_debts
   where appointment_id = p_appointment_id and status = 'open'
   order by created_at desc limit 1 for update;
  v_has_debt := found;
  if v_has_debt then
    v_remaining := greatest(v_amount - coalesce(v_debt.paid_amount, 0), 0);
    update public.customer_debts
       set original_amount = v_amount,
           amount = v_remaining,
           status = case when v_remaining = 0 then 'paid' else 'open' end,
           paid_at = case when v_remaining = 0 then coalesce(paid_at, now()) else null end
     where id = v_debt.id returning * into v_debt;
  end if;
  update public.appointments
     set amount = v_amount,
         debt_original_amount = case
           when v_has_debt or coalesce(v_appointment.debt_original_amount, 0) > 0 then v_amount
           else 0
         end,
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_appointment_id returning * into v_appointment;
  return jsonb_build_object(
    'appointment_id', v_appointment.id,
    'amount', v_appointment.amount,
    'debt_original_amount', v_appointment.debt_original_amount,
    'debt', case when v_has_debt then to_jsonb(v_debt) else null end
  );
end;
$function$;

-- public.void_inventory_usage(p_movement_id uuid)
CREATE OR REPLACE FUNCTION public.void_inventory_usage(p_movement_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_move public.inventory_movements%rowtype; v_id uuid;
begin
  if not private.is_manager() then raise exception 'Bu işlem yalnızca yöneticilere açıktır.' using errcode='42501'; end if;
  select * into v_move from public.inventory_movements where id=p_movement_id for update;
  if not found or v_move.movement_type <> 'usage' then raise exception 'Kullanım kaydı bulunamadı.'; end if;
  if v_move.voided_at is not null or exists(select 1 from public.inventory_movements where reversal_of=p_movement_id) then raise exception 'Kullanım kaydı zaten iptal edilmiş.'; end if;
  perform 1 from public.products where id=v_move.product_id for update;
  update public.products set stock_quantity=stock_quantity+abs(v_move.quantity_delta) where id=v_move.product_id;
  update public.inventory_movements set voided_at=now(),voided_by=auth.uid() where id=p_movement_id;
  insert into public.inventory_movements(product_id,movement_type,quantity_delta,movement_at,reversal_of,note)
    values(v_move.product_id,'usage_void',abs(v_move.quantity_delta),now(),p_movement_id,'Kullanım iptali') returning id into v_id;
  return v_id;
end; $function$;

-- public.void_product_sale(p_sale_id uuid)
CREATE OR REPLACE FUNCTION public.void_product_sale(p_sale_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_sale public.product_sales%rowtype;
  v_item record;
begin
  if not private.is_manager() then
    raise exception 'Bu işlem yalnızca yöneticilere açıktır.' using errcode='42501';
  end if;
  select * into v_sale from public.product_sales where id = p_sale_id for update;
  if not found then raise exception 'Satış kaydı bulunamadı.'; end if;
  if v_sale.status = 'voided' then raise exception 'Satış zaten iptal edilmiş.'; end if;
  if exists(
    select 1 from public.customer_debts
    where product_sale_id = p_sale_id and (paid_amount > 0 or status = 'paid')
  ) then
    raise exception 'Bu ürün borcuna ödeme alınmış. Önce borç kaydını kontrol edin.';
  end if;
  delete from public.customer_debts
    where product_sale_id = p_sale_id and paid_amount = 0 and status = 'open';
  for v_item in
    select product_id,sum(quantity)::integer quantity
    from public.product_sale_items where sale_id=p_sale_id group by product_id
  loop
    perform 1 from public.products where id=v_item.product_id for update;
    update public.products set stock_quantity=stock_quantity+v_item.quantity where id=v_item.product_id;
    insert into public.inventory_movements(product_id,movement_type,quantity_delta,movement_at,product_sale_id,note)
      values(v_item.product_id,'sale_void',v_item.quantity,now(),p_sale_id,'Satış iptali');
  end loop;
  update public.product_sales
    set status='voided',voided_by=auth.uid(),voided_at=now()
    where id=p_sale_id;
end;
$function$;

-- public.web_push_server_config()
CREATE OR REPLACE FUNCTION public.web_push_server_config()
 RETURNS TABLE(public_key text, private_key text, subject text, dispatch_secret text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'vault'
AS $function$
  select
    (select decrypted_secret from vault.decrypted_secrets where name='web_push_vapid_public' limit 1),
    (select decrypted_secret from vault.decrypted_secrets where name='web_push_vapid_private' limit 1),
    coalesce((select decrypted_secret from vault.decrypted_secrets where name='web_push_vapid_subject' limit 1),'mailto:ibrahimhalilkiv@gmail.com'),
    (select decrypted_secret from vault.decrypted_secrets where name='web_push_dispatch_secret' limit 1)
$function$;

-- public.web_push_store_vapid(p_public text, p_private text, p_subject text)
CREATE OR REPLACE FUNCTION public.web_push_store_vapid(p_public text, p_private text, p_subject text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'vault'
AS $function$
begin
  if p_public is null or length(p_public)<40 or p_private is null or length(p_private)<20 then raise exception 'invalid_vapid'; end if;
  perform vault.create_secret(p_public,'web_push_vapid_public',null);
  perform vault.create_secret(p_private,'web_push_vapid_private',null);
  perform vault.create_secret(coalesce(nullif(p_subject,''),'mailto:ibrahimhalilkiv@gmail.com'),'web_push_vapid_subject',null);
end $function$;

-- Trigger definitions recovered from live.

drop trigger if exists appointments_dirty_cash_closing on public.appointments;
CREATE TRIGGER appointments_dirty_cash_closing AFTER INSERT OR DELETE OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.v230_dirty_appointment_day();

drop trigger if exists appointments_enqueue_meta_message on public.appointments;
CREATE TRIGGER appointments_enqueue_meta_message AFTER INSERT OR UPDATE OF scheduled_at, employee_id, status ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.enqueue_appointment_whatsapp_message();

drop trigger if exists appointments_notify_assignee on public.appointments;
CREATE TRIGGER appointments_notify_assignee AFTER INSERT OR UPDATE OF employee_id, scheduled_at, service_id, client_id, client_name, note, status ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.notify_appointment_assignment();

drop trigger if exists appointments_set_actor on public.appointments;
CREATE TRIGGER appointments_set_actor BEFORE INSERT OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.set_salon_actor();

drop trigger if exists appointments_set_service_snapshot on public.appointments;
CREATE TRIGGER appointments_set_service_snapshot BEFORE INSERT OR UPDATE OF service_id ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.set_appointment_service_snapshot();

drop trigger if exists appointments_set_updated_at on public.appointments;
CREATE TRIGGER appointments_set_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

drop trigger if exists appointments_update_client_history on public.appointments;
CREATE TRIGGER appointments_update_client_history AFTER INSERT OR UPDATE OF service_id, employee_id, scheduled_at, client_id, client_phone ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.update_client_from_appointment();

drop trigger if exists appointments_write_audit_log on public.appointments;
CREATE TRIGGER appointments_write_audit_log AFTER INSERT OR DELETE OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.write_salon_audit_log();

drop trigger if exists trg_enforce_appointment_creator_from_auth on public.appointments;
CREATE TRIGGER trg_enforce_appointment_creator_from_auth BEFORE INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION enforce_appointment_creator_from_auth();

drop trigger if exists business_expenses_dirty_cash_closing on public.business_expenses;
CREATE TRIGGER business_expenses_dirty_cash_closing AFTER INSERT OR DELETE OR UPDATE ON public.business_expenses FOR EACH ROW EXECUTE FUNCTION private.v230_dirty_expense_day();

drop trigger if exists business_expenses_sync_reserve on public.business_expenses;
CREATE TRIGGER business_expenses_sync_reserve AFTER INSERT OR DELETE OR UPDATE OF expense_date, account_scope, amount, category, description ON public.business_expenses FOR EACH ROW EXECUTE FUNCTION private.v230_sync_reserve_expense();

drop trigger if exists v230_audit_business_expenses on public.business_expenses;
CREATE TRIGGER v230_audit_business_expenses AFTER INSERT OR DELETE OR UPDATE ON public.business_expenses FOR EACH ROW EXECUTE FUNCTION private.v230_audit_finance_row();

drop trigger if exists cash_adjustments_dirty_cash_closing on public.cash_adjustments;
CREATE TRIGGER cash_adjustments_dirty_cash_closing AFTER INSERT OR DELETE OR UPDATE ON public.cash_adjustments FOR EACH ROW EXECUTE FUNCTION private.v233_dirty_adjustment_day();

drop trigger if exists cash_adjustments_prepare on public.cash_adjustments;
CREATE TRIGGER cash_adjustments_prepare BEFORE INSERT OR UPDATE ON public.cash_adjustments FOR EACH ROW EXECUTE FUNCTION private.v233_prepare_cash_adjustment();

drop trigger if exists v233_audit_cash_adjustments on public.cash_adjustments;
CREATE TRIGGER v233_audit_cash_adjustments AFTER INSERT OR DELETE OR UPDATE ON public.cash_adjustments FOR EACH ROW EXECUTE FUNCTION private.v230_audit_finance_row();

drop trigger if exists clients_set_actor on public.clients;
CREATE TRIGGER clients_set_actor BEFORE INSERT OR UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION private.set_salon_actor();

drop trigger if exists clients_set_updated_at on public.clients;
CREATE TRIGGER clients_set_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

drop trigger if exists clients_write_audit_log on public.clients;
CREATE TRIGGER clients_write_audit_log AFTER INSERT OR DELETE OR UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION private.write_salon_audit_log();

drop trigger if exists closed_time_slots_reject_appointments on public.closed_time_slots;
CREATE TRIGGER closed_time_slots_reject_appointments BEFORE INSERT OR UPDATE OF starts_at, ends_at, employee_id ON public.closed_time_slots FOR EACH ROW EXECUTE FUNCTION private.reject_closed_time_with_appointments();

drop trigger if exists debt_payments_dirty_cash_closing on public.customer_debt_payments;
CREATE TRIGGER debt_payments_dirty_cash_closing AFTER INSERT OR DELETE OR UPDATE ON public.customer_debt_payments FOR EACH ROW EXECUTE FUNCTION private.v230_dirty_payment_day();

drop trigger if exists debt_payments_refresh_closed_cash on public.customer_debt_payments;
CREATE TRIGGER debt_payments_refresh_closed_cash AFTER INSERT ON public.customer_debt_payments FOR EACH ROW EXECUTE FUNCTION private.refresh_closed_cash_after_debt_payment();

drop trigger if exists customer_debts_capture_appointment_snapshot on public.customer_debts;
CREATE TRIGGER customer_debts_capture_appointment_snapshot AFTER INSERT OR UPDATE OF original_amount, appointment_id ON public.customer_debts FOR EACH ROW EXECUTE FUNCTION private.v230_capture_debt_snapshot();

drop trigger if exists customer_debts_convert_delete_to_payment on public.customer_debts;
CREATE TRIGGER customer_debts_convert_delete_to_payment BEFORE DELETE ON public.customer_debts FOR EACH ROW EXECUTE FUNCTION private.convert_open_debt_delete_to_payment();

drop trigger if exists customer_debts_set_updated_at on public.customer_debts;
CREATE TRIGGER customer_debts_set_updated_at BEFORE UPDATE ON public.customer_debts FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

drop trigger if exists initialize_customer_debt_amounts_trigger on public.customer_debts;
CREATE TRIGGER initialize_customer_debt_amounts_trigger BEFORE INSERT ON public.customer_debts FOR EACH ROW EXECUTE FUNCTION private.initialize_customer_debt_amounts();

drop trigger if exists daily_cash_closings_touch_updated_at on public.daily_cash_closings;
CREATE TRIGGER daily_cash_closings_touch_updated_at BEFORE UPDATE ON public.daily_cash_closings FOR EACH ROW EXECUTE FUNCTION private.v230_touch_updated_at();

drop trigger if exists v230_audit_daily_cash_closings on public.daily_cash_closings;
CREATE TRIGGER v230_audit_daily_cash_closings AFTER INSERT OR DELETE OR UPDATE ON public.daily_cash_closings FOR EACH ROW EXECUTE FUNCTION private.v230_audit_finance_row();

drop trigger if exists finance_reserve_rules_validate_effective_date on public.finance_reserve_rules;
CREATE TRIGGER finance_reserve_rules_validate_effective_date BEFORE INSERT OR UPDATE OF effective_from ON public.finance_reserve_rules FOR EACH ROW EXECUTE FUNCTION private.v230_validate_reserve_rule();

drop trigger if exists v230_audit_finance_reserve_rules on public.finance_reserve_rules;
CREATE TRIGGER v230_audit_finance_reserve_rules AFTER INSERT OR DELETE OR UPDATE ON public.finance_reserve_rules FOR EACH ROW EXECUTE FUNCTION private.v230_audit_finance_row();

drop trigger if exists v230_audit_inventory_movements on public.inventory_movements;
CREATE TRIGGER v230_audit_inventory_movements AFTER INSERT OR DELETE OR UPDATE ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION private.v230_audit_finance_row();

drop trigger if exists message_templates_mark_meta_pending on public.message_templates;
CREATE TRIGGER message_templates_mark_meta_pending AFTER INSERT OR UPDATE OF content ON public.message_templates FOR EACH ROW EXECUTE FUNCTION private.mark_meta_template_pending();

drop trigger if exists send_assignment_push on public.notifications;
CREATE TRIGGER send_assignment_push AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://oxuwwjsakhcqimjsfris.supabase.co/functions/v1/send-assignment-push', 'POST', '{"Content-type":"application/json"}', '{}', '30000');

drop trigger if exists product_sales_dirty_cash_closing on public.product_sales;
CREATE TRIGGER product_sales_dirty_cash_closing AFTER INSERT OR DELETE OR UPDATE ON public.product_sales FOR EACH ROW EXECUTE FUNCTION private.v230_dirty_sale_day();

drop trigger if exists product_sales_touch_updated_at on public.product_sales;
CREATE TRIGGER product_sales_touch_updated_at BEFORE UPDATE ON public.product_sales FOR EACH ROW EXECUTE FUNCTION private.v230_touch_updated_at();

drop trigger if exists v230_audit_product_sales on public.product_sales;
CREATE TRIGGER v230_audit_product_sales AFTER INSERT OR DELETE OR UPDATE ON public.product_sales FOR EACH ROW EXECUTE FUNCTION private.v230_audit_finance_row();

drop trigger if exists products_touch_updated_at on public.products;
CREATE TRIGGER products_touch_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION private.v230_touch_updated_at();

drop trigger if exists v230_audit_products on public.products;
CREATE TRIGGER v230_audit_products AFTER INSERT OR DELETE OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION private.v230_audit_finance_row();

drop trigger if exists profiles_set_updated_at on public.profiles;
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

drop trigger if exists v230_audit_reserve_ledger on public.reserve_ledger;
CREATE TRIGGER v230_audit_reserve_ledger AFTER INSERT OR DELETE OR UPDATE ON public.reserve_ledger FOR EACH ROW EXECUTE FUNCTION private.v230_audit_finance_row();

drop trigger if exists salon_partners_touch_updated_at on public.salon_partners;
CREATE TRIGGER salon_partners_touch_updated_at BEFORE UPDATE ON public.salon_partners FOR EACH ROW EXECUTE FUNCTION private.v230_touch_updated_at();

drop trigger if exists v230_audit_salon_partners on public.salon_partners;
CREATE TRIGGER v230_audit_salon_partners AFTER INSERT OR DELETE OR UPDATE ON public.salon_partners FOR EACH ROW EXECUTE FUNCTION private.v230_audit_finance_row();

drop trigger if exists services_set_updated_at on public.services;
CREATE TRIGGER services_set_updated_at BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

drop trigger if exists services_sync_recurring_tariff on public.services;
CREATE TRIGGER services_sync_recurring_tariff AFTER UPDATE OF price ON public.services FOR EACH ROW EXECUTE FUNCTION private.sync_recurring_appointment_tariff();
