-- This status-only update is repeatable. Existing WhatsApp enqueue logic does
-- not enqueue on completion; the thank-you cron only considers the last 15 min.
-- The appointment trigger writes completed_at. Financial rows are untouched.
update public.appointments a
set status='completed'
where a.status='confirmed'
  and (a.scheduled_at at time zone 'Europe/Istanbul')::date
      < (now() at time zone 'Europe/Istanbul')::date
  and (a.source<>'online' or exists (
    select 1 from public.online_booking_requests r
    where r.appointment_id=a.id and r.status='approved'
  ));
