-- Keep online bookings associated with the named customer, even when relatives share a number.
create or replace function public.create_confirmed_online_booking(p_booking jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare
  token uuid := (p_booking->>'public_token')::uuid;
  preferred uuid := (p_booking->>'employee_id')::uuid;
  chosen_employee uuid;
  candidate uuid;
  service uuid := (p_booking->>'service_id')::uuid;
  starts timestamptz := (p_booking->>'scheduled_at')::timestamptz;
  duration integer := (p_booking->>'duration_minutes')::integer;
  normalized_phone text := private.normalize_tr_phone(p_booking->>'phone_normalized');
  expected_duration integer;
  local_start timestamp;
  existing public.online_booking_requests%rowtype; tariff public.services%rowtype;
  client uuid; appointment uuid; request_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Yetkisiz işlem.' using errcode='42501'; end if;
  if token is null or normalized_phone is null then raise exception 'Geçersiz randevu bilgisi.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(token::text,0));
  select * into existing from public.online_booking_requests where public_token=token;
  if found then
    if existing.status<>'approved' or private.normalize_tr_phone(existing.phone_normalized)<>normalized_phone
      or existing.service_id<>service or (preferred is not null and existing.employee_id<>preferred)
      or existing.scheduled_at<>starts then raise exception 'Tekrarlanan kayıt bilgileri eşleşmiyor.'; end if;
    return jsonb_build_object('id',existing.id,'public_token',token,'appointment_id',existing.appointment_id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(normalized_phone,1));
  if not public.can_create_online_booking(normalized_phone) then
    raise exception 'Online randevu oluşturma işleminiz için lütfen Salon Modern ile iletişime geçiniz.';
  end if;
  if (select count(*) from public.online_booking_requests
      where private.normalize_tr_phone(phone_normalized)=normalized_phone and created_at>=now()-interval '30 minutes')>=3 then
    raise exception 'Çok fazla randevu isteği.';
  end if;
  if exists(select 1 from public.appointments a where a.status<>'cancelled' and a.scheduled_at=starts
      and lower(trim(a.client_name))=lower(trim(p_booking->>'client_name'))) then
    raise exception 'Bu müşteri için aynı saatte randevu zaten mevcut.' using errcode='23505';
  end if;
  select * into tariff from public.services where id=service and active;
  if not found then raise exception 'Hizmet bulunamadı.'; end if;
  expected_duration:=private.online_booking_duration(service);
  if expected_duration is null or duration<>expected_duration then
    raise exception 'Online hizmet süresi değişti. Müsait saatleri yenileyin.';
  end if;
  perform private.check_online_booking_window(starts,duration);
  for candidate in select id from public.profiles where active and username is distinct from 'salon.modern'
    and (preferred is null or id=preferred) order by id loop
    perform pg_advisory_xact_lock(hashtextextended(candidate::text,93));
    if private.online_slot_available(candidate,starts,duration) then chosen_employee:=candidate; exit; end if;
  end loop;
  if chosen_employee is null then raise exception 'Seçilen saat artık müsait değil.' using errcode='23P01'; end if;
  local_start:=starts at time zone 'Europe/Istanbul';
  select id into client from public.clients where lower(trim(full_name))=lower(trim(p_booking->>'client_name')) order by id limit 1;
  if client is null then
    insert into public.clients(full_name,phone) values(p_booking->>'client_name',p_booking->>'phone') returning id into client;
  end if;
  insert into public.appointments(client_id,client_name,client_phone,service_id,amount,employee_id,scheduled_at,note,status,source)
    values(client,p_booking->>'client_name',p_booking->>'phone',service,tariff.price,chosen_employee,starts,p_booking->>'note','confirmed','online')
    returning id into appointment;
  insert into public.online_booking_requests(client_name,phone,phone_normalized,service_id,service_name,amount,employee_id,scheduled_at,duration_minutes,note,request_ip_hash,public_token,status,appointment_id,reviewed_at)
    values(p_booking->>'client_name',p_booking->>'phone',normalized_phone,service,tariff.name,tariff.price,chosen_employee,starts,duration,p_booking->>'note',p_booking->>'request_ip_hash',token,'approved',appointment,now()) returning id into request_id;
  insert into public.notifications(recipient_id,appointment_id,kind,title,body)
    select id,appointment,'booking_request','Yeni online randevu',
      (p_booking->>'client_name')||' · '||tariff.name||' · '||to_char(local_start,'DD.MM.YYYY HH24:MI')
    from public.profiles where active and role='manager' and id<>chosen_employee;
  return jsonb_build_object('id',request_id,'public_token',token,'appointment_id',appointment,'employee_id',chosen_employee);
end $$;
revoke all on function public.create_confirmed_online_booking(jsonb) from public,anon,authenticated;
grant execute on function public.create_confirmed_online_booking(jsonb) to service_role;

-- The legacy pending-request approval used a fixed 30 minutes. Its manager-only
-- entry point now uses the same service duration, time window and slot checks.
create or replace function public.approve_online_booking_request(p_request_id uuid) returns uuid
language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare v_request public.online_booking_requests%rowtype; tariff public.services%rowtype;
  v_client_id uuid; v_appointment_id uuid; chosen_employee uuid; candidate uuid; duration integer;
begin
  if not private.is_manager() then raise exception 'Bu işlem yalnızca yöneticilere açıktır.' using errcode='42501'; end if;
  select * into v_request from public.online_booking_requests where id=p_request_id for update;
  if not found then raise exception 'Randevu talebi bulunamadı.'; end if;
  if v_request.status<>'pending' then raise exception 'Bu talep daha önce sonuçlandırılmış.'; end if;
  select * into tariff from public.services where id=v_request.service_id and active;
  if not found then raise exception 'Hizmet bulunamadı.'; end if;
  duration:=greatest(tariff.duration_minutes,tariff.online_duration_minutes);
  perform private.check_online_booking_window(v_request.scheduled_at,duration);
  for candidate in select id from public.profiles where active and username is distinct from 'salon.modern'
    and (v_request.employee_id is null or id=v_request.employee_id) order by id loop
    perform pg_advisory_xact_lock(hashtextextended(candidate::text,93));
    if private.online_slot_available(candidate,v_request.scheduled_at,duration) then chosen_employee:=candidate; exit; end if;
  end loop;
  if chosen_employee is null then raise exception 'Seçilen saat artık müsait değil.' using errcode='23P01'; end if;
  if exists(select 1 from public.appointments a where a.status<>'cancelled' and a.scheduled_at=v_request.scheduled_at
      and lower(trim(a.client_name))=lower(trim(v_request.client_name))) then
    raise exception 'Bu müşteri için aynı saatte randevu zaten mevcut.' using errcode='23505';
  end if;
  select id into v_client_id from public.clients
  where lower(trim(full_name))=lower(trim(v_request.client_name))
  order by updated_at desc limit 1;
  if v_client_id is null then
    insert into public.clients(full_name,phone) values(trim(v_request.client_name),v_request.phone) returning id into v_client_id;
  else
    update public.clients set phone=coalesce(nullif(phone,''),v_request.phone),updated_at=now() where id=v_client_id;
  end if;
  insert into public.appointments(client_id,client_name,client_phone,service_id,service_name,amount,
    employee_id,scheduled_at,note,created_by,status,source)
  values(v_client_id,trim(v_request.client_name),v_request.phone,v_request.service_id,v_request.service_name,
    v_request.amount,chosen_employee,v_request.scheduled_at,'Müşteri çevrim içi talebi',auth.uid(),'confirmed','online')
  returning id into v_appointment_id;
  update public.online_booking_requests set status='approved',appointment_id=v_appointment_id,
    employee_id=chosen_employee,duration_minutes=duration,
    reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=p_request_id;
  return v_appointment_id;
end $$;


-- A shared telephone number does not make two named customers the same person.
create or replace function private.reject_appointment_during_closed_time()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.employee_id::text,93));
  if tg_op='UPDATE' and old.source='online' and new.source is distinct from 'online' then
    raise exception 'Online randevunun kaynağı değiştirilemez.';
  end if;
  if new.source='online' and new.staff_overlap_override then
    raise exception 'Online randevuda çakışma istisnası kullanılamaz.';
  end if;
  if new.staff_overlap_override and (tg_op='INSERT' or not old.staff_overlap_override or
       (new.employee_id,new.scheduled_at,new.duration_minutes) is distinct from (old.employee_id,old.scheduled_at,old.duration_minutes)) then
    if not exists(select 1 from public.profiles where id=auth.uid() and active and
      (role='manager' or (role='employee' and id=new.employee_id and (tg_op='INSERT' or id=old.employee_id)))) then
      raise exception 'Çakışma istisnası yalnız yetkili personele açıktır.' using errcode='42501';
    end if;
  end if;
  if new.status='cancelled' then return new; end if;
  if tg_op='UPDATE' and old.status<>'cancelled' and
    (new.employee_id,new.scheduled_at,new.duration_minutes,new.online_protection_minutes,new.source)
      is not distinct from
    (old.employee_id,old.scheduled_at,old.duration_minutes,old.online_protection_minutes,old.source) then
    return new;
  end if;
  if new.source='online' then
    if not private.online_slot_available(new.employee_id,new.scheduled_at,
      greatest(new.duration_minutes,coalesce(new.online_protection_minutes,new.duration_minutes)),new.id) then
      raise exception 'Seçilen saat artık müsait değil.' using errcode='23P01';
    end if;
  else
    if exists(select 1 from public.closed_time_slots c where c.employee_id=new.employee_id
      and c.starts_at<new.scheduled_at+make_interval(mins=>new.duration_minutes) and c.ends_at>new.scheduled_at) then
      raise exception 'Bu çalışanın seçilen saati kapalıdır.';
    end if;
    if exists(select 1 from public.appointments a where a.id is distinct from new.id
      and a.status<>'cancelled' and a.scheduled_at=new.scheduled_at
      and lower(trim(a.client_name))=lower(trim(new.client_name))) then
      raise exception 'Bu müşteri için aynı saatte randevu zaten mevcut.' using errcode='23505';
    end if;
  end if;
  return new;
