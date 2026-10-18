-- MORİ proactive monitoring. All jobs run on the server; no model invocation.

create table public.mori_follow_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  categories text[] not null default array['calendar','booking','debt','delivery','performance','cash','customers','daily'],
  digest_time time not null default time '09:00',
  quiet_start time not null default time '22:00',
  quiet_end time not null default time '08:00',
  updated_at timestamptz not null default now(),
  constraint mori_categories_valid check (categories <@ array['calendar','booking','debt','delivery','performance','cash','customers','daily']::text[])
);
alter table public.mori_follow_settings enable row level security;
revoke all on public.mori_follow_settings from anon, authenticated;
grant select on public.mori_follow_settings to authenticated;
grant all on public.mori_follow_settings to service_role;
create policy mori_settings_read_own on public.mori_follow_settings for select to authenticated
  using (user_id=(select auth.uid()));

create table public.mori_events (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  category text not null check (category in ('calendar','booking','debt','delivery','performance','cash','customers','daily')),
  severity text not null check (severity in ('info','important','critical')),
  title text not null,
  detail text not null,
  route text not null default 'salonAssistant',
  context jsonb not null default '{}'::jsonb,
  state text not null default 'active' check (state in ('active','resolved')),
  read_at timestamptz,
  resolved_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  notification_id uuid unique references public.notifications(id),
  unique (recipient_id,event_key)
);
create index mori_events_recipient_state_idx on public.mori_events(recipient_id,state,last_seen_at desc);
alter table public.mori_events enable row level security;
revoke all on public.mori_events from anon, authenticated;
grant select on public.mori_events to authenticated;
grant all on public.mori_events to service_role;
create policy mori_events_read_own on public.mori_events for select to authenticated
  using (recipient_id=(select auth.uid()));

create table public.mori_daily_summaries (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  business_date date not null,
  facts jsonb not null,
  created_at timestamptz not null default now(),
  unique (recipient_id,business_date)
);
alter table public.mori_daily_summaries enable row level security;
revoke all on public.mori_daily_summaries from anon,authenticated;
grant select on public.mori_daily_summaries to authenticated;
grant all on public.mori_daily_summaries to service_role;
create policy mori_daily_read_own on public.mori_daily_summaries for select to authenticated
  using (recipient_id=(select auth.uid()));

create table public.mori_ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  calls integer not null default 0 check (calls between 0 and 40),
  primary key(user_id,usage_date)
);
alter table public.mori_ai_usage enable row level security;
revoke all on public.mori_ai_usage from anon,authenticated;
grant all on public.mori_ai_usage to service_role;
create or replace function public.mori_claim_ai_call(p_user uuid) returns boolean
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare claimed integer;
begin
  insert into public.mori_ai_usage(user_id,usage_date,calls)
    values(p_user,(now() at time zone 'Europe/Istanbul')::date,1)
    on conflict (user_id,usage_date) do update set calls=public.mori_ai_usage.calls+1
      where public.mori_ai_usage.calls<40
    returning calls into claimed;
  return claimed is not null;
end $$;
revoke all on function public.mori_claim_ai_call(uuid) from public,anon,authenticated;
grant execute on function public.mori_claim_ai_call(uuid) to service_role;

alter table public.notifications add column mori_event_id uuid references public.mori_events(id) on delete set null;
create unique index notifications_mori_event_once on public.notifications(mori_event_id) where mori_event_id is not null;
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind = any (array[
  'appointment','appointment_update','appointment_reminder','appointment_cancelled',
  'appointment_reassigned_from','booking_request','system','appointment_thank_you','mori_alert'
]::text[]));

create or replace function private.mori_touch(
  p_recipient uuid,p_key text,p_category text,p_severity text,p_title text,p_detail text,
  p_route text,p_context jsonb,p_seen timestamptz
) returns void language sql security definer set search_path=pg_catalog,public as $$
  insert into public.mori_events(recipient_id,event_key,category,severity,title,detail,route,context,last_seen_at)
  values(p_recipient,p_key,p_category,p_severity,p_title,p_detail,p_route,p_context,p_seen)
  on conflict (recipient_id,event_key) do update set
    severity=excluded.severity,title=excluded.title,detail=excluded.detail,
    route=excluded.route,context=excluded.context,last_seen_at=excluded.last_seen_at,
    state='active',resolved_at=null,
    read_at=case when public.mori_events.state='resolved' then null else public.mori_events.read_at end;
