-- Complete due appointments at their scheduled start, including records
-- subsequently reopened by a manager. A past "confirmed" record must not
-- remain outside staff commission reports simply because an earlier
-- completed -> confirmed edit set auto_completion_suppressed=true.
--
-- Keep explicit cancelled/no_show statuses untouched, and retain the
-- original automation activation cutoff for older historical records.
-- pg_cron already calls this function every minute (job 14).
CREATE OR REPLACE FUNCTION private.auto_complete_due_appointments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH due AS (
    SELECT a.id
    FROM public.appointments a
    CROSS JOIN private.appointment_completion_automation cfg
    WHERE cfg.id
      AND a.status = 'confirmed'
      AND a.scheduled_at >= cfg.activated_at
      AND a.scheduled_at <= now()
    ORDER BY a.scheduled_at, a.id
    LIMIT 100
    FOR UPDATE OF a SKIP LOCKED
  )
  UPDATE public.appointments a
  SET status = 'completed',
      staff_overlap_override = false,
      -- Preserve the original automatic completion timestamp on a reopened
      -- appointment, while assigning one to first-time auto-completions.
      auto_completed_at = COALESCE(a.auto_completed_at, now())
  FROM due
  WHERE a.id = due.id
    AND a.status = 'confirmed';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$function$;

-- Keep this scheduled maintenance function unavailable to client roles.
REVOKE ALL ON FUNCTION private.auto_complete_due_appointments() FROM PUBLIC, anon, authenticated;