end $$;

-- Preserve a manager's explicit correction to an already due active appointment.
create or replace function private.track_appointment_completion_override()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $$
begin
  if auth.uid() is not null and private.is_manager() and new.status='confirmed' then
    new.auto_completion_suppressed := new.scheduled_at+interval '2 hours'<=now();
  elsif old.status is distinct from new.status and new.status='completed' then
    new.auto_completion_suppressed:=false;
  else
    new.auto_completion_suppressed:=old.auto_completion_suppressed;
  end if;
  return new;
end $$;
drop trigger if exists appointments_track_completion_override on public.appointments;
create trigger appointments_track_completion_override
before update of status,scheduled_at,employee_id,service_id,client_id,amount on public.appointments
for each row execute function private.track_appointment_completion_override();

-- Staff keep the original no-show rules; managers may correct older statuses.
create or replace function private.guard_appointment_no_show()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare v_actor uuid:=auth.uid(); v_manager boolean:=v_actor is not null and private.is_manager();
begin
  if tg_op='INSERT' then
    if new.status='no_show' then raise exception 'Gelmedi durumu yalnız mevcut randevuya uygulanabilir.' using errcode='23514'; end if;
    return new;
  end if;
  if old.status is distinct from new.status and new.status='no_show' then
    if new.scheduled_at>now() or (old.status<>'confirmed' and not v_manager) then
      raise exception 'Yalnız geçmiş randevu Gelmedi olarak işaretlenebilir.' using errcode='23514';
    end if;
    if v_actor is null or not private.is_active_salon_user() or
       (not v_manager and old.employee_id is distinct from v_actor) then
      raise exception 'Bu randevuyu Gelmedi olarak işaretleme yetkiniz yok.' using errcode='42501';
    end if;
    new.no_show_at:=now(); new.no_show_by:=v_actor;
    new.no_show_reversed_at:=null; new.no_show_reversed_by:=null; new.no_show_reversal_reason:=null;
  elsif old.status='no_show' and old.status is distinct from new.status then
    if not v_manager then raise exception 'Gelmedi durumunu yalnız yönetici geri alabilir.' using errcode='42501'; end if;
    if new.status not in ('confirmed','completed','cancelled') or nullif(trim(new.no_show_reversal_reason),'') is null then
      raise exception 'Gelmedi düzeltmesi için neden gereklidir.' using errcode='23514';
    end if;
    new.no_show_at:=old.no_show_at; new.no_show_by:=old.no_show_by;
    new.no_show_reversed_at:=now(); new.no_show_reversed_by:=v_actor;
    new.no_show_reversal_reason:=left(trim(new.no_show_reversal_reason),500);
  else
    new.no_show_at:=old.no_show_at; new.no_show_by:=old.no_show_by;
    new.no_show_reversed_at:=old.no_show_reversed_at; new.no_show_reversed_by:=old.no_show_reversed_by;
    new.no_show_reversal_reason:=old.no_show_reversal_reason;
  end if;
  return new;
