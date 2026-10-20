-- Future appointments only: give staff two hours to record a no-show before
-- an untouched confirmed appointment is completed automatically.
create table if not exists private.appointment_completion_automation (
  id boolean primary key default true check (id),
  activated_at timestamptz not null default now()
);
revoke all on private.appointment_completion_automation from public, anon, authenticated;
insert into private.appointment_completion_automation(id) values (true)
on conflict (id) do nothing;

create or replace function public.complete_appointment(p_appointment_id uuid)
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
    raise exception 'Bu randevuyu tamamlama yetkiniz yok.' using errcode='42501';
  end if;
  if v_row.status='completed' then
    return jsonb_build_object('id',v_row.id,'status',v_row.status,'completed_at',v_row.completed_at,'replayed',true);
  end if;
  if v_row.status<>'confirmed' then raise exception 'Yalnız aktif randevu tamamlanabilir.'; end if;
  if v_row.scheduled_at>now() then raise exception 'Randevu saati gelmeden tamamlanamaz.'; end if;
  update public.appointments set status='completed',staff_overlap_override=false
    where id=v_row.id returning * into v_row;
  return jsonb_build_object('id',v_row.id,'status',v_row.status,'completed_at',v_row.completed_at);
end $$;
revoke all on function public.complete_appointment(uuid) from public,anon;
grant execute on function public.complete_appointment(uuid) to authenticated;

create or replace function private.auto_complete_due_appointments()
returns integer language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare v_count integer;
begin
  with due as (
    select a.id from public.appointments a
    cross join private.appointment_completion_automation cfg
    where cfg.id and a.status='confirmed'
      and a.scheduled_at>=cfg.activated_at
      and a.scheduled_at+interval '2 hours'<=now()
      and a.scheduled_at+make_interval(mins=>greatest(coalesce(a.duration_minutes,30),1))<=now()
    order by a.scheduled_at,a.id
    limit 100 for update of a skip locked
  )
  update public.appointments a
    set status='completed',staff_overlap_override=false
    from due where a.id=due.id and a.status='confirmed';
  get diagnostics v_count=row_count;
  return v_count;
end $$;
revoke all on function private.auto_complete_due_appointments() from public,anon,authenticated;

-- The approved Meta template, customer consent and setting still gate delivery.
-- An old completion must never create a late thank-you burst.
update public.booking_settings
  set whatsapp_thank_you_enabled=true,whatsapp_thank_you_delay_minutes=120
  where id=true;
alter table public.booking_settings
  drop constraint if exists booking_settings_whatsapp_thank_you_delay_check,
  add constraint booking_settings_whatsapp_thank_you_delay_check
    check (whatsapp_thank_you_delay_minutes=120);

create or replace function public.whatsapp_enqueue_due_thank_yous()
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_count integer:=0;
begin
  insert into public.whatsapp_message_logs(
    idempotency_key,template_key,appointment_id,client_id,scheduled_for,next_attempt_at
  )
  select 'appointment_thank_you:'||a.id::text,
    'appointment_thank_you',a.id,a.client_id,
    a.scheduled_at+interval '2 hours',a.scheduled_at+interval '2 hours'
  from public.appointments a
  join public.clients c on c.id=a.client_id
  join public.booking_settings s on s.id=true
  join public.whatsapp_meta_template_mappings m on m.template_key='appointment_thank_you'
  where s.whatsapp_thank_you_enabled
    and m.approval_status='approved' and m.approved_content_hash is not null
    and a.status='completed' and a.completed_at is not null
    and a.completed_at<=a.scheduled_at+interval '2 hours 5 minutes'
    and c.whatsapp_marketing_opt_in and c.whatsapp_marketing_opt_in_at is not null
    and c.whatsapp_marketing_opt_out_at is null
    and a.scheduled_at+interval '2 hours'<=now()
    and a.scheduled_at+interval '2 hours'>=now()-interval '15 minutes'
  on conflict(idempotency_key) do nothing;
  get diagnostics v_count=row_count;
  return jsonb_build_object('appointment_thank_yous_enqueued',v_count);
end $$;
revoke all on function public.whatsapp_enqueue_due_thank_yous() from public,anon,authenticated;
grant execute on function public.whatsapp_enqueue_due_thank_yous() to service_role;

select cron.schedule('salon-modern-auto-complete','* * * * *',
  'select private.auto_complete_due_appointments()');
