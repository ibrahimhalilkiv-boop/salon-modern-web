-- One staff push per completed appointment, using the existing notification
-- trigger, device subscriptions and web push dispatcher. No customer message
-- is sent or marked as sent by this queue.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind = any (array[
  'appointment','appointment_update','appointment_reminder','appointment_cancelled',
  'appointment_reassigned_from','booking_request','system','appointment_thank_you'
]));

create unique index notifications_one_thank_you_per_appointment
  on public.notifications(appointment_id) where kind='appointment_thank_you';

create or replace function private.enqueue_due_manual_thank_you_pushes()
returns integer language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare v_inserted integer:=0;
begin
  insert into public.notifications(recipient_id,appointment_id,kind,title,body,reminder_for)
  select recipient.id,a.id,'appointment_thank_you',
    '💈 Salon Modern — Teşekkür Zamanı',
    a.client_name||' için teşekkür mesajı hazır. WhatsApp''tan göndermek için dokunun.',
    a.completed_at+make_interval(mins=>s.whatsapp_thank_you_delay_minutes)
  from public.appointments a
  join public.booking_settings s on s.id=true
  join public.clients c on c.id=a.client_id
  join public.profiles recipient on recipient.active and recipient.id=
    case when a.created_by is not null then a.created_by
      when exists(select 1 from public.online_booking_requests r where r.appointment_id=a.id) then a.employee_id
      else null end
  where a.status='completed' and a.completed_at is not null
    and a.completed_at+make_interval(mins=>s.whatsapp_thank_you_delay_minutes)<=now()
    and a.completed_at+make_interval(mins=>s.whatsapp_thank_you_delay_minutes)>=now()-interval '30 minutes'
    and c.whatsapp_marketing_opt_in and c.whatsapp_marketing_opt_in_at is not null
    and c.whatsapp_marketing_opt_out_at is null
    and nullif(private.normalize_tr_phone(c.phone),'') is not null
    and not exists(select 1 from public.whatsapp_message_logs l
      where l.idempotency_key='appointment_thank_you:'||a.id::text)
  on conflict do nothing;
  get diagnostics v_inserted=row_count;
  return v_inserted;
end $$;
revoke all on function private.enqueue_due_manual_thank_you_pushes() from public,anon,authenticated;

-- Both push transports recheck current eligibility immediately before delivery.
create or replace function public.manual_thank_you_push_is_current(p_notification_id uuid)
returns boolean language sql stable security definer
set search_path=pg_catalog,public,private as $$
  select exists(
    select 1 from public.notifications n
    join public.appointments a on a.id=n.appointment_id
    join public.booking_settings s on s.id=true
    join public.clients c on c.id=a.client_id
    join public.profiles recipient on recipient.id=n.recipient_id and recipient.active
    where n.id=p_notification_id and n.kind='appointment_thank_you'
      and n.reminder_for=a.completed_at+make_interval(mins=>s.whatsapp_thank_you_delay_minutes)
      and n.reminder_for<=now() and a.status='completed' and a.completed_at is not null
      and n.recipient_id=case when a.created_by is not null then a.created_by
        when exists(select 1 from public.online_booking_requests r where r.appointment_id=a.id) then a.employee_id
        else null end
      and c.whatsapp_marketing_opt_in and c.whatsapp_marketing_opt_in_at is not null
      and c.whatsapp_marketing_opt_out_at is null
      and nullif(private.normalize_tr_phone(c.phone),'') is not null
      and not exists(select 1 from public.whatsapp_message_logs l
        where l.idempotency_key='appointment_thank_you:'||a.id::text)
  );
$$;
revoke all on function public.manual_thank_you_push_is_current(uuid) from public,anon,authenticated;
grant execute on function public.manual_thank_you_push_is_current(uuid) to service_role;

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
      and n.kind in ('appointment','appointment_update','appointment_reminder','appointment_thank_you')
      and (case when n.kind='appointment_thank_you'
        then public.manual_thank_you_push_is_current(n.id)
        else n.appointment_id is null or exists(
          select 1 from public.appointments a where a.id=n.appointment_id
            and a.scheduled_at>now() and a.status='confirmed'
            and (n.kind<>'appointment_reminder' or (a.reminder_eligible and n.reminder_for=a.scheduled_at))
        ) end)
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

create or replace function public.list_manual_whatsapp_thank_yous()
returns table(appointment_id uuid,client_id uuid,client_name text,client_phone text,
  scheduled_at timestamptz,completed_at timestamptz,eligible_at timestamptz)
