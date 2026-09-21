create or replace function private.enqueue_due_appointment_reminders()
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare v_inserted integer:=0;
begin
  insert into public.notifications(recipient_id,appointment_id,kind,title,body,reminder_for)
  select a.created_by,a.id,'appointment_reminder','Randevu Hatırlatması',
    a.client_name||'''ın randevusuna 1 saat kaldı.'||E'\nSaat: '||to_char(a.scheduled_at at time zone 'Europe/Istanbul','HH24:MI'),
    a.scheduled_at
  from public.appointments a
  join public.profiles p on p.id=a.created_by and p.active
  where a.status='confirmed'
    and a.created_by is not null
    and a.scheduled_at >= now()+interval '59 minutes'
    and a.scheduled_at < now()+interval '61 minutes'
  on conflict do nothing;
  get diagnostics v_inserted=row_count;
  return v_inserted;
end;
$$;
