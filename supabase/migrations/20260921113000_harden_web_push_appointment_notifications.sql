create or replace function public.claim_web_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth_secret text,
  p_user_agent text default null,
  p_device_label text default null,
  p_active boolean default true
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'Oturum gerekli.'; end if;
  if coalesce(trim(p_endpoint),'')='' or coalesce(trim(p_p256dh),'')='' or coalesce(trim(p_auth_secret),'')='' then
    raise exception 'Push abonelik bilgileri eksik.';
  end if;

  insert into public.web_push_subscriptions(
    user_id,endpoint,p256dh,auth_secret,user_agent,device_label,active,last_seen_at,updated_at
  ) values (
    v_user,p_endpoint,p_p256dh,p_auth_secret,left(p_user_agent,1000),left(p_device_label,120),p_active,now(),now()
  )
  on conflict (endpoint) do update set
    user_id=excluded.user_id,
    p256dh=excluded.p256dh,
    auth_secret=excluded.auth_secret,
    user_agent=excluded.user_agent,
    device_label=excluded.device_label,
    active=excluded.active,
    last_seen_at=now(),
    updated_at=now()
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.claim_web_push_subscription(text,text,text,text,text,boolean) from public, anon;
grant execute on function public.claim_web_push_subscription(text,text,text,text,text,boolean) to authenticated;

drop policy if exists web_push_subscriptions_read_own on public.web_push_subscriptions;
drop index if exists public.notifications_one_creator_reminder_per_schedule_idx;

create or replace function private.notify_appointment_assignment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.updated_by, new.created_by);
  v_future boolean := new.scheduled_at > now();
  v_body text;
begin
  if tg_op='INSERT' then
    if v_future and new.status='confirmed' and v_actor is distinct from new.employee_id then
      insert into public.notifications(recipient_id,appointment_id,kind,title,body)
      values(new.employee_id,new.id,'appointment','Yeni Randevu Size Atandı',
        'Müşteri: '||new.client_name||E'\nSaat: '||to_char(new.scheduled_at at time zone 'Europe/Istanbul','DD.MM.YYYY HH24:MI')||E'\nHizmet: '||new.service_name);
    end if;
    return new;
  end if;

  if new.status='cancelled' and old.status is distinct from 'cancelled' then
    if v_actor is distinct from old.employee_id then
      insert into public.notifications(recipient_id,appointment_id,kind,title,body)
      values(old.employee_id,new.id,'appointment_cancelled','Randevu İptal Edildi',
        to_char(old.scheduled_at at time zone 'Europe/Istanbul','HH24:MI')||' '||old.client_name||' randevusu iptal edildi.');
    end if;
    return new;
  end if;

  if not v_future or new.status<>'confirmed' then return new; end if;

  if new.employee_id is distinct from old.employee_id then
    if v_actor is distinct from old.employee_id then
      insert into public.notifications(recipient_id,appointment_id,kind,title,body)
      values(old.employee_id,new.id,'appointment_reassigned_from','Randevu Aktarıldı',
        new.client_name||' randevusu başka bir çalışana aktarıldı.');
    end if;
    if v_actor is distinct from new.employee_id then
      insert into public.notifications(recipient_id,appointment_id,kind,title,body)
      values(new.employee_id,new.id,'appointment_update','Yeni Randevu Size Atandı',
        'Müşteri: '||new.client_name||E'\nSaat: '||to_char(new.scheduled_at at time zone 'Europe/Istanbul','DD.MM.YYYY HH24:MI')||E'\nHizmet: '||new.service_name);
    end if;
  elsif (new.scheduled_at,new.service_id,new.client_id,new.client_name,new.note)
        is distinct from (old.scheduled_at,old.service_id,old.client_id,old.client_name,old.note)
        and v_actor is distinct from new.employee_id then
    v_body := new.client_name||'''ın randevusu '||
      to_char(new.scheduled_at at time zone 'Europe/Istanbul','DD.MM.YYYY HH24:MI')||' olarak güncellendi.';
    insert into public.notifications(recipient_id,appointment_id,kind,title,body)
    values(new.employee_id,new.id,'appointment_update','Randevu Güncellendi',v_body);
  end if;
  return new;
end;
$$;

create or replace function private.enqueue_due_appointment_reminders()
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare v_inserted integer:=0;
begin
  insert into public.notifications(recipient_id,appointment_id,kind,title,body,reminder_for)
  select a.employee_id,a.id,'appointment_reminder','Randevu Hatırlatması',
    a.client_name||'''ın randevusuna 1 saat kaldı.'||E'\nSaat: '||to_char(a.scheduled_at at time zone 'Europe/Istanbul','HH24:MI'),
    a.scheduled_at
  from public.appointments a
  join public.profiles p on p.id=a.employee_id and p.active
  where a.status='confirmed'
    and a.scheduled_at >= now()+interval '59 minutes'
    and a.scheduled_at < now()+interval '61 minutes'
  on conflict do nothing;
  get diagnostics v_inserted=row_count;
  return v_inserted;
end;
$$;
