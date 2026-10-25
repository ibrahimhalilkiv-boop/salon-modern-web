create or replace function public.approve_online_booking_request(p_request_id uuid)
returns uuid language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare request public.online_booking_requests%rowtype; tariff public.services%rowtype;
  client_id uuid; v_appointment_id uuid; duration integer; old_note text; entry text; registered_name text;
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
  select id,full_name,note into client_id,registered_name,old_note from public.clients
    where lower(btrim(full_name))=lower(btrim(request.client_name))
    order by updated_at desc limit 1 for update;
  if client_id is null then
    insert into public.clients(full_name,phone)
      values(btrim(request.client_name),request.phone) returning id,full_name,note into client_id,registered_name,old_note;
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
  values(client_id,registered_name,request.phone,request.service_id,tariff.name,
    request.amount,request.employee_id,request.scheduled_at,request.note,auth.uid(),'confirmed','online')
  returning id into v_appointment_id;
  update public.online_booking_requests set status='approved',appointment_id=v_appointment_id,
    duration_minutes=duration,reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
    where id=p_request_id;
  return v_appointment_id;
end $$;
revoke all on function public.approve_online_booking_request(uuid) from public,anon;
grant execute on function public.approve_online_booking_request(uuid) to authenticated;
