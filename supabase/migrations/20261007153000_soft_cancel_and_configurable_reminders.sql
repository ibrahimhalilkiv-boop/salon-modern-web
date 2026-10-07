-- Preserve appointment history on normal cancellation and move all automatic
-- reminder scheduling to one configurable 90-minute policy.

alter table public.booking_settings
  add column if not exists appointment_reminder_minutes integer not null default 90,
  add column if not exists appointment_reminder_catchup_minutes integer not null default 30;

alter table public.booking_settings
  drop constraint if exists booking_settings_appointment_reminder_minutes_check,
  add constraint booking_settings_appointment_reminder_minutes_check
    check (appointment_reminder_minutes between 15 and 1440),
  drop constraint if exists booking_settings_appointment_reminder_catchup_minutes_check,
  add constraint booking_settings_appointment_reminder_catchup_minutes_check
    check (appointment_reminder_catchup_minutes between 1 and appointment_reminder_minutes);

alter table public.appointments
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancellation_source text,
  add column if not exists cancellation_reason text,
  add column if not exists reminder_eligible boolean not null default false,
  add column if not exists reminder_target_at timestamptz;

-- Rows cancelled before metadata existed remain valid historical records.
update public.appointments set
  cancelled_at=coalesce(cancelled_at,updated_at,created_at),
  cancellation_source=coalesce(cancellation_source,'system')
where status='cancelled' and (cancelled_at is null or cancellation_source is null);

alter table public.appointments
  drop constraint if exists appointments_cancellation_source_check,
  add constraint appointments_cancellation_source_check
    check (cancellation_source is null or cancellation_source in ('admin','staff','customer','system')),
  drop constraint if exists appointments_cancellation_metadata_check,
  add constraint appointments_cancellation_metadata_check check (
    (status='cancelled' and cancelled_at is not null and cancellation_source is not null)
    or
    (status<>'cancelled' and cancelled_at is null and cancelled_by is null and cancellation_source is null and cancellation_reason is null)
  );

create or replace function private.set_appointment_reminder_schedule()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_minutes integer:=90;
begin
  if tg_op='INSERT' or new.scheduled_at is distinct from old.scheduled_at then
    select coalesce(appointment_reminder_minutes,90) into v_minutes
      from public.booking_settings where id=true;
    v_minutes:=coalesce(v_minutes,90);
    new.reminder_eligible:=new.scheduled_at>=now()+make_interval(mins=>v_minutes);
    new.reminder_target_at:=case when new.reminder_eligible
      then new.scheduled_at-make_interval(mins=>v_minutes) else null end;
  end if;
  return new;
end $$;

revoke all on function private.set_appointment_reminder_schedule() from public,anon,authenticated;

drop trigger if exists appointments_set_reminder_schedule on public.appointments;
create trigger appointments_set_reminder_schedule
before insert or update of scheduled_at on public.appointments
for each row execute function private.set_appointment_reminder_schedule();

-- Existing future appointments are eligible only if their creation time was at
-- least the configured lead time before the appointment. Historical rows never
-- enter the reminder queue.
update public.appointments a set
  reminder_eligible=(
    a.status='confirmed'
    and a.scheduled_at>now()
    and a.created_at<=a.scheduled_at-make_interval(mins=>s.appointment_reminder_minutes)
  ),
  reminder_target_at=case
    when a.status='confirmed' and a.scheduled_at>now()
      and a.created_at<=a.scheduled_at-make_interval(mins=>s.appointment_reminder_minutes)
    then a.scheduled_at-make_interval(mins=>s.appointment_reminder_minutes)
    else null end
from public.booking_settings s where s.id=true;

create or replace function private.set_appointment_cancellation_metadata()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
  v_requested_source text:=nullif(current_setting('salon.cancellation_source',true),'');
begin
  if new.status='cancelled' and (tg_op='INSERT' or old.status is distinct from 'cancelled') then
    new.cancelled_at:=now();
    if auth.uid() is not null then
      new.cancelled_by:=auth.uid();
      new.cancellation_source:=case when private.is_manager() then 'admin' else 'staff' end;
    else
      new.cancelled_by:=null;
      new.cancellation_source:=case when v_requested_source in ('customer','system') then v_requested_source else 'system' end;
    end if;
    new.cancellation_reason:=nullif(left(trim(coalesce(new.cancellation_reason,'')),500),'');
  elsif new.status<>'cancelled' then
    new.cancelled_at:=null;
    new.cancelled_by:=null;
    new.cancellation_source:=null;
    new.cancellation_reason:=null;
  elsif tg_op='UPDATE' then
    new.cancelled_at:=old.cancelled_at;
    new.cancelled_by:=old.cancelled_by;
    new.cancellation_source:=old.cancellation_source;
    new.cancellation_reason:=old.cancellation_reason;
  end if;
  return new;