end $$;

-- Keep existing payment history intact. Unpaid linked debt follows manager edits
-- in the same transaction; paid debt cannot silently change customer or price.
create or replace function private.sync_appointment_debt_on_manager_edit()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare v_debt public.customer_debts%rowtype;
begin
  if auth.uid() is null or not private.is_manager() or
    (old.client_id,old.client_name,old.amount,old.scheduled_at) is not distinct from
    (new.client_id,new.client_name,new.amount,new.scheduled_at) then return new; end if;
  select * into v_debt from public.customer_debts where appointment_id=new.id for update;
  if not found then return new; end if;
  if (old.client_id,old.client_name,old.amount) is distinct from
      (new.client_id,new.client_name,new.amount) and
      (v_debt.status<>'open' or coalesce(v_debt.paid_amount,0)>0 or
       exists(select 1 from public.customer_debt_payments where debt_id=v_debt.id)) then
    raise exception 'Ödeme geçmişi olan randevunun müşteri veya ücreti önce finans kayıtlarıyla birlikte düzeltilmelidir.';
  end if;
  if v_debt.status='open' and coalesce(v_debt.paid_amount,0)=0 then
    update public.customer_debts set client_id=new.client_id,client_name=new.client_name,
      amount=new.amount,original_amount=new.amount,
      debt_date=(new.scheduled_at at time zone 'Europe/Istanbul')::date
    where id=v_debt.id;
  end if;
  return new;
