-- Owner-only 09:00 Istanbul smart return digest. No outbound WhatsApp API calls.
create table if not exists public.customer_return_contacts (
  client_id uuid not null references public.clients(id) on delete cascade,
  last_visit date not null,
  contacted_at timestamptz not null default now(),
  contacted_by uuid not null references public.profiles(id),
  primary key (client_id,last_visit)
);
alter table public.customer_return_contacts enable row level security;
revoke all on public.customer_return_contacts from anon, authenticated;
grant select on public.customer_return_contacts to authenticated;

create table if not exists private.salon_return_daily_runs (
  digest_day date primary key,
  recipient_id uuid not null references public.profiles(id),
  notification_id uuid references public.notifications(id),
  created_at timestamptz not null default now()
);
revoke all on private.salon_return_daily_runs from public, anon, authenticated;

create or replace function private.salon_return_due_rows(p_today date)
returns table (
  client_id uuid, client_name text, phone text, last_visit date,
  average_days integer, elapsed_days integer, state text, has_consent boolean
)
language sql stable security definer set search_path = pg_catalog
as $$
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
     and not exists (
       select 1 from public.appointments future
       where future.client_id=s.client_id
         and future.status='confirmed' and future.scheduled_at>=now()
     )
     and not exists (
       select 1 from public.customer_return_contacts contact
       where contact.client_id=s.client_id and contact.last_visit=s.last_visit
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
$$;
revoke all on function private.salon_return_due_rows(date) from public,anon,authenticated;

create or replace function public.salon_return_due_clients()
returns table (
  client_id uuid, client_name text, phone text, last_visit date,
  average_days integer, elapsed_days integer, state text, has_consent boolean
)
language plpgsql stable security definer set search_path=pg_catalog
as $$
begin
  if not exists (
    select 1 from public.profiles p where p.id=auth.uid()
      and p.username='halil.kiv' and p.role='manager' and p.active=true
  ) then
    raise exception 'Bu liste yalnızca hesap sahibine açıktır.' using errcode='42501';
  end if;
  return query select * from private.salon_return_due_rows(
    (now() at time zone 'Europe/Istanbul')::date
  );
end;
$$;
revoke all on function public.salon_return_due_clients() from public,anon;
grant execute on function public.salon_return_due_clients() to authenticated;

create or replace function public.salon_mark_return_contact(p_client_id uuid, p_last_visit date)
returns boolean
language plpgsql security definer set search_path=pg_catalog
as $$
declare v_count integer;
begin
  if not exists (
    select 1 from public.profiles p where p.id=auth.uid()
      and p.username='halil.kiv' and p.role='manager' and p.active=true
  ) then
    raise exception 'Yetkisiz işlem.' using errcode='42501';
  end if;
  if not exists (
    select 1 from private.salon_return_due_rows(
      (now() at time zone 'Europe/Istanbul')::date
    ) d where d.client_id=p_client_id and d.last_visit=p_last_visit
  ) then
    return false;
  end if;
  insert into public.customer_return_contacts(client_id,last_visit,contacted_by)
  values (p_client_id,p_last_visit,auth.uid())
  on conflict(client_id,last_visit) do nothing;
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$$;
revoke all on function public.salon_mark_return_contact(uuid,date) from public,anon;
grant execute on function public.salon_mark_return_contact(uuid,date) to authenticated;

alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (
    kind=any(array[
      'appointment','appointment_update','appointment_reminder',
      'appointment_cancelled','appointment_reassigned_from',
      'booking_request','system','appointment_thank_you','mori_alert',
      'customer_return_due'
    ])
  );

create or replace function private.salon_enqueue_daily_return_digest()
returns jsonb
language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_day date:=(now() at time zone 'Europe/Istanbul')::date;
 v_owner uuid;
 v_count integer;
 v_notif uuid;
 v_row integer;
begin
 select p.id into v_owner from public.profiles p
 where p.username='halil.kiv' and p.role='manager' and p.active=true
 limit 1;
 if v_owner is null then return jsonb_build_object('status','no_owner'); end if;
 insert into private.salon_return_daily_runs(digest_day,recipient_id)
 values (v_day,v_owner)
 on conflict (digest_day) do nothing;
 get diagnostics v_row=row_count;
 if v_row=0 then return jsonb_build_object('status','already_created','day',v_day); end if;
 select count(*) into v_count from private.salon_return_due_rows(v_day);
 insert into public.notifications(recipient_id,kind,title,body)
 values (
   v_owner,'customer_return_due','Tıraş süresi dolan müşteriler',
   case when v_count=0
        then 'Bugün tıraş zamanı gelen müşteri bulunmuyor. Listeyi görmek için dokunun.'
        else v_count::text||' müşterinin tıraş zamanı geldi. Listeyi açıp WhatsApp mesajlarını tek tek hazırlayabilirsiniz.'
   end
 ) returning id into v_notif;
 update private.salon_return_daily_runs set notification_id=v_notif where digest_day=v_day;
 return jsonb_build_object('status','created','day',v_day,'count',v_count,'notification_id',v_notif);
end;
$$;
revoke all on function private.salon_enqueue_daily_return_digest() from public,anon,authenticated;
-- Supabase pg_cron uses UTC; 06:00 UTC equals 09:00 Europe/Istanbul year-round.
select cron.schedule(
 'salon-modern-customer-return-digest',
 '0 6 * * *',
 'select private.salon_enqueue_daily_return_digest()'
);
