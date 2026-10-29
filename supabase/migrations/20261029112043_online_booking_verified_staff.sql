-- Short-lived, rate-limited phone verification for public online booking.
-- Keep the existing public form working until the provider and new form are ready.
alter table public.booking_settings
  add column online_booking_verification_enabled boolean not null default false;

create table private.customer_phone_challenges (
  id uuid primary key,
  phone_hash text not null,
  name_hash text not null,
  ip_hash text not null,
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  delivery_status text not null default 'created'
    check (delivery_status in ('created','sent','unknown','failed','replaced','locked','used')),
  provider_message_id text,
  consumed_at timestamptz
);
create index customer_phone_challenges_phone_time_idx
  on private.customer_phone_challenges(phone_hash,created_at desc);
create index customer_phone_challenges_ip_time_idx
  on private.customer_phone_challenges(ip_hash,created_at desc);
alter table private.customer_phone_challenges enable row level security;
revoke all on private.customer_phone_challenges from public,anon,authenticated;
grant select,insert,update on private.customer_phone_challenges to service_role;

create table private.customer_phone_sessions (
  token_hash text primary key,
  phone_hash text not null,
  name_hash text not null,
  challenge_id uuid not null references private.customer_phone_challenges(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index customer_phone_sessions_expiry_idx on private.customer_phone_sessions(expires_at);
alter table private.customer_phone_sessions enable row level security;
revoke all on private.customer_phone_sessions from public,anon,authenticated;
grant select,insert on private.customer_phone_sessions to service_role;

create function public.begin_customer_phone_verification(
  p_id uuid,p_phone_hash text,p_name_hash text,p_ip_hash text,p_code_hash text
) returns boolean language plpgsql security invoker set search_path=pg_catalog,public,private as $$
begin
  if current_user <> 'service_role' then raise exception 'Yetkisiz işlem.' using errcode='42501'; end if;
  if p_id is null or p_phone_hash !~ '^[a-f0-9]{64}$' or p_name_hash !~ '^[a-f0-9]{64}$'
    or p_ip_hash !~ '^[a-f0-9]{64}$' or p_code_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Geçersiz doğrulama isteği.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_phone_hash,101));
  perform pg_advisory_xact_lock(hashtextextended(p_ip_hash,102));
  if exists (select 1 from private.customer_phone_challenges
      where phone_hash=p_phone_hash and created_at>now()-interval '60 seconds')
    or (select count(*) from private.customer_phone_challenges
      where phone_hash=p_phone_hash and created_at>now()-interval '30 minutes')>=3
    or (select count(*) from private.customer_phone_challenges
      where phone_hash=p_phone_hash and created_at>now()-interval '24 hours')>=8
    or (select count(*) from private.customer_phone_challenges
      where ip_hash=p_ip_hash and created_at>now()-interval '30 minutes')>=10 then
    return false;
  end if;
  update private.customer_phone_challenges set delivery_status='replaced'
    where phone_hash=p_phone_hash and expires_at>now()
      and delivery_status in ('created','sent','unknown');
  insert into private.customer_phone_challenges
    (id,phone_hash,name_hash,ip_hash,code_hash,expires_at)
    values (p_id,p_phone_hash,p_name_hash,p_ip_hash,p_code_hash,now()+interval '5 minutes');
  return true;
end $$;

create function public.mark_customer_phone_verification_delivery(
  p_id uuid,p_status text,p_message_id text default null
) returns void language plpgsql security invoker set search_path=pg_catalog,public,private as $$
begin
  if current_user <> 'service_role' then raise exception 'Yetkisiz işlem.' using errcode='42501'; end if;
  if p_status not in ('sent','unknown','failed') then raise exception 'Geçersiz gönderim durumu.'; end if;
  update private.customer_phone_challenges
    set delivery_status=p_status,provider_message_id=left(p_message_id,200)
    where id=p_id and delivery_status='created';
end $$;

create function public.finish_customer_phone_verification(
  p_id uuid,p_code_hash text,p_session_hash text
) returns boolean language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare challenge private.customer_phone_challenges%rowtype;
begin
  if current_user <> 'service_role' then raise exception 'Yetkisiz işlem.' using errcode='42501'; end if;
  if p_id is null or p_code_hash !~ '^[a-f0-9]{64}$' or p_session_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  select * into challenge from private.customer_phone_challenges where id=p_id for update;
  if not found or challenge.expires_at<=now() or challenge.attempts>=5
    or challenge.delivery_status not in ('sent','unknown') or challenge.consumed_at is not null then return false; end if;
  if challenge.code_hash<>p_code_hash then
    update private.customer_phone_challenges
      set attempts=attempts+1,
        delivery_status=case when attempts+1>=5 then 'locked' else delivery_status end
      where id=p_id;
    return false;
  end if;
  update private.customer_phone_challenges set consumed_at=now(),delivery_status='used' where id=p_id;
  insert into private.customer_phone_sessions(token_hash,phone_hash,name_hash,challenge_id,expires_at)
    values (p_session_hash,challenge.phone_hash,challenge.name_hash,p_id,now()+interval '30 minutes');
  return true;
end $$;

create function public.customer_phone_session_valid(
  p_session_hash text,p_phone_hash text,p_name_hash text
) returns boolean language plpgsql stable security invoker set search_path=pg_catalog,public,private as $$
begin
  if current_user <> 'service_role' then raise exception 'Yetkisiz işlem.' using errcode='42501'; end if;
  return exists (select 1 from private.customer_phone_sessions s
    where s.token_hash=p_session_hash and s.phone_hash=p_phone_hash
      and s.name_hash=p_name_hash and s.expires_at>now());
end $$;

create function public.online_booking_customer_registered(p_phone text,p_name text)
returns boolean language sql stable security invoker set search_path=pg_catalog,public,private as $$
  select current_user = 'service_role' and exists (
    select 1 from public.clients c
    where private.normalize_tr_phone(c.phone) = private.normalize_tr_phone(p_phone)
      and lower(regexp_replace(btrim(c.full_name),'\s+',' ','g')) =
          lower(regexp_replace(btrim(p_name),'\s+',' ','g'))
  );
$$;

revoke all on function public.begin_customer_phone_verification(uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.mark_customer_phone_verification_delivery(uuid,text,text) from public,anon,authenticated;
revoke all on function public.finish_customer_phone_verification(uuid,text,text) from public,anon,authenticated;
revoke all on function public.customer_phone_session_valid(text,text,text) from public,anon,authenticated;
revoke all on function public.online_booking_customer_registered(text,text) from public,anon,authenticated;
grant execute on function public.begin_customer_phone_verification(uuid,text,text,text,text) to service_role;
grant execute on function public.mark_customer_phone_verification_delivery(uuid,text,text) to service_role;
grant execute on function public.finish_customer_phone_verification(uuid,text,text) to service_role;
grant execute on function public.customer_phone_session_valid(text,text,text) to service_role;
grant execute on function public.online_booking_customer_registered(text,text) to service_role;

-- Match approved customers by verified phone and name, never by name alone.
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
    where private.normalize_tr_phone(phone)=private.normalize_tr_phone(request.phone_normalized)
      and lower(regexp_replace(btrim(full_name),'\s+',' ','g'))=
          lower(regexp_replace(btrim(request.client_name),'\s+',' ','g'))
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
