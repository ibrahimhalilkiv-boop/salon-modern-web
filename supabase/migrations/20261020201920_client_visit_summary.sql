-- The caller's appointments RLS determines which visits can be analysed.
-- Historical confirmed appointments predate the completion workflow; only
-- confirmed appointments already in the past are treated as legacy visits.
create or replace function public.salon_client_visit_summary(p_after uuid default null, p_limit integer default 500)
returns table (
  client_id uuid,
  visit_count integer,
  last_visit date,
  average_days integer,
  preferred_employee_id uuid
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with selected_clients as materialized (
    select c.id from public.clients c
    where c.active = true and (p_after is null or c.id > p_after)
    order by c.id
    limit least(greatest(p_limit, 1), 500)
  ), eligible as (
    select a.client_id, a.employee_id,
           (a.scheduled_at at time zone 'Europe/Istanbul')::date as visit_day
    from public.appointments a
    join selected_clients c on c.id = a.client_id
    where (a.status = 'completed' or (a.status = 'confirmed' and a.scheduled_at < now()))
      and (a.scheduled_at at time zone 'Europe/Istanbul')::date
          <= (now() at time zone 'Europe/Istanbul')::date
  ), visited_days as (
    select distinct e.client_id, e.visit_day from eligible e
  ), intervals as (
    select d.client_id, d.visit_day,
           d.visit_day - lag(d.visit_day) over (partition by d.client_id order by d.visit_day) as gap_days
    from visited_days d
  ), summaries as (
    select i.client_id, count(*)::integer as visit_count,
           max(i.visit_day) as last_visit,
           greatest(1, round(avg(i.gap_days) filter (where i.gap_days > 0))::integer) as average_days
    from intervals i group by i.client_id
  ), employees as (
    select e.client_id, e.employee_id,
           row_number() over (partition by e.client_id order by count(*) desc, e.employee_id) as rank
    from eligible e where e.employee_id is not null
    group by e.client_id, e.employee_id
  )
  select c.id, coalesce(s.visit_count, 0), s.last_visit, s.average_days, e.employee_id
  from selected_clients c
  left join summaries s on s.client_id = c.id
  left join employees e on e.client_id = c.id and e.rank = 1
  order by c.id;
$$;

revoke all on function public.salon_client_visit_summary(uuid, integer) from public, anon;
grant execute on function public.salon_client_visit_summary(uuid, integer) to authenticated;