end $$;
drop trigger if exists appointments_sync_manager_debt on public.appointments;
create trigger appointments_sync_manager_debt
after update of client_id,client_name,amount,scheduled_at on public.appointments
for each row execute function private.sync_appointment_debt_on_manager_edit();

-- Historical corrections must not queue WhatsApp messages to customers.
create or replace function private.enqueue_appointment_whatsapp_message()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $$
begin
  if tg_op='INSERT' and coalesce(new.status,'')<>'cancelled' then
    perform private.enqueue_whatsapp_message('appointment_confirmation:'||new.id::text,'appointment_confirmation',new.id,new.client_id);
  elsif tg_op='UPDATE' and new.scheduled_at<now() then
    return new;
  elsif tg_op='UPDATE' and old.status is distinct from new.status and new.status='cancelled' then
    if new.cancellation_source in ('admin','staff') then
      perform private.enqueue_whatsapp_message('appointment_cancelled:'||new.id::text,'appointment_cancelled',new.id,new.client_id);
    end if;
  elsif tg_op='UPDATE' and coalesce(new.status,'')<>'cancelled' and
    (new.scheduled_at,new.employee_id) is distinct from (old.scheduled_at,old.employee_id) then
    perform private.enqueue_whatsapp_message('appointment_update:'||new.id::text||':'||txid_current()::text,'appointment_update',new.id,new.client_id);
  end if;
  return new;
end $$;

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
  delete from public.online_booking_requests where appointment_id=p_appointment_id;
  delete from public.appointments where id=p_appointment_id;
  insert into public.salon_audit_log(actor_id,action,entity_type,entity_id,after_data)
    values(auth.uid(),'delete','appointment',p_appointment_id,jsonb_build_object('reason',left(trim(p_reason),500)));
  return jsonb_build_object('id',p_appointment_id,'deleted',true);
end $$;
revoke all on function public.manager_delete_erroneous_appointment(uuid,text) from public,anon;
grant execute on function public.manager_delete_erroneous_appointment(uuid,text) to authenticated;