end $$;

revoke all on function private.set_appointment_cancellation_metadata() from public,anon,authenticated;

drop trigger if exists appointments_set_cancellation_metadata on public.appointments;
create trigger appointments_set_cancellation_metadata
before insert or update of status,cancelled_at,cancelled_by,cancellation_source,cancellation_reason on public.appointments
for each row execute function private.set_appointment_cancellation_metadata();

create or replace function public.cancel_appointment(p_appointment_id uuid,p_reason text default null)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
  v_actor uuid:=auth.uid();
  v_row public.appointments%rowtype;
begin
  if v_actor is null then raise exception 'Oturum gerekli.' using errcode='42501'; end if;
  select * into v_row from public.appointments where id=p_appointment_id for update;
  if not found then raise exception 'Randevu bulunamadı.'; end if;
  if not private.is_manager() and v_row.employee_id is distinct from v_actor then
    raise exception 'Bu randevuyu iptal etme yetkiniz yok.' using errcode='42501';
  end if;
  if v_row.status='cancelled' then
    return jsonb_build_object('id',v_row.id,'status',v_row.status,'cancelled_at',v_row.cancelled_at,'replayed',true);
  end if;
  if v_row.status<>'confirmed' then raise exception 'Yalnız aktif randevu iptal edilebilir.'; end if;
  update public.appointments set
    status='cancelled',staff_overlap_override=false,cancellation_reason=nullif(left(trim(coalesce(p_reason,'')),500),'')
  where id=v_row.id
  returning * into v_row;
  return jsonb_build_object('id',v_row.id,'status',v_row.status,'cancelled_at',v_row.cancelled_at,'cancellation_source',v_row.cancellation_source);
end $$;

revoke all on function public.cancel_appointment(uuid,text) from public,anon;
grant execute on function public.cancel_appointment(uuid,text) to authenticated;

-- Physical deletion remains available to the service role for controlled
-- maintenance, but is no longer an authenticated application operation.
drop policy if exists appointments_delete_by_manager_or_assignee on public.appointments;
revoke delete on public.appointments from authenticated;

create or replace function private.enqueue_due_appointment_reminders()
returns integer language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
  v_inserted integer:=0;
  v_catchup integer:=30;
