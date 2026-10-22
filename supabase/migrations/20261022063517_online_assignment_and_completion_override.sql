-- Keep a manager's explicit correction from completed back to confirmed.
alter table public.appointments
  add column if not exists auto_completion_suppressed boolean not null default false;

create or replace function private.track_appointment_completion_override()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $$
begin
  if old.status='completed' and new.status='confirmed'
     and auth.uid() is not null and private.is_manager() then
    new.auto_completion_suppressed:=true;
  elsif old.status is distinct from new.status and new.status='completed' then
    new.auto_completion_suppressed:=false;
  else
    new.auto_completion_suppressed:=old.auto_completion_suppressed;
  end if;
  return new;
end $$;
revoke all on function private.track_appointment_completion_override() from public,anon,authenticated;
drop trigger if exists appointments_track_completion_override on public.appointments;
create trigger appointments_track_completion_override
before update of status on public.appointments for each row
execute function private.track_appointment_completion_override();

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
      and a.scheduled_at+make_interval(mins=>greatest(coalesce(a.duration_minutes,30),1))<=now()
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

-- The existing appointment trigger creates exactly one notification on approval.
-- Set the requested title for online assignments without creating a second note.
create or replace function private.format_online_assignment_notification()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_appointment public.appointments%rowtype;
begin
  if new.kind not in ('appointment','appointment_update')
     or new.title<>'Yeni Randevu Size Atandı' or new.appointment_id is null then
    return new;
  end if;
  select * into v_appointment from public.appointments where id=new.appointment_id;
  if found and v_appointment.source='online' and v_appointment.status='confirmed'
     and v_appointment.employee_id=new.recipient_id then
    new.title:='Yeni Randevu Atandı';
    new.body:='Müşteri: '||v_appointment.client_name||E'\nTarih ve saat: '||
      to_char(v_appointment.scheduled_at at time zone 'Europe/Istanbul','DD.MM.YYYY HH24:MI');
  end if;
  return new;
end $$;
revoke all on function private.format_online_assignment_notification() from public,anon,authenticated;
drop trigger if exists notifications_format_online_assignment on public.notifications;
create trigger notifications_format_online_assignment
before insert on public.notifications for each row
execute function private.format_online_assignment_notification();

-- Managers can be the assigned employee. The older trigger skips the actor;
-- in that one case create the same single assignee notification.
create or replace function private.notify_online_self_assignment()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
begin
  if new.source='online' and new.status='confirmed' and new.scheduled_at>now()
     and new.employee_id=coalesce(auth.uid(),new.updated_by,new.created_by) then
    insert into public.notifications(recipient_id,appointment_id,kind,title,body)
    values(new.employee_id,new.id,'appointment','Yeni Randevu Atandı',
      'Müşteri: '||new.client_name||E'\nTarih ve saat: '||
      to_char(new.scheduled_at at time zone 'Europe/Istanbul','DD.MM.YYYY HH24:MI'));
  end if;
  return new;
end $$;
revoke all on function private.notify_online_self_assignment() from public,anon,authenticated;
drop trigger if exists appointments_notify_online_self_assignment on public.appointments;
create trigger appointments_notify_online_self_assignment
after insert on public.appointments for each row
execute function private.notify_online_self_assignment();
