-- Role-scoped, completed-only and past-only report, no client PII.
CREATE OR REPLACE FUNCTION public.staff_performance_report(p_start date, p_end date, p_employee_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_manager boolean := (SELECT private.is_manager());
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR NOT (SELECT private.is_active_salon_user()) THEN
    RAISE EXCEPTION 'Aktif oturum gerekli.' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR p_end - p_start > 366 THEN
    RAISE EXCEPTION 'Tarih aralığını kontrol edin (en fazla 367 gün).' USING ERRCODE = '22023';
  END IF;
  IF NOT v_manager AND p_employee_id IS NOT NULL AND p_employee_id <> v_actor THEN
    RAISE EXCEPTION 'Yalnızca kendi performansınızı görebilirsiniz.' USING ERRCODE = '42501';
  END IF;

  WITH workers AS (
    SELECT p.id, p.full_name, p.role, p.commission_pct, p.active
    FROM public.profiles p
    WHERE p.role IN ('manager','employee')
      AND (
        (v_manager AND (p_employee_id IS NULL OR p.id = p_employee_id))
        OR (NOT v_manager AND p.id = v_actor)
      )
      AND (
        p.active OR EXISTS (
          SELECT 1 FROM public.appointments old
          WHERE old.employee_id = p.id
            AND old.scheduled_at >= (p_start::timestamp AT TIME ZONE 'Europe/Istanbul')
            AND old.scheduled_at < ((p_end+1)::timestamp AT TIME ZONE 'Europe/Istanbul')
        )
      )
  ), employee_stats AS (
    SELECT w.id, w.full_name, w.role, w.commission_pct, w.active,
      COUNT(a.id) FILTER (WHERE a.status = 'completed') AS completed_count,
      COALESCE(SUM(a.amount) FILTER (WHERE a.status = 'completed'),0) AS revenue,
      COALESCE(SUM(ROUND(a.amount * w.commission_pct / 100.0,2))
        FILTER (WHERE a.status = 'completed'),0) AS commission
    FROM workers w
    LEFT JOIN public.appointments a
      ON a.employee_id = w.id
     AND a.scheduled_at >= (p_start::timestamp AT TIME ZONE 'Europe/Istanbul')
     AND a.scheduled_at < ((p_end + 1)::timestamp AT TIME ZONE 'Europe/Istanbul')
     AND a.status = 'completed'
     AND a.scheduled_at <= now()

    GROUP BY w.id,w.full_name,w.role,w.commission_pct,w.active
  )
  SELECT jsonb_build_object(
    'start_date',p_start,'end_date',p_end,'is_manager',v_manager,
    'employees',COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',id,'name',full_name,'role',role,'active',active,
        'commission_pct',commission_pct,
        'completed_count',completed_count,
        'revenue',revenue,'commission',commission
      ) ORDER BY full_name
    ),'[]'::jsonb),
    'totals',jsonb_build_object(
      'completed_count',COALESCE(SUM(completed_count),0),
      'revenue',COALESCE(SUM(revenue),0),
      'commission',COALESCE(SUM(commission),0)
    )
  ) INTO v_result
  FROM employee_stats;

  RETURN v_result;
END
$function$
;
REVOKE ALL ON FUNCTION public.staff_performance_report(date,date,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_performance_report(date,date,uuid) TO authenticated, service_role;