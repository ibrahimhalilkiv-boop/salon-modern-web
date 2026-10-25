-- Public submissions remain requests until an active manager approves them.
-- Keep the old privileged entry point fail-closed if an older Edge version calls it.
create or replace function public.create_confirmed_online_booking(p_booking jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
begin
  raise exception 'Yönetici onayı gerekli. Online randevu doğrudan oluşturulamaz.' using errcode='42501';
end $$;
revoke all on function public.create_confirmed_online_booking(jsonb) from public,anon,authenticated;
grant execute on function public.create_confirmed_online_booking(jsonb) to service_role;

create or replace function public.create_pending_online_booking(p_booking jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare
  token uuid := (p_booking->>'public_token')::uuid;
  preferred uuid := nullif(p_booking->>'employee_id','')::uuid;
  candidate uuid;
  chosen_employee uuid;
  service uuid := (p_booking->>'service_id')::uuid;
  starts timestamptz := (p_booking->>'scheduled_at')::timestamptz;
  duration integer := (p_booking->>'duration_minutes')::integer;
  normalized_phone text := private.normalize_tr_phone(p_booking->>'phone_normalized');
  customer_name text := btrim(p_booking->>'client_name');
  submitted_note text := nullif(btrim(p_booking->>'note'),'');
  existing public.online_booking_requests%rowtype;
  tariff public.services%rowtype;
  request_id uuid;
begin
  if current_user <> 'service_role' then raise exception 'Yetkisiz işlem.' using errcode='42501'; end if;
  if token is null or normalized_phone is null or customer_name is null or
     length(customer_name) not between 3 and 120 or length(coalesce(submitted_note,''))>500
  then raise exception 'Geçersiz randevu bilgisi.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(token::text,0));
  select * into existing from public.online_booking_requests where public_token=token;
  if found then
    if lower(btrim(existing.client_name))<>lower(customer_name)
       or private.normalize_tr_phone(existing.phone_normalized)<>normalized_phone
       or existing.service_id<>service or (preferred is not null and existing.employee_id<>preferred)
       or existing.scheduled_at<>starts or coalesce(existing.note,'')<>coalesce(submitted_note,'')
    then raise exception 'Tekrarlanan kayıt bilgileri eşleşmiyor.'; end if;
    return jsonb_build_object('id',existing.id,'public_token',token,'status',existing.status,'appointment_id',existing.appointment_id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(normalized_phone,1));
  if not public.can_create_online_booking(normalized_phone) then
    raise exception 'Online randevu oluşturma işleminiz için lütfen Salon Modern ile iletişime geçiniz.';
  end if;
  if (select count(*) from public.online_booking_requests
      where private.normalize_tr_phone(phone_normalized)=normalized_phone
        and created_at>=now()-interval '30 minutes')>=3 then
    raise exception 'Çok fazla randevu isteği.';
  end if;
  if exists(select 1 from public.appointments a where a.status<>'cancelled'
       and a.scheduled_at=starts and lower(btrim(a.client_name))=lower(customer_name)) then
    raise exception 'Bu müşteri için aynı saatte randevu zaten mevcut.' using errcode='23505';
  end if;
  select * into tariff from public.services where id=service and active;
  if not found then raise exception 'Hizmet bulunamadı.'; end if;
  if duration is distinct from private.online_booking_duration(service) then
    raise exception 'Hizmet süresi değişti. Müsait saatleri yenileyin.'; end if;
  perform private.check_online_booking_window(starts,duration);
  for candidate in select id from public.profiles
      where active and username is distinct from 'salon.modern'
        and (preferred is null or id=preferred) order by id loop
    perform pg_advisory_xact_lock(hashtextextended(candidate::text,93));
    if private.online_slot_available(candidate,starts,duration) then chosen_employee:=candidate; exit; end if;
  end loop;
  if chosen_employee is null then raise exception 'Seçilen saat artık müsait değil.' using errcode='23P01'; end if;
  insert into public.online_booking_requests(
    client_name,phone,phone_normalized,service_id,service_name,amount,
    employee_id,scheduled_at,duration_minutes,note,request_ip_hash,public_token,status)
  values(customer_name,p_booking->>'phone',normalized_phone,service,tariff.name,tariff.price,
    chosen_employee,starts,duration,submitted_note,p_booking->>'request_ip_hash',token,'pending')
  returning id into request_id;
  insert into public.notifications(recipient_id,kind,title,body)
    select id,'booking_request','Online randevu onayı bekliyor',
      customer_name||' · '||tariff.name||' · '||
      to_char(starts at time zone 'Europe/Istanbul','DD.MM.YYYY HH24:MI')
    from public.profiles where active and role='manager';
  return jsonb_build_object('id',request_id,'public_token',token,'status','pending','appointment_id',null);
end $$;
revoke all on function public.create_pending_online_booking(jsonb) from public,anon,authenticated;
grant execute on function public.create_pending_online_booking(jsonb) to service_role;

create or replace function public.update_pending_online_booking_request(
  p_request_id uuid,p_start timestamptz,p_employee_id uuid,p_service_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare request public.online_booking_requests%rowtype; tariff public.services%rowtype; duration integer;
begin
  if not private.is_manager() then raise exception 'Yönetici yetkisi gerekli.' using errcode='42501'; end if;
  select * into request from public.online_booking_requests where id=p_request_id for update;
  if not found or request.status<>'pending' or request.appointment_id is not null then
    raise exception 'Bekleyen talep bulunamadı.'; end if;
  select * into tariff from public.services where id=p_service_id and active;
  if not found then raise exception 'Hizmet bulunamadı.'; end if;
  duration:=private.online_booking_duration(p_service_id);
  perform private.check_online_booking_window(p_start,duration);
  if not exists(select 1 from public.profiles
      where id=p_employee_id and active and username is distinct from 'salon.modern') then
    raise exception 'Aktif çalışan seçin.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text,93));
  if not private.online_slot_available(p_employee_id,p_start,duration) then
    raise exception 'Seçilen saat artık müsait değil.' using errcode='23P01'; end if;
  if exists(select 1 from public.appointments a where a.status<>'cancelled'
       and a.scheduled_at=p_start and lower(btrim(a.client_name))=lower(btrim(request.client_name))) then
    raise exception 'Bu müşteri için aynı saatte randevu zaten mevcut.' using errcode='23505'; end if;
  update public.online_booking_requests set scheduled_at=p_start,employee_id=p_employee_id,
    service_id=p_service_id,service_name=tariff.name,amount=tariff.price,
    duration_minutes=duration,updated_at=now() where id=p_request_id;
end $$;
revoke all on function public.update_pending_online_booking_request(uuid,timestamptz,uuid,uuid)
  from public,anon;
grant execute on function public.update_pending_online_booking_request(uuid,timestamptz,uuid,uuid)
  to authenticated;

create or replace function public.approve_online_booking_request(p_request_id uuid)
returns uuid language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare request public.online_booking_requests%rowtype; tariff public.services%rowtype;
  client_id uuid; v_appointment_id uuid; duration integer; old_note text; entry text;
begin
  if not private.is_manager() then raise exception 'Yönetici yetkisi gerekli.' using errcode='42501'; end if;
  select * into request from public.online_booking_requests where id=p_request_id for update;
  if not found or request.status<>'pending' or request.appointment_id is not null then
    raise exception 'Bekleyen talep bulunamadı.'; end if;
  select * into tariff from public.services where id=request.service_id and active;
  if not found then raise exception 'Hizmet bulunamadı.'; end if;
  duration:=private.online_booking_duration(request.service_id);
  perform private.check_online_booking_window(request.scheduled_at,duration);
  if not exists(select 1 from public.profiles where id=request.employee_id and active
      and username is distinct from 'salon.modern') then raise exception 'Aktif çalışan seçin.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(request.employee_id::text,93));
  if not private.online_slot_available(request.employee_id,request.scheduled_at,duration) then
    raise exception 'Seçilen saat artık müsait değil.' using errcode='23P01'; end if;
  if exists(select 1 from public.appointments a where a.status<>'cancelled'
       and a.scheduled_at=request.scheduled_at
       and lower(btrim(a.client_name))=lower(btrim(request.client_name))) then
    raise exception 'Bu müşteri için aynı saatte randevu zaten mevcut.' using errcode='23505'; end if;
  select id,note into client_id,old_note from public.clients
    where lower(btrim(full_name))=lower(btrim(request.client_name))
    order by updated_at desc limit 1 for update;
  if client_id is null then
    insert into public.clients(full_name,phone)
      values(btrim(request.client_name),request.phone) returning id,note into client_id,old_note;
  else
    update public.clients set phone=coalesce(nullif(phone,''),request.phone)
      where id=client_id;
  end if;
  if nullif(btrim(request.note),'') is not null then
    entry:='[Online randevu '||to_char(request.scheduled_at at time zone 'Europe/Istanbul','DD.MM.YYYY')||'] '||btrim(request.note);
    if position(entry in coalesce(old_note,''))=0 and
       length(coalesce(old_note,''))+length(entry)+(old_note is not null)::integer<=1000 then
      update public.clients set note=concat_ws(chr(10),nullif(old_note,''),entry) where id=client_id;
    end if;
  end if;
  insert into public.appointments(client_id,client_name,client_phone,service_id,service_name,
    amount,employee_id,scheduled_at,note,created_by,status,source)
  values(client_id,btrim(request.client_name),request.phone,request.service_id,tariff.name,
    request.amount,request.employee_id,request.scheduled_at,request.note,auth.uid(),'confirmed','online')
  returning id into v_appointment_id;
  update public.online_booking_requests set status='approved',appointment_id=v_appointment_id,
    duration_minutes=duration,reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
    where id=p_request_id;
  return v_appointment_id;
end $$;
revoke all on function public.approve_online_booking_request(uuid) from public,anon;
grant execute on function public.approve_online_booking_request(uuid) to authenticated;

-- Staff edits to an approved online appointment must update its tracking row.
-- Customer self-service uses service_role and already updates that row itself.
create or replace function private.sync_staff_online_booking_request()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if new.source is distinct from 'online' or auth.uid() is null then return new; end if;
  update public.online_booking_requests r set
    status=case when new.status='cancelled' then 'cancelled' else 'approved' end,
    scheduled_at=new.scheduled_at,employee_id=new.employee_id,
    service_id=new.service_id,service_name=new.service_name,amount=new.amount,
    note=new.note,phone=new.client_phone,
    phone_normalized=coalesce(private.normalize_tr_phone(new.client_phone),r.phone_normalized),
    duration_minutes=greatest(new.duration_minutes,coalesce(new.online_protection_minutes,new.duration_minutes)),
    customer_revision=r.customer_revision+1,updated_at=now()
  where r.appointment_id=new.id and
    (r.scheduled_at,r.employee_id,r.service_id,r.status,r.note,r.amount,r.phone)
      is distinct from
    (new.scheduled_at,new.employee_id,new.service_id,
      case when new.status='cancelled' then 'cancelled' else 'approved' end,
      new.note,new.amount,new.client_phone);
  return new;
end $$;
revoke all on function private.sync_staff_online_booking_request() from public,anon,authenticated;
drop trigger if exists appointments_sync_online_request on public.appointments;
create trigger appointments_sync_online_request
after update of scheduled_at,employee_id,service_id,status,note,amount,client_phone
on public.appointments for each row execute function private.sync_staff_online_booking_request();

-- Recover submitted notes for historical approved bookings with linked clients.
-- No booking status, calendar row or customer message is changed by this backfill.
do $$
declare item record; old_note text; entry text;
begin
  for item in select r.id,r.note,r.scheduled_at,a.client_id
    from public.online_booking_requests r join public.appointments a on a.id=r.appointment_id
    where r.status='approved' and nullif(btrim(r.note),'') is not null and a.client_id is not null
    order by r.created_at loop
    select c.note into old_note from public.clients c where c.id=item.client_id for update;
    entry:='[Online randevu '||to_char(item.scheduled_at at time zone 'Europe/Istanbul','DD.MM.YYYY')||'] '||btrim(item.note);
    if position(entry in coalesce(old_note,''))=0 and
       length(coalesce(old_note,''))+length(entry)+(old_note is not null)::integer<=1000 then
      update public.clients set note=concat_ws(chr(10),nullif(old_note,''),entry)
        where id=item.client_id;
    end if;
  end loop;
end $$;