$$;
revoke all on function private.mori_touch(uuid,text,text,text,text,text,text,jsonb,timestamptz) from public,anon,authenticated;

create or replace function private.mori_scan() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  tick timestamptz := clock_timestamp();
  local_day date := (clock_timestamp() at time zone 'Europe/Istanbul')::date;
  person record;
  item record;
  count_value integer;
  risk_count integer;
  previous_avg numeric;
  yesterday_amount numeric;
begin
  perform pg_advisory_xact_lock(hashtext('mori_scan'));
  insert into public.mori_follow_settings(user_id,enabled)
    select id,role='manager' from public.profiles where active and role in ('manager','employee')
    on conflict (user_id) do nothing;
  for person in select p.id,p.role from public.profiles p join public.mori_follow_settings s on s.user_id=p.id
    where p.active and p.role in ('manager','employee') and s.enabled loop
    if person.role='manager' then
      select count(*) into count_value from public.online_booking_requests where status='pending';
      if count_value>0 then
        perform private.mori_touch(person.id,'booking-pending','booking','important',
          'Bekleyen randevu talepleri',count_value||' online randevu talebi incelenmeyi bekliyor.',
          'bookingRequests',jsonb_build_object('count',count_value),tick);
      end if;
      select count(*) into count_value from public.customer_debts
        where status='open' and amount>0 and debt_date<=local_day-14;
      if count_value>0 then
        perform private.mori_touch(person.id,'aged-debts','debt','important',
          'Gecikmiş açık borçlar',count_value||' açık borç kaydı en az 14 gündür bekliyor.',
          'debts',jsonb_build_object('count',count_value),tick);
      end if;
      select count(*) into count_value from public.notifications
        where kind<>'mori_alert' and created_at>=tick-interval '24 hours'
          and created_at<tick-interval '10 minutes'
          and pushed_at is null and last_push_error is not null
          and exists(select 1 from public.web_push_deliveries d where d.notification_id=notifications.id
            and d.status in ('delivery_unknown','expired'))
          and not exists(select 1 from public.web_push_deliveries d where d.notification_id=notifications.id
            and d.status='sent');
      if count_value>0 then
        perform private.mori_touch(person.id,'delivery-failure','delivery','critical',
          'Bildirim teslimat sorunu',count_value||' yakın tarihli bildirimde teslimat hatası var.',
          'pushSettings',jsonb_build_object('count',count_value),tick);
      end if;
      select count(*) into risk_count from public.client_visit_intelligence
        where distinct_visit_days>=3 and average_visit_days>0 and last_visit_date is not null
          and (local_day-last_visit_date)::numeric/average_visit_days>=1.75;
      if risk_count>0 then
        perform private.mori_touch(person.id,'risk-clients','customers','info',
          'Riskli müşteriler',risk_count||' müşterinin ziyaret aralığı olağanın belirgin üstünde.',
          'recoveryCenter',jsonb_build_object('count',risk_count),tick);
      end if;
      select gross_turnover into yesterday_amount from public.daily_cash_closings
        where business_date=local_day-1 and status='closed' order by revision desc limit 1;
      select avg(gross_turnover) into previous_avg from (
        select distinct on (business_date) gross_turnover,business_date from public.daily_cash_closings
        where business_date<local_day-1 and business_date>=local_day-35 and status='closed'
          and extract(dow from business_date)=extract(dow from local_day-1)
        order by business_date desc,revision desc limit 4
      ) baseline;
      if yesterday_amount is not null and previous_avg>0
        and (select count(distinct business_date) from public.daily_cash_closings
          where business_date<local_day-1 and business_date>=local_day-35 and status='closed'
            and extract(dow from business_date)=extract(dow from local_day-1))>=4
        and yesterday_amount<previous_avg*0.5 then
        perform private.mori_touch(person.id,'turnover-drop-'||(local_day-1),'cash','important',
          'Ciro düşüşünü inceleyin','Dünkü kapanış, önceki dört aynı hafta gününün ortalamasının yarısından düşük.',
          'finance',jsonb_build_object('date',local_day-1),tick);
      end if;
      for item in select business_date from public.daily_cash_closings
        where business_date>=local_day-2 and status='closed'
          and (commission_total<0 or commission_total>gross_turnover) loop
        perform private.mori_touch(person.id,'commission-check-'||item.business_date,'performance','critical',
          'Prim hesabını inceleyin',item.business_date||' kapanışındaki prim toplamı ciroyla tutarsız.',
          'employeePerformance',jsonb_build_object('date',item.business_date),tick);
      end loop;
    end if;
    for item in
      select a.id first_id,b.id second_id,a.scheduled_at,a.employee_id
      from public.appointments a join public.appointments b on a.employee_id=b.employee_id and a.id<b.id
        and a.scheduled_at<coalesce(b.scheduled_end,b.scheduled_at+make_interval(mins=>b.duration_minutes))
        and b.scheduled_at<coalesce(a.scheduled_end,a.scheduled_at+make_interval(mins=>a.duration_minutes))
      where a.status='confirmed' and b.status='confirmed'
        and a.scheduled_at>=tick and a.scheduled_at<tick+interval '7 days'
        and (person.role='manager' or a.employee_id=person.id)
      limit 30 loop
      perform private.mori_touch(person.id,'overlap-'||item.first_id||'-'||item.second_id,
        'calendar','critical','Takvimde randevu çakışması',
        to_char(item.scheduled_at at time zone 'Europe/Istanbul','DD.MM.YYYY HH24:MI')||' saatinde aynı çalışan için iki randevu var.',
        'calendar',jsonb_build_object('appointment_id',item.first_id,'other_id',item.second_id),tick);
    end loop;
    if person.role='manager' then
      for item in select employee_id,(scheduled_at at time zone 'Europe/Istanbul')::date business_day,count(*) total
        from public.appointments where status='confirmed' and scheduled_at>=tick
          and scheduled_at<tick+interval '8 days'
        group by employee_id,(scheduled_at at time zone 'Europe/Istanbul')::date having count(*)>=8 loop
        perform private.mori_touch(person.id,'busy-'||item.employee_id||'-'||item.business_day,
          'calendar','info','Yaklaşan yoğun gün',
          item.business_day||' günü bir çalışanda '||item.total||' onaylı randevu var. Müsaitliği takvimden kontrol edin.',
          'calendar',jsonb_build_object('date',item.business_day,'employee_id',item.employee_id,'count',item.total),tick);
      end loop;
    end if;
  end loop;
  update public.mori_events e set state='resolved',resolved_at=tick
    where e.state='active' and e.category<>'daily' and e.last_seen_at<tick
      and exists(select 1 from public.mori_follow_settings s where s.user_id=e.recipient_id and s.enabled);
