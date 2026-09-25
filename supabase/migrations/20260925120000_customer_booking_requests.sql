create table if not exists public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null default gen_random_uuid() unique,
  client_id uuid references public.clients(id) on delete set null,
  customer_name text not null check (char_length(trim(customer_name)) between 3 and 120),
  customer_phone text not null check (customer_phone ~ '^905[0-9]{9}$'),
  service_id uuid not null references public.services(id),
  requested_employee_id uuid references public.profiles(id),
  assigned_employee_id uuid references public.profiles(id),
  requested_date date not null,
  requested_start_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  note text,
  rejection_reason text,
  request_ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  appointment_id uuid references public.appointments(id) on delete set null,
  rejected_at timestamptz,
  rejected_by uuid references public.profiles(id),
  constraint booking_request_resolution check (
    (status <> 'approved' or (approved_at is not null and approved_by is not null and appointment_id is not null))
    and (status <> 'rejected' or (rejected_at is not null and rejected_by is not null))
  )
);

create index if not exists booking_requests_pending_schedule_idx
  on public.booking_requests(status, requested_start_at, requested_employee_id);
create index if not exists booking_requests_phone_created_idx
  on public.booking_requests(customer_phone, created_at desc);
create index if not exists booking_requests_ip_created_idx
  on public.booking_requests(request_ip_hash, created_at desc)
  where request_ip_hash is not null;
create index if not exists booking_requests_client_idx on public.booking_requests(client_id) where client_id is not null;
create index if not exists booking_requests_service_idx on public.booking_requests(service_id);
create index if not exists booking_requests_employee_idx on public.booking_requests(requested_employee_id) where requested_employee_id is not null;
create index if not exists booking_requests_assigned_employee_idx on public.booking_requests(assigned_employee_id) where assigned_employee_id is not null;
create index if not exists booking_requests_approved_by_idx on public.booking_requests(approved_by) where approved_by is not null;
create index if not exists booking_requests_appointment_idx on public.booking_requests(appointment_id) where appointment_id is not null;
create index if not exists booking_requests_rejected_by_idx on public.booking_requests(rejected_by) where rejected_by is not null;

alter table public.booking_requests enable row level security;
revoke all on table public.booking_requests from public, anon, authenticated;
grant select on table public.booking_requests to authenticated;
grant all on table public.booking_requests to service_role;

drop policy if exists booking_requests_manager_read on public.booking_requests;
create policy booking_requests_manager_read on public.booking_requests
for select to authenticated using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active is true and p.role = 'manager'
  )
);

create or replace function public.find_client_id_by_phone(p_phone text)
returns uuid
language sql
security definer
set search_path = pg_catalog, public
stable
as $$
  select c.id
  from public.clients c
  where regexp_replace(coalesce(c.phone,''),'[^0-9]','','g') in (
    p_phone,
    substring(p_phone from 3),
    '0'||substring(p_phone from 3)
  )
  order by c.created_at nulls last
  limit 1
$$;

revoke all on function public.find_client_id_by_phone(text) from public, anon, authenticated;
grant execute on function public.find_client_id_by_phone(text) to service_role;

create or replace function public.approve_booking_request(
  p_request_id uuid,
  p_employee_id uuid,
  p_actor_id uuid
) returns table(appointment_id uuid, client_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_request public.booking_requests%rowtype;
  v_service public.services%rowtype;
  v_client_id uuid;
  v_appointment_id uuid;
  v_end timestamptz;
begin
  select * into v_request from public.booking_requests
  where id = p_request_id for update;
  if not found then raise exception 'Talep bulunamadı.'; end if;
  if v_request.status <> 'pending' then raise exception 'Bu talep daha önce sonuçlandırılmış.'; end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and active and role='manager') then
    raise exception 'Yönetici yetkisi gerekli.';
  end if;
  if not exists(select 1 from public.profiles where id=p_employee_id and active) then
    raise exception 'Seçilen çalışan aktif değil.';
  end if;
  if v_request.requested_employee_id is not null and v_request.requested_employee_id <> p_employee_id then
    raise exception 'Müşterinin çalışan tercihi değiştirilemez.';
  end if;
  select * into v_service from public.services where id=v_request.service_id and active;
  if not found then raise exception 'Seçilen hizmet artık aktif değil.'; end if;
  v_end := v_request.requested_start_at + make_interval(mins => v_request.duration_minutes);

  if exists (
    select 1 from public.appointments a
    where a.employee_id=p_employee_id and coalesce(a.status,'confirmed') <> 'cancelled'
      and tstzrange(a.scheduled_at, a.scheduled_at + make_interval(mins => coalesce(a.duration_minutes,60)), '[)')
          && tstzrange(v_request.requested_start_at, v_end, '[)')
  ) or exists (
    select 1 from public.closed_time_slots c
    where c.employee_id=p_employee_id
      and tstzrange(c.starts_at,c.ends_at,'[)') && tstzrange(v_request.requested_start_at,v_end,'[)')
  ) then
    raise exception 'Bu saat artık müsait değil.';
  end if;

  v_client_id := public.find_client_id_by_phone(v_request.customer_phone);

  if v_client_id is null then
    insert into public.clients(full_name,phone)
    values(v_request.customer_name,'0'||substring(v_request.customer_phone from 3))
    returning id into v_client_id;
  end if;

  insert into public.appointments(
    client_id,client_name,client_phone,service_id,service_name,amount,employee_id,
    scheduled_at,duration_minutes,note,status,created_by,tariff_price_snapshot
  ) values (
    v_client_id,v_request.customer_name,'0'||substring(v_request.customer_phone from 3),
    v_service.id,v_service.name,v_service.price,p_employee_id,v_request.requested_start_at,
    v_request.duration_minutes,coalesce(v_request.note,''),'confirmed',p_actor_id,v_service.price
  ) returning id into v_appointment_id;

  update public.booking_requests set
    status='approved', client_id=v_client_id, appointment_id=v_appointment_id, assigned_employee_id=p_employee_id,
    approved_at=now(), approved_by=p_actor_id, updated_at=now()
  where id=p_request_id;

  return query select v_appointment_id,v_client_id;
end;
$$;

revoke all on function public.approve_booking_request(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.approve_booking_request(uuid,uuid,uuid) to service_role;

create or replace function public.reject_booking_request(
  p_request_id uuid,
  p_actor_id uuid,
  p_reason text default null
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and active and role='manager') then
    raise exception 'Yönetici yetkisi gerekli.';
  end if;
  update public.booking_requests set status='rejected', rejection_reason=nullif(trim(p_reason),''),
    rejected_at=now(), rejected_by=p_actor_id, updated_at=now()
  where id=p_request_id and status='pending';
  if not found then raise exception 'Talep bulunamadı veya daha önce sonuçlandırılmış.'; end if;
  return true;
end;
$$;

revoke all on function public.reject_booking_request(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.reject_booking_request(uuid,uuid,text) to service_role;
