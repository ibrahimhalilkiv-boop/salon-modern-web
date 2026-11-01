-- Read only recommendation; booking creation still validates staff and slot separately.
create or replace function public.online_booking_recommended_employee(
  p_phone text, p_name text, p_employee_ids uuid[]
) returns uuid
language sql stable
set search_path = pg_catalog, public, private
as $function$
  select a.employee_id
  from public.appointments a
  join public.clients c on c.id = a.client_id
  where current_user = 'service_role'
    and private.normalize_tr_phone(c.phone) = private.normalize_tr_phone(p_phone)
    and lower(regexp_replace(btrim(c.full_name), '[[:space:]]+', ' ', 'g')) =
        lower(regexp_replace(btrim(p_name), '[[:space:]]+', ' ', 'g'))
    and a.status = 'completed'
    and a.scheduled_at < now()
    and a.employee_id = any(coalesce(p_employee_ids, array[]::uuid[]))
  group by a.employee_id
  order by count(*) desc, max(a.scheduled_at) desc, a.employee_id
  limit 1;
$function$;
revoke all on function public.online_booking_recommended_employee(text,text,uuid[]) from public, anon, authenticated;
grant execute on function public.online_booking_recommended_employee(text,text,uuid[]) to service_role;

-- Staff name lookup must be scoped to a client with that staff member's appointment.
create or replace function private.staff_search_clients(p_query text)
returns table(id uuid, full_name text, phone text)
language plpgsql security definer
set search_path = ''
as $function$
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
      and exists (select 1 from public.appointments a
        where a.client_id = c.id and a.employee_id = v_actor)
    order by c.full_name, c.id
    limit 8;
end;
$function$;

-- Keep historical delivery records visible to managers, without any manual send action.
create or replace function public.appointment_whatsapp_status(p_appointment_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, private
as $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not private.is_active_salon_user() or not private.is_manager() then
    raise exception 'Yönetici yetkisi gerekli.' using errcode='42501';
  end if;
  if not exists(select 1 from public.appointments where id=p_appointment_id) then
    raise exception 'Randevu bulunamadı.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',l.id,'template_key',l.template_key,
    'status',case when l.status='sent' and l.metadata->>'channel'='manual_wa_me' then 'manual_handled'
                  when l.status='failed' and l.metadata->>'manual_handled'='true' then 'manual_handled'
                  when l.status='failed' and l.metadata->>'channel'='manual_fallback' then 'manual_pending'
                  else l.status end,
    'can_manual',false,'can_mark',false,'can_legacy_manual',false
  ) order by l.created_at desc),'[]'::jsonb) into v_result
  from (select distinct on (template_key) id,template_key,status,metadata,created_at
        from public.whatsapp_message_logs
        where appointment_id=p_appointment_id
          and template_key in ('appointment_confirmation','appointment_update','appointment_reminder','appointment_cancelled')
        order by template_key,created_at desc,id desc) l;
  return v_result;
end $function$;

create or replace function public.prepare_manual_appointment_whatsapp(p_log_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private
as $function$
begin
  raise exception 'Randevu WhatsApp taslak gönderimi kapalı.' using errcode='42501';
end $function$;

create or replace function public.get_manual_cancel_whatsapp(p_appointment_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, private
as $function$
begin
  return jsonb_build_object('status','unavailable');
end $function$;

create or replace function public.mark_manual_cancel_whatsapp_sent(p_appointment_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private
as $function$
begin
  raise exception 'Randevu WhatsApp taslak gönderimi kapalı.' using errcode='42501';
end $function$;

create or replace function public.mark_manual_appointment_whatsapp_handled(p_log_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private
as $function$
begin
  raise exception 'Randevu WhatsApp taslak gönderimi kapalı.' using errcode='42501';
end $function$;

-- Exclude the non-bookable system manager from monthly employee reports.
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
    WHERE p.username <> 'salon.modern' AND p.role IN ('manager','employee')
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
