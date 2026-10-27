-- Staff may discover a client by a meaningful name query, or see clients they
-- have served. Only managers may enumerate public.clients directly.
create table private.staff_client_lookup_quota (
  user_id uuid primary key,
  minute_started_at timestamptz not null,
  minute_count integer not null,
  hour_started_at timestamptz not null,
  hour_count integer not null
);
revoke all on private.staff_client_lookup_quota from public, anon, authenticated;

create function private.staff_client_key(p_value text) returns text
language sql immutable set search_path = '' as $$
  select pg_catalog.regexp_replace(
    pg_catalog.lower(pg_catalog.translate(coalesce(p_value, ''),
      'ÇĞİIÖŞÜçğıöşü', 'CGIIOSUcgiosu')),
    '[^a-z0-9]', '', 'g');
$$;
revoke all on function private.staff_client_key(text) from public, anon, authenticated;

create function private.assert_active_staff() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p
    where p.id = v_actor and p.active and p.role = 'employee'
  ) then
    raise exception 'Aktif çalışan hesabı gerekli' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;
revoke all on function private.assert_active_staff() from public, anon, authenticated;

create function private.reserve_staff_client_lookup(p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_minute_count integer; v_hour_count integer;
begin
  insert into private.staff_client_lookup_quota as q
    (user_id, minute_started_at, minute_count, hour_started_at, hour_count)
  values (p_actor, pg_catalog.now(), 1, pg_catalog.now(), 1)
  on conflict (user_id) do update set
    minute_started_at = case when q.minute_started_at <= pg_catalog.now() - interval '1 minute'
      then pg_catalog.now() else q.minute_started_at end,
    minute_count = case when q.minute_started_at <= pg_catalog.now() - interval '1 minute'
      then 1 else q.minute_count + 1 end,
    hour_started_at = case when q.hour_started_at <= pg_catalog.now() - interval '1 hour'
      then pg_catalog.now() else q.hour_started_at end,
    hour_count = case when q.hour_started_at <= pg_catalog.now() - interval '1 hour'
      then 1 else q.hour_count + 1 end
  returning minute_count, hour_count into v_minute_count, v_hour_count;
  if v_minute_count > 20 or v_hour_count > 100 then
    raise exception 'Müşteri arama sınırına ulaşıldı; daha sonra tekrar deneyin'
      using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function private.reserve_staff_client_lookup(uuid) from public, anon, authenticated;

create function private.staff_search_clients(p_query text)
returns table(id uuid, full_name text, phone text)
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.assert_active_staff();
        v_key text := private.staff_client_key(p_query);
begin
  if pg_catalog.length(v_key) < 3 or pg_catalog.length(v_key) > 50 then
    raise exception 'En az 3 harfli, en çok 50 karakterli isim araması gerekli'
      using errcode = '22023';
  end if;
  perform private.reserve_staff_client_lookup(v_actor);
  return query
    select c.id, c.full_name, c.phone
    from public.clients c
    where c.active and pg_catalog.strpos(private.staff_client_key(c.full_name), v_key) > 0
    order by c.full_name, c.id
    limit 8;
end;
$$;
revoke all on function private.staff_search_clients(text) from public, anon, authenticated;
grant execute on function private.staff_search_clients(text) to authenticated;

create function public.staff_search_clients(p_query text)
returns table(id uuid, full_name text, phone text)
language sql security invoker set search_path = '' as $$
  select * from private.staff_search_clients(p_query);
$$;
revoke all on function public.staff_search_clients(text) from public, anon, authenticated;
grant execute on function public.staff_search_clients(text) to authenticated;

create function private.staff_create_client(p_name text, p_phone text)
returns table(id uuid, full_name text, phone text)
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.assert_active_staff();
        v_name text := pg_catalog.btrim(p_name);
        v_phone text := nullif(pg_catalog.btrim(p_phone), '');
        v_key text := private.staff_client_key(p_name);
        v_matches integer;
begin
  if pg_catalog.length(v_name) < 2 or pg_catalog.length(v_name) > 120
     or pg_catalog.length(v_key) < 2
     or pg_catalog.length(v_phone) > 32 then
    raise exception 'Geçerli müşteri adı ve telefonu gerekli' using errcode = '22023';
  end if;
  perform private.reserve_staff_client_lookup(v_actor);
  select count(*) into v_matches from public.clients c
    where c.active and private.staff_client_key(c.full_name) = v_key;
  if v_matches > 1 then
    raise exception 'Aynı isimde birden fazla müşteri var; öneri listesinden seçin'
      using errcode = '22023';
  end if;
  return query select c.id, c.full_name, c.phone from public.clients c
    where c.active and private.staff_client_key(c.full_name) = v_key limit 1;
  if found then return; end if;
  return query insert into public.clients (full_name, phone, created_by)
    values (v_name, v_phone, v_actor)
    returning clients.id, clients.full_name, clients.phone;
end;
$$;
revoke all on function private.staff_create_client(text,text) from public, anon, authenticated;
grant execute on function private.staff_create_client(text,text) to authenticated;

create function public.staff_create_client(p_name text, p_phone text)
returns table(id uuid, full_name text, phone text)
language sql security invoker set search_path = '' as $$
  select * from private.staff_create_client(p_name, p_phone);
$$;
revoke all on function public.staff_create_client(text,text) from public, anon, authenticated;
grant execute on function public.staff_create_client(text,text) to authenticated;

create function private.staff_owned_clients(p_after uuid default null, p_limit integer default 500)
returns table(id uuid, full_name text, phone text, note text,
  last_service_id uuid, last_employee_id uuid, last_appointment_at timestamptz, active boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := private.assert_active_staff();
begin
  return query
    select c.id, c.full_name, c.phone, c.note,
      c.last_service_id, c.last_employee_id, c.last_appointment_at, c.active
    from public.clients c
    where c.active and (p_after is null or c.id > p_after)
      and exists (select 1 from public.appointments a
        where a.client_id = c.id and a.employee_id = v_actor)
    order by c.id limit least(greatest(coalesce(p_limit, 500), 1), 500);
end;
$$;
revoke all on function private.staff_owned_clients(uuid,integer) from public, anon, authenticated;
grant execute on function private.staff_owned_clients(uuid,integer) to authenticated;

create function public.staff_owned_clients(p_after uuid default null, p_limit integer default 500)
returns table(id uuid, full_name text, phone text, note text,
  last_service_id uuid, last_employee_id uuid, last_appointment_at timestamptz, active boolean)
language sql security invoker set search_path = '' as $$
  select * from private.staff_owned_clients(p_after, p_limit);
$$;
revoke all on function public.staff_owned_clients(uuid,integer) from public, anon, authenticated;
grant execute on function public.staff_owned_clients(uuid,integer) to authenticated;

create function private.staff_client_intelligence(p_after uuid default null, p_limit integer default 500)
returns table(client_id uuid, full_name text, phone text, note text,
  visit_count integer, distinct_visit_days integer, last_visit_date date,
  average_visit_days integer, expected_next_visit_date date,
  preferred_employee_id uuid, preferred_service_id uuid,
  preferred_service_name text, recorded_spend numeric, spend_reliable boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := private.assert_active_staff();
begin
  return query
    select i.client_id, i.full_name, i.phone, i.note, i.visit_count,
      i.distinct_visit_days, i.last_visit_date, i.average_visit_days,
      i.expected_next_visit_date, i.preferred_employee_id,
      i.preferred_service_id, i.preferred_service_name,
      i.recorded_spend, i.spend_reliable
    from public.client_visit_intelligence i
    where (p_after is null or i.client_id > p_after)
      and exists (select 1 from public.appointments a
        where a.client_id = i.client_id and a.employee_id = v_actor)
    order by i.client_id limit least(greatest(coalesce(p_limit, 500), 1), 500);
end;
$$;
revoke all on function private.staff_client_intelligence(uuid,integer) from public, anon, authenticated;
grant execute on function private.staff_client_intelligence(uuid,integer) to authenticated;

create function public.staff_client_intelligence(p_after uuid default null, p_limit integer default 500)
returns table(client_id uuid, full_name text, phone text, note text,
  visit_count integer, distinct_visit_days integer, last_visit_date date,
  average_visit_days integer, expected_next_visit_date date,
  preferred_employee_id uuid, preferred_service_id uuid,
  preferred_service_name text, recorded_spend numeric, spend_reliable boolean)
language sql security invoker set search_path = '' as $$
  select * from private.staff_client_intelligence(p_after, p_limit);
$$;
revoke all on function public.staff_client_intelligence(uuid,integer) from public, anon, authenticated;
grant execute on function public.staff_client_intelligence(uuid,integer) to authenticated;