language sql stable security definer set search_path=pg_catalog,public,private as $$
  select a.id,a.client_id,c.full_name,c.phone,a.scheduled_at,a.completed_at,
    a.completed_at+make_interval(mins=>s.whatsapp_thank_you_delay_minutes)
  from public.appointments a
  join public.clients c on c.id=a.client_id
  join public.booking_settings s on s.id=true
  where auth.uid() is not null and private.is_active_salon_user()
    and (private.is_manager() or auth.uid()=case when a.created_by is not null then a.created_by
      when exists(select 1 from public.online_booking_requests r where r.appointment_id=a.id) then a.employee_id
      else null end)
    and a.status='completed' and a.completed_at is not null
    and a.completed_at+make_interval(mins=>s.whatsapp_thank_you_delay_minutes)<=now()
    and c.whatsapp_marketing_opt_in and c.whatsapp_marketing_opt_in_at is not null
    and c.whatsapp_marketing_opt_out_at is null
    and nullif(private.normalize_tr_phone(c.phone),'') is not null
    and not exists(select 1 from public.whatsapp_message_logs l
      where l.idempotency_key='appointment_thank_you:'||a.id::text)
  order by a.completed_at;
$$;
revoke all on function public.list_manual_whatsapp_thank_yous() from public,anon;
grant execute on function public.list_manual_whatsapp_thank_yous() to authenticated;

create or replace function public.mark_manual_whatsapp_thank_you_sent(p_appointment_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
  v_appointment public.appointments%rowtype;
  v_client public.clients%rowtype;
  v_delay integer:=120;
  v_key text:='appointment_thank_you:'||p_appointment_id::text;
  v_log_id uuid;
begin
  if auth.uid() is null or not private.is_active_salon_user() then
    raise exception 'Oturum gerekli.' using errcode='42501';
  end if;
  select * into v_appointment from public.appointments where id=p_appointment_id for update;
  if not found then raise exception 'Randevu bulunamadı.'; end if;
  if not private.is_manager() and auth.uid() is distinct from
    (case when v_appointment.created_by is not null then v_appointment.created_by
      when exists(select 1 from public.online_booking_requests r where r.appointment_id=v_appointment.id)
        then v_appointment.employee_id else null end) then
    raise exception 'Bu kayıt için yetkiniz yok.' using errcode='42501';
  end if;
  if v_appointment.status<>'completed' or v_appointment.completed_at is null then
    raise exception 'Yalnız tamamlanmış randevu kapatılabilir.';
  end if;
  select * into v_client from public.clients where id=v_appointment.client_id;
  if not found or not v_client.whatsapp_marketing_opt_in
     or v_client.whatsapp_marketing_opt_in_at is null
     or v_client.whatsapp_marketing_opt_out_at is not null
     or nullif(private.normalize_tr_phone(v_client.phone),'') is null then
    raise exception 'Müşterinin geçerli pazarlama iletişim izni veya telefonu yok.';
  end if;
  select coalesce(whatsapp_thank_you_delay_minutes,120) into v_delay
  from public.booking_settings where id=true;
  if v_appointment.completed_at+make_interval(mins=>v_delay)>now() then
    raise exception 'Teşekkür mesajı için bekleme süresi henüz dolmadı.';
  end if;
  select id into v_log_id from public.whatsapp_message_logs where idempotency_key=v_key;
  if found then
    return jsonb_build_object('appointment_id',v_appointment.id,'status','already_recorded','replayed',true);
  end if;
  insert into public.whatsapp_message_logs(
    idempotency_key,template_key,appointment_id,client_id,scheduled_for,next_attempt_at,
    status,attempt_count,sent_at,status_at,metadata,last_error
  ) values (
    v_key,'appointment_thank_you',v_appointment.id,v_appointment.client_id,
    v_appointment.completed_at+make_interval(mins=>v_delay),now(),
    'sent',0,now(),now(),jsonb_build_object('channel','manual_wa_me','confirmed_by',auth.uid()),null
  ) returning id into v_log_id;
  return jsonb_build_object('appointment_id',v_appointment.id,'message_log_id',v_log_id,'status','sent','manual',true);
end $$;
revoke all on function public.mark_manual_whatsapp_thank_you_sent(uuid) from public,anon;
grant execute on function public.mark_manual_whatsapp_thank_you_sent(uuid) to authenticated;

-- The existing minute-granularity pg_cron infrastructure schedules this queue.
select cron.schedule('salon-modern-manual-thank-you-push','* * * * *',
  'select private.enqueue_due_manual_thank_you_pushes()');
