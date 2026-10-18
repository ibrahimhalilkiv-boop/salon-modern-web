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
select private.mori_daily_tick();
