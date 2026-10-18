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
select private.mori_scan();
