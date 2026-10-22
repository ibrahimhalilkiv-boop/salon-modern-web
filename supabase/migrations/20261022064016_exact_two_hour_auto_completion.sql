-- The two-hour boundary is measured from the appointment start, regardless
-- of service duration. The current schedule always wins after rescheduling.
create or replace function private.auto_complete_due_appointments()
returns integer language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare v_count integer;
begin
  with due as (
    select a.id from public.appointments a
    cross join private.appointment_completion_automation cfg
    where cfg.id and a.status='confirmed' and not a.auto_completion_suppressed
      and a.scheduled_at>=cfg.activated_at
      and a.scheduled_at+interval '2 hours'<=now()
    order by a.scheduled_at,a.id
    limit 100 for update of a skip locked
  )
  update public.appointments a
    set status='completed',staff_overlap_override=false
    from due where a.id=due.id and a.status='confirmed' and not a.auto_completion_suppressed;
  get diagnostics v_count=row_count;
  return v_count;
end $$;
revoke all on function private.auto_complete_due_appointments() from public,anon,authenticated;