end $$;
revoke all on function private.mori_scan() from public,anon,authenticated;

create or replace function private.mori_queue_notifications() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare item record; local_clock time := (clock_timestamp() at time zone 'Europe/Istanbul')::time; note_id uuid;
begin
  for item in
    select e.id,e.recipient_id,e.title,e.category,s.quiet_start,s.quiet_end
    from public.mori_events e join public.mori_follow_settings s on s.user_id=e.recipient_id
    join public.profiles p on p.id=e.recipient_id and p.active
    where e.state='active' and e.notification_id is null and s.enabled and e.category=any(s.categories)
    order by e.first_seen_at limit 100
  loop
    if item.quiet_start<item.quiet_end and local_clock>=item.quiet_start and local_clock<item.quiet_end then continue; end if;
    if item.quiet_start>item.quiet_end and (local_clock>=item.quiet_start or local_clock<item.quiet_end) then continue; end if;
    insert into public.notifications(recipient_id,kind,title,body,mori_event_id)
      values(item.recipient_id,'mori_alert','MORİ: '||item.title,'MORİ içinde ayrıntıları görüntüleyin.',item.id)
      on conflict (mori_event_id) where mori_event_id is not null do update
        set id=public.notifications.id
      returning id into note_id;
    update public.mori_events set notification_id=note_id where id=item.id and notification_id is null;
  end loop;
