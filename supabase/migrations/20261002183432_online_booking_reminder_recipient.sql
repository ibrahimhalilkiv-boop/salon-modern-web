-- Preserve manual creator routing; automatic online bookings have no staff creator.
create or replace function private.enqueue_due_appointment_reminders()
returns integer language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare v_inserted integer:=0;
begin
  insert into public.notifications(recipient_id,appointment_id,kind,title,body,reminder_for)
  select recipient.id,a.id,'appointment_reminder','Randevu Hatırlatması',
    a.client_name||'''ın randevusuna '||
    case when a.scheduled_at-now()>=interval '59 minutes'
      then '1 saat'
      else ceil(extract(epoch from (a.scheduled_at-now()))/60)::integer::text||' dakika'
    end||' kaldı.'||E'\nSaat: '||to_char(a.scheduled_at at time zone 'Europe/Istanbul','HH24:MI'),
    a.scheduled_at
  from public.appointments a
  join public.profiles recipient on recipient.active and recipient.id=
    case when a.created_by is not null then a.created_by
      when exists(select 1 from public.online_booking_requests r where r.appointment_id=a.id) then a.employee_id
      else null end
  where a.status='confirmed'
    and a.scheduled_at>=now()+interval '55 minutes'
    and a.scheduled_at<=now()+interval '60 minutes'
  on conflict do nothing;
  get diagnostics v_inserted=row_count;
  return v_inserted;
end $$;
