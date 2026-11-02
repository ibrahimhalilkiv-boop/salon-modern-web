-- A manager-controlled flag on the customer record. Manual appointments stay available.
alter table public.clients
  add column online_booking_blocked boolean not null default false,
  add column online_booking_blocked_at timestamptz,
  add column online_booking_blocked_by uuid references public.profiles(id) on delete set null;

create or replace function private.guard_client_online_booking_block()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public,private as $$
begin
  if tg_op='INSERT' then
    if new.online_booking_blocked and not private.is_manager() then
      raise exception 'Yönetici yetkisi gerekli.' using errcode='42501';
    end if;
    new.online_booking_blocked_at:=case when new.online_booking_blocked then now() else null end;
    new.online_booking_blocked_by:=case when new.online_booking_blocked then auth.uid() else null end;
  elsif new.online_booking_blocked is distinct from old.online_booking_blocked then
    if not private.is_manager() then
      raise exception 'Yönetici yetkisi gerekli.' using errcode='42501';
    end if;
    new.online_booking_blocked_at:=case when new.online_booking_blocked then now() else null end;
    new.online_booking_blocked_by:=case when new.online_booking_blocked then auth.uid() else null end;
  else
    new.online_booking_blocked_at:=old.online_booking_blocked_at;
    new.online_booking_blocked_by:=old.online_booking_blocked_by;
  end if;
  return new;
end $$;
revoke all on function private.guard_client_online_booking_block() from public,anon,authenticated;
create trigger clients_guard_online_booking_block
before insert or update of online_booking_blocked,online_booking_blocked_at,online_booking_blocked_by
on public.clients for each row execute function private.guard_client_online_booking_block();

create or replace function private.online_booking_blacklisted(p_phone text,p_name text)
returns boolean language sql stable security invoker
set search_path=pg_catalog,public,private as $$
  select exists (
    select 1 from public.clients c
    where c.active and c.online_booking_blocked
      and lower(regexp_replace(btrim(c.full_name),'[[:space:]]+',' ','g')) =
          lower(regexp_replace(btrim(p_name),'[[:space:]]+',' ','g'))
      and (private.normalize_tr_phone(c.phone) is null
           or private.normalize_tr_phone(c.phone)=private.normalize_tr_phone(p_phone))
  )
$$;
revoke all on function private.online_booking_blacklisted(text,text) from public,anon,authenticated;
grant execute on function private.online_booking_blacklisted(text,text) to authenticated,service_role;

create or replace function public.can_create_online_booking(p_phone text,p_name text)
returns boolean language sql stable security invoker
set search_path=pg_catalog,public,private as $$
  select public.can_create_online_booking(p_phone)
    and not private.online_booking_blacklisted(p_phone,p_name)
$$;
revoke all on function public.can_create_online_booking(text,text) from public,anon,authenticated;
grant execute on function public.can_create_online_booking(text,text) to service_role;

-- Check inside the transaction too: an old Edge version or a pending request
-- cannot pass once the manager adds this customer to the list.
create or replace function private.guard_online_booking_blacklist()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public,private as $$
begin
  if (tg_op='INSERT' and new.status in ('pending','approved')
      or tg_op='UPDATE' and new.status='approved' and old.status is distinct from new.status
      or tg_op='UPDATE' and new.status='pending' and
         (new.phone_normalized is distinct from old.phone_normalized or new.client_name is distinct from old.client_name))
     and private.online_booking_blacklisted(new.phone_normalized,new.client_name) then
    raise exception 'Randevu için salonumuzla iletişime geçin.' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_online_booking_blacklist() from public,anon,authenticated;
create trigger online_booking_requests_guard_blacklist
before insert or update of status,client_name,phone_normalized
on public.online_booking_requests for each row
execute function private.guard_online_booking_blacklist();
