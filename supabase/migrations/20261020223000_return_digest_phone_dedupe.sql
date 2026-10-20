CREATE OR REPLACE FUNCTION private.salon_return_due_rows(p_today date)
 RETURNS TABLE(client_id uuid, client_name text, phone text, last_visit date, average_days integer, elapsed_days integer, state text, has_consent boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 with visited_days as (
   select a.client_id, (a.scheduled_at at time zone 'Europe/Istanbul')::date as visit_day
   from public.appointments a
   where a.client_id is not null
     and a.status in ('confirmed','completed')
     and a.scheduled_at < now()
     and (a.scheduled_at at time zone 'Europe/Istanbul')::date < p_today
   group by a.client_id,(a.scheduled_at at time zone 'Europe/Istanbul')::date
 ), intervals as (
   select d.client_id,d.visit_day,
          d.visit_day - lag(d.visit_day) over (partition by d.client_id order by d.visit_day) as gap_days
   from visited_days d
 ), stats as (
   select i.client_id,count(*) as visit_count,max(i.visit_day) as last_visit,
          round(avg(i.gap_days) filter (where i.gap_days > 0))::integer as average_days
   from intervals i group by i.client_id
 ), eligible as (
   select c.id as client_id,c.full_name::text as client_name,
          private.normalize_tr_phone(c.phone)::text as phone,s.last_visit,s.average_days,
          (p_today-s.last_visit)::integer as elapsed_days,
          case when (p_today-s.last_visit)::numeric >= (s.average_days * 1.75) then 'risk'
               when (p_today-s.last_visit)::numeric >= (s.average_days * 1.25) then 'overdue'
               else 'due' end::text as state,
          (c.whatsapp_marketing_opt_in is true and c.whatsapp_marketing_opt_in_at is not null
            and c.whatsapp_marketing_opt_out_at is null) as has_consent
   from stats s
   join public.clients c on c.id=s.client_id
   where c.active is true and c.deleted_at is null and c.whatsapp_marketing_opt_out_at is null
     and s.visit_count>=3 and s.average_days>=1
     and p_today-s.last_visit >= s.average_days
     and private.normalize_tr_phone(c.phone) is not null
     -- Treat duplicate customer profiles with the same phone as one recipient.
     and not exists (
       select 1 from public.appointments future
       join public.clients booked_client on booked_client.id=future.client_id
       where private.normalize_tr_phone(booked_client.phone)=private.normalize_tr_phone(c.phone)
         and future.status='confirmed' and future.scheduled_at>=now()
     )
     and not exists (
       select 1 from public.customer_return_contacts contact
       join public.clients contacted_client on contacted_client.id=contact.client_id
       where private.normalize_tr_phone(contacted_client.phone)=private.normalize_tr_phone(c.phone)
         and contact.contacted_at >= (s.last_visit::timestamp at time zone 'Europe/Istanbul')
     )
     and not exists (
       select 1 from public.clients opted_out
       where private.normalize_tr_phone(opted_out.phone)=private.normalize_tr_phone(c.phone)
         and opted_out.whatsapp_marketing_opt_out_at is not null
     )
 ), ranked as (
   select e.*, row_number() over (
     partition by e.phone order by e.last_visit desc,e.client_id
   ) as phone_rank
   from eligible e
 )
 select r.client_id,r.client_name,r.phone,r.last_visit,r.average_days,
        r.elapsed_days,r.state,r.has_consent
 from ranked r where r.phone_rank=1
 order by case r.state when 'risk' then 1 when 'overdue' then 2 else 3 end,
          r.elapsed_days desc, r.client_name
$function$
;
