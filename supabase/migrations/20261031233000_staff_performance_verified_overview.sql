-- Server-verified all-employee performance overview, with per-user RLS isolation.
-- Daily/weekly/monthly/all-time metrics use only completed and past appointments.
-- Occupancy uses booking_settings default 09:00-20:00 (or configured values)
-- plus booking_schedule_overrides, not a 16-hour assumed workday.
-- No appointment, customer, or finance records are changed.
CREATE OR REPLACE FUNCTION public.staff_performance_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_manager boolean := (SELECT private.is_manager());
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_month date := date_trunc('month',now() at time zone 'Europe/Istanbul')::date;
  v_week date := date_trunc('week',now() at time zone 'Europe/Istanbul')::date;
  v_capacity numeric := 0;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR NOT (SELECT private.is_active_salon_user()) THEN
    RAISE EXCEPTION 'Aktif oturum gerekli.' USING ERRCODE='42501';
  END IF;

  -- Use the salon's actual working-time configuration and date overrides,
  -- not a fixed hypothetical 16-hour workday.
  SELECT COALESCE(sum(
    CASE WHEN o.is_closed IS TRUE THEN 0::numeric
      ELSE greatest(0::numeric,
        extract(epoch from (coalesce(o.close_time,s.default_close_time) -
                            coalesce(o.open_time,s.default_open_time)))::numeric/60)
    END
  ),0) INTO v_capacity
  FROM generate_series(v_month::timestamp,v_today::timestamp,interval '1 day') AS d(day)
  JOIN public.booking_settings s ON s.id=true
  LEFT JOIN public.booking_schedule_overrides o ON o.schedule_date=d.day::date;

  WITH workers AS (
    SELECT p.id,p.full_name,p.role,p.commission_pct
    FROM public.profiles p
    WHERE p.active AND p.role IN ('manager','employee') AND p.username<>'salon.modern'
      AND (v_manager OR p.id=v_actor)
  ),
  completed AS (
    SELECT a.employee_id,a.client_id,a.amount,
      a.duration_minutes,
      (a.scheduled_at at time zone 'Europe/Istanbul')::date AS local_day,
      (a.scheduled_at at time zone 'Europe/Istanbul')::time AS local_time
    FROM public.appointments a
    JOIN workers w ON w.id=a.employee_id
    WHERE a.status='completed' AND a.scheduled_at<=now()
  ),
  metrics AS (
    SELECT w.id,w.full_name,w.role,w.commission_pct,
      count(c.employee_id) AS lifetime_count,
      count(c.employee_id) FILTER (WHERE c.local_day>=v_month AND c.local_day<=v_today) AS month_count,
      count(c.employee_id) FILTER (WHERE c.local_day>=v_week AND c.local_day<=v_today) AS week_count,
      count(c.employee_id) FILTER (WHERE c.local_day=v_today) AS today_count,
      coalesce(sum(c.amount) FILTER (WHERE c.local_day>=v_month AND c.local_day<=v_today),0) AS monthly_ciro,
      coalesce(sum(c.amount) FILTER (WHERE c.local_day>=v_week AND c.local_day<=v_today),0) AS week_ciro,
      coalesce(sum(c.amount) FILTER (WHERE c.local_day=v_today),0) AS today_ciro,
      coalesce(sum(round(c.amount*w.commission_pct/100.0,2)) FILTER (WHERE c.local_day>=v_month AND c.local_day<=v_today),0) AS monthly_commission,
      coalesce(sum(round(c.amount*w.commission_pct/100.0,2)) FILTER (WHERE c.local_day>=v_week AND c.local_day<=v_today),0) AS week_commission,
      coalesce(sum(round(c.amount*w.commission_pct/100.0,2)) FILTER (WHERE c.local_day=v_today),0) AS today_commission,
      coalesce(sum(c.duration_minutes) FILTER (WHERE c.local_day>=v_month AND c.local_day<=v_today),0) AS monthly_minutes
    FROM workers w LEFT JOIN completed c ON c.employee_id=w.id
    GROUP BY w.id,w.full_name,w.role,w.commission_pct
  ),
  per_client AS (
    SELECT c.employee_id,c.client_id,count(*) AS visits
    FROM completed c WHERE c.client_id IS NOT NULL
    GROUP BY c.employee_id,c.client_id
  ),
  customer_stats AS (
    SELECT employee_id,count(*) AS unique_clients,
      count(*) FILTER (WHERE visits>1) AS repeat_clients
    FROM per_client GROUP BY employee_id
  ),
  times AS (
    SELECT employee_id,
      to_char(date_trunc('hour',local_time),'HH24:MI') AS hour,
      count(*) AS visits
    FROM completed
    WHERE local_day>=v_month AND local_day<=v_today
    GROUP BY employee_id,to_char(date_trunc('hour',local_time),'HH24:MI')
  ),
  busiest AS (
    SELECT DISTINCT ON (employee_id) employee_id,hour
    FROM times ORDER BY employee_id,visits DESC,hour ASC
  )
  SELECT jsonb_build_object(
    'as_of',v_today,
    'month',to_char(v_month,'YYYY-MM'),
    'week_start',v_week,
    'is_manager',v_manager,
    'capacity_minutes',v_capacity,
    'employees',COALESCE(jsonb_agg(jsonb_build_object(
      'id',m.id,'name',m.full_name,'role',m.role,
      'today_count',m.today_count,'week_count',m.week_count,
      'month_count',m.month_count,'lifetime_count',m.lifetime_count,
      'today_amount',CASE WHEN m.role='employee' THEN m.today_commission ELSE m.today_ciro END,
      'week_amount',CASE WHEN m.role='employee' THEN m.week_commission ELSE m.week_ciro END,
      'month_amount',CASE WHEN m.role='employee' THEN m.monthly_commission ELSE m.monthly_ciro END,
      'monthly_ciro',m.monthly_ciro,
      'monthly_commission',m.monthly_commission,
      'customers_lifetime',COALESCE(cs.unique_clients,0),
      'repeat_pct',CASE WHEN COALESCE(cs.unique_clients,0)=0 THEN 0
        ELSE round(100.0*cs.repeat_clients/cs.unique_clients) END,
      'month_minutes',m.monthly_minutes,
      'occupancy_pct',CASE WHEN v_capacity<=0 THEN 0
        ELSE least(100,round(100.0*m.monthly_minutes/v_capacity)) END,
      'busiest_hour_month',b.hour
    ) ORDER BY m.role,m.full_name),'[]'::jsonb)
  ) INTO v_result
  FROM metrics m
  LEFT JOIN customer_stats cs ON cs.employee_id=m.id
  LEFT JOIN busiest b ON b.employee_id=m.id;

  RETURN v_result;
END;
$function$
;

REVOKE ALL ON FUNCTION public.staff_performance_overview() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_performance_overview() TO authenticated,service_role;