end $$;
revoke all on function private.mori_queue_notifications() from public,anon,authenticated;

create or replace function private.mori_daily_tick() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  local_day date := (clock_timestamp() at time zone 'Europe/Istanbul')::date;
  local_time time := date_trunc('minute',clock_timestamp() at time zone 'Europe/Istanbul')::time;
  person record; facts jsonb; summary_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('mori_daily_tick'));
  for person in select p.id from public.profiles p join public.mori_follow_settings s on s.user_id=p.id
    where p.active and p.role='manager' and s.enabled and 'daily'=any(s.categories)
      and s.digest_time<=local_time loop
    select jsonb_build_object(
      'date',local_day,
      'appointments',(select count(*) from public.appointments where status<>'cancelled'
        and (scheduled_at at time zone 'Europe/Istanbul')::date=local_day),
      'staff',(select coalesce(jsonb_agg(jsonb_build_object('name',p.full_name,'appointments',
        (select coalesce(jsonb_agg(to_char(a.scheduled_at at time zone 'Europe/Istanbul','HH24:MI') order by a.scheduled_at),'[]'::jsonb)
         from public.appointments a where a.employee_id=p.id and a.status<>'cancelled'
           and (a.scheduled_at at time zone 'Europe/Istanbul')::date=local_day))), '[]'::jsonb)
         from public.profiles p where p.active and (p.full_name ilike 'Cengiz%' or p.full_name ilike 'Talip%')),
      'yesterday_turnover',(select gross_turnover from public.daily_cash_closings
        where business_date=local_day-1 and status='closed' order by revision desc limit 1),
      'performance',(select coalesce(jsonb_agg(jsonb_build_object('name',p.full_name,'completed',x.completed,
        'recorded_amount',x.amount,'commission_pct',p.commission_pct,
        'calculated_commission',round(x.amount*coalesce(p.commission_pct,0)/100,2))),'[]'::jsonb)
        from public.profiles p cross join lateral
          (select count(*) completed,coalesce(sum(a.amount),0) amount from public.appointments a
           where a.employee_id=p.id and a.status='completed'
             and (a.scheduled_at at time zone 'Europe/Istanbul')::date=local_day) x
        where p.active and p.role='employee'),
      'pending_requests',(select count(*) from public.online_booking_requests where status='pending'),
      'active_alerts',(select count(*) from public.mori_events where recipient_id=person.id and state='active' and category<>'daily')
    ) into facts;
    insert into public.mori_daily_summaries(recipient_id,business_date,facts)
      values(person.id,local_day,facts) on conflict do nothing returning id into summary_id;
    if summary_id is not null then
      perform private.mori_touch(person.id,'daily-'||local_day,'daily','info',
        'Günlük işletme özeti',local_day||' işletme özeti hazır. MORİ içinde ayrıntıları açın.',
        'salonAssistant',jsonb_build_object('summary_id',summary_id,'date',local_day),clock_timestamp());
    end if;
  end loop;
  perform private.mori_queue_notifications();
end $$;
revoke all on function private.mori_daily_tick() from public,anon,authenticated;

select cron.schedule('mori-proactive-scan','*/15 * * * *',
  'select private.mori_scan()');
select cron.schedule('mori-daily-tick','* * * * *',
  'select private.mori_daily_tick()');
select cron.schedule('mori-proactive-retention','41 2 * * *',
  $$delete from public.mori_events where state='resolved' and resolved_at<now()-interval '90 days';
    delete from public.mori_daily_summaries where business_date<(now() at time zone 'Europe/Istanbul')::date-30$$);