begin
  select coalesce(appointment_reminder_catchup_minutes,30) into v_catchup
    from public.booking_settings where id=true;
  v_catchup:=coalesce(v_catchup,30);
  insert into public.notifications(recipient_id,appointment_id,kind,title,body,reminder_for)
  select recipient.id,a.id,'appointment_reminder','Randevu Hatırlatması',
    a.client_name||'''ın bugün saat '||to_char(a.scheduled_at at time zone 'Europe/Istanbul','HH24:MI')||' randevusu yaklaşıyor.',
    a.scheduled_at
  from public.appointments a
  join public.profiles recipient on recipient.active and recipient.id=
    case when a.created_by is not null then a.created_by
      when exists(select 1 from public.online_booking_requests r where r.appointment_id=a.id) then a.employee_id
      else null end
  where a.status='confirmed' and a.reminder_eligible and a.reminder_target_at is not null
    and a.reminder_target_at<=now()
    and a.reminder_target_at>=now()-make_interval(mins=>v_catchup)
  on conflict do nothing;
  get diagnostics v_inserted=row_count;
  return v_inserted;
end $$;

create or replace function private.retry_pending_notification_pushes()
returns integer language plpgsql security definer
set search_path=pg_catalog,public,net as $$
declare
  v_notification public.notifications%rowtype;
  v_queued integer:=0;
begin
  for v_notification in
    select n.* from public.notifications n
    where n.pushed_at is null and coalesce(n.push_attempts,0)<3
      and n.created_at<=now()-interval '20 seconds' and n.created_at>=now()-interval '6 hours'
      and n.kind in ('appointment','appointment_update','appointment_reminder')
      and (n.appointment_id is null or exists(
        select 1 from public.appointments a where a.id=n.appointment_id
          and a.scheduled_at>now() and a.status='confirmed'
          and (n.kind<>'appointment_reminder' or (a.reminder_eligible and n.reminder_for=a.scheduled_at))
      ))
    order by n.created_at limit 50
  loop
    perform net.http_post(
      url:='https://oxuwwjsakhcqimjsfris.supabase.co/functions/v1/send-assignment-push',
      headers:=jsonb_build_object('Content-Type','application/json'),
      body:=jsonb_build_object('type','INSERT','table','notifications','schema','public','record',to_jsonb(v_notification)),
      timeout_milliseconds:=30000
    );
    v_queued:=v_queued+1;
  end loop;
  return v_queued;
end $$;

create or replace function public.whatsapp_enqueue_due_reminders()
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
  v_count integer:=0;
  v_catchup integer:=30;
begin
  select coalesce(appointment_reminder_catchup_minutes,30) into v_catchup
    from public.booking_settings where id=true;
  v_catchup:=coalesce(v_catchup,30);
  insert into public.whatsapp_message_logs(idempotency_key,template_key,appointment_id,client_id,scheduled_for,next_attempt_at)
  select 'appointment_reminder:'||a.id::text||':'||extract(epoch from a.scheduled_at)::bigint::text,
    'appointment_reminder',a.id,a.client_id,a.reminder_target_at,now()
  from public.appointments a
  where a.status='confirmed' and a.reminder_eligible and a.reminder_target_at is not null
    and a.reminder_target_at<=now()
    and a.reminder_target_at>=now()-make_interval(mins=>v_catchup)
  on conflict(idempotency_key) do nothing;
  get diagnostics v_count=row_count;
  return jsonb_build_object('appointment_reminders_enqueued',v_count);
end $$;

create or replace function public.whatsapp_claim_message_logs(p_limit integer default 25)
returns setof public.whatsapp_message_logs language plpgsql security definer
set search_path=pg_catalog,public as $$
begin
  update public.whatsapp_message_logs l set
    status='skipped_event_invalid',
    last_error=case when a.id is null then 'appointment_not_found'
      when a.status='cancelled' then 'appointment_cancelled' else 'appointment_rescheduled' end,
    updated_at=now()
  from (select l2.id log_id,a2.id,a2.status,a2.reminder_target_at
    from public.whatsapp_message_logs l2
    left join public.appointments a2 on a2.id=l2.appointment_id
    where l2.status='queued' and l2.template_key='appointment_reminder'
      and (a2.id is null or a2.status<>'confirmed' or not a2.reminder_eligible
        or a2.reminder_target_at is distinct from l2.scheduled_for)) a
  where l.id=a.log_id;

  return query
  with candidates as (
    select id from public.whatsapp_message_logs
    where status='queued' and next_attempt_at<=now() and attempt_count<3
    order by next_attempt_at,created_at
    limit greatest(1,least(coalesce(p_limit,25),100)) for update skip locked
  )
  update public.whatsapp_message_logs l set
    status='sending',attempt_count=l.attempt_count+1,updated_at=now()
  from candidates where l.id=candidates.id returning l.*;
end $$;

create or replace function private.invalidate_stale_appointment_reminders()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
begin
  if new.status='cancelled' or new.scheduled_at is distinct from old.scheduled_at
     or new.reminder_target_at is distinct from old.reminder_target_at then
    update public.web_push_deliveries d set
      status='expired',last_error=case when new.status='cancelled' then 'appointment_cancelled' else 'appointment_rescheduled' end,updated_at=now()
    from public.notifications n
    where n.id=d.notification_id and n.appointment_id=new.id and n.kind='appointment_reminder'
      and n.reminder_for is distinct from case when new.status='cancelled' then null else new.scheduled_at end
      and d.status in ('queued','failed','delivery_unknown');
    update public.whatsapp_message_logs l set
      status='skipped_event_invalid',last_error=case when new.status='cancelled' then 'appointment_cancelled' else 'appointment_rescheduled' end,updated_at=now()
    where l.appointment_id=new.id and l.template_key='appointment_reminder'
      and l.status in ('queued','failed','delivery_unknown')
      and (new.status='cancelled' or l.scheduled_for is distinct from new.reminder_target_at);
  end if;
  return new;
end $$;

revoke all on function private.invalidate_stale_appointment_reminders() from public,anon,authenticated;

drop trigger if exists appointments_invalidate_stale_reminders on public.appointments;
create trigger appointments_invalidate_stale_reminders
after update of status,scheduled_at,reminder_target_at on public.appointments
for each row execute function private.invalidate_stale_appointment_reminders();

create or replace function private.refresh_appointment_reminder_schedule()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
begin
  if new.appointment_reminder_minutes is distinct from old.appointment_reminder_minutes then
    update public.appointments a set
      reminder_eligible=(a.scheduled_at>=now()+make_interval(mins=>new.appointment_reminder_minutes)),
      reminder_target_at=case
        when a.scheduled_at>=now()+make_interval(mins=>new.appointment_reminder_minutes)
        then a.scheduled_at-make_interval(mins=>new.appointment_reminder_minutes)
        else null end
    where a.status='confirmed' and a.scheduled_at>now();
  end if;
  return new;
end $$;

revoke all on function private.refresh_appointment_reminder_schedule() from public,anon,authenticated;

drop trigger if exists booking_settings_refresh_appointment_reminders on public.booking_settings;
create trigger booking_settings_refresh_appointment_reminders
after update of appointment_reminder_minutes on public.booking_settings
for each row execute function private.refresh_appointment_reminder_schedule();

-- Keep the existing customer portal's token, revision, row lock and exact
-- two-hour boundary unchanged; only record trustworthy cancellation metadata.
create or replace function public.manage_customer_online_booking(p_token uuid,p_operation uuid,p_revision integer,p_action text,p_start timestamptz default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare request public.online_booking_requests%rowtype; appointment public.appointments%rowtype;
  old_start timestamptz; notification_kind text; notification_title text; notification_body text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Yetkisiz işlem.' using errcode='42501'; end if;
  if p_operation is null or p_action not in ('update','cancel') then raise exception 'Geçersiz işlem.'; end if;
  select * into request from public.online_booking_requests where public_token=p_token for update;
  if not found or request.appointment_id is null then raise exception 'Randevu bulunamadı.'; end if;
  if request.last_customer_operation=p_operation then return jsonb_build_object('status',request.status,'revision',request.customer_revision,'replayed',true); end if;
  if p_revision is distinct from request.customer_revision then raise exception 'Randevu değişti. Bilgileri yenileyin.'; end if;
  select * into appointment from public.appointments where id=request.appointment_id for update;
  if not found or appointment.status<>'confirmed' or request.status<>'approved' or appointment.scheduled_at<=now() then raise exception 'Bu randevu artık değiştirilemez.'; end if;
  if appointment.scheduled_at<now()+interval '2 hours' then
    raise exception 'Randevunuza 2 saatten az kaldığı için online değişiklik veya iptal yapılamamaktadır. Lütfen Salon Modern ile iletişime geçiniz.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(appointment.employee_id::text,93));
  old_start:=appointment.scheduled_at;
  if p_action='update' then
    perform private.check_online_booking_window(p_start,appointment.duration_minutes);
    if exists(select 1 from public.appointments a where a.employee_id=appointment.employee_id and a.id<>appointment.id
      and a.status<>'cancelled' and a.scheduled_at<p_start+make_interval(mins=>appointment.duration_minutes) and a.scheduled_end>p_start) then raise exception 'Seçilen saat artık müsait değil.'; end if;
    if exists(select 1 from public.closed_time_slots c where c.employee_id=appointment.employee_id
      and p_start<c.ends_at and p_start+make_interval(mins=>appointment.duration_minutes)>c.starts_at) then raise exception 'Seçilen saat kapalı.'; end if;
    if p_start<>old_start then
      update public.appointments set scheduled_at=p_start,staff_overlap_override=false where id=appointment.id;
      notification_kind:='appointment_update'; notification_title:='Randevu güncellendi';
      notification_body:=appointment.client_name||' · Eski: '||to_char(old_start at time zone 'Europe/Istanbul','DD.MM.YYYY HH24:MI')||' · Yeni: '||to_char(p_start at time zone 'Europe/Istanbul','DD.MM.YYYY HH24:MI')||' · '||appointment.service_name;
    end if;
    update public.online_booking_requests set scheduled_at=p_start,employee_id=appointment.employee_id,duration_minutes=appointment.duration_minutes,
      customer_revision=customer_revision+1,last_customer_operation=p_operation where id=request.id;
  else
    perform set_config('salon.cancellation_source','customer',true);
    update public.appointments set status='cancelled',staff_overlap_override=false where id=appointment.id;
    update public.online_booking_requests set status='cancelled',customer_revision=customer_revision+1,last_customer_operation=p_operation where id=request.id;
    notification_kind:='appointment_cancelled'; notification_title:='Randevu iptal edildi';
    notification_body:=appointment.client_name||' · '||to_char(old_start at time zone 'Europe/Istanbul','DD.MM.YYYY HH24:MI')||' · '||appointment.service_name||' · Müşteri tarafından iptal edildi';
  end if;
  if notification_kind is not null then
    notification_body:=left(notification_body||' · '||coalesce((select full_name from public.profiles where id=appointment.employee_id),''),500);
    insert into public.notifications(recipient_id,appointment_id,kind,title,body)
      select id,appointment.id,notification_kind,notification_title,notification_body from public.profiles
      where active and role='manager' and (id<>appointment.employee_id or coalesce(auth.uid(),appointment.updated_by,appointment.created_by)=appointment.employee_id);
  end if;
  return jsonb_build_object('status',case when p_action='cancel' then 'cancelled' else 'approved' end,'revision',request.customer_revision+1);
end $$;

revoke all on function public.manage_customer_online_booking(uuid,uuid,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.manage_customer_online_booking(uuid,uuid,integer,text,timestamptz) to service_role;
