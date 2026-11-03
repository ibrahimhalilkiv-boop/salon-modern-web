-- A due appointment is completed by the existing minute cron at its start time.
-- Keep the activation boundary, no-show/cancelled states, and manager override.
alter table public.appointments
  add column if not exists auto_completed_at timestamptz;

create or replace function private.guard_auto_completed_at()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public as $$
begin
  if tg_op='INSERT' then
    if new.auto_completed_at is not null then
      raise exception 'Otomatik tamamlama zamanı elle yazılamaz.' using errcode='42501';
    end if;
  elsif new.auto_completed_at is distinct from old.auto_completed_at
        and (current_user<>'postgres' or auth.uid() is not null) then
    raise exception 'Otomatik tamamlama zamanı elle değiştirilemez.' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_auto_completed_at() from public,anon,authenticated;
create trigger appointments_guard_auto_completed_at
before insert or update of auto_completed_at on public.appointments
for each row execute function private.guard_auto_completed_at();

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
      and a.scheduled_at<=now()
    order by a.scheduled_at,a.id
    limit 100 for update of a skip locked
  )
  update public.appointments a
    set status='completed',staff_overlap_override=false,auto_completed_at=now()
    from due where a.id=due.id and a.status='confirmed' and not a.auto_completion_suppressed;
  get diagnostics v_count=row_count;
  return v_count;
end $$;
revoke all on function private.auto_complete_due_appointments() from public,anon,authenticated;

-- Explicitly corrected appointments must remain corrected on the next tick.
create or replace function private.track_appointment_completion_override()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $$
begin
  if old.status in ('completed','no_show') and new.status='confirmed'
     and auth.uid() is not null and private.is_manager() then
    new.auto_completion_suppressed:=true;
  elsif old.status is distinct from new.status and new.status='completed' then
    new.auto_completion_suppressed:=false;
  else
    new.auto_completion_suppressed:=old.auto_completion_suppressed;
  end if;
  return new;
end $$;

-- After instant automatic completion, staff can still correct their own
-- appointment to no_show. A manually completed appointment stays final.
create or replace function private.guard_appointment_no_show()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare v_actor uuid:=auth.uid();
begin
  if tg_op='INSERT' then
    if new.status='no_show' then
      raise exception 'Gelmedi durumu yalnız mevcut randevuya uygulanabilir.' using errcode='23514';
    end if;
    return new;
  end if;

  if old.status is distinct from new.status and new.status='no_show' then
    if not (old.status='confirmed' or
            (old.status='completed' and old.auto_completed_at is not null and old.completed_by is null))
       or new.scheduled_at>now() then
      raise exception 'Yalnız saati gelen aktif veya otomatik tamamlanan randevu Gelmedi olarak işaretlenebilir.' using errcode='23514';
    end if;
    if v_actor is null or not private.is_active_salon_user() or
       (not private.is_manager() and old.employee_id is distinct from v_actor) then
      raise exception 'Bu randevuyu Gelmedi olarak işaretleme yetkiniz yok.' using errcode='42501';
    end if;
    new.no_show_at:=now();
    new.no_show_by:=v_actor;
    new.no_show_reversed_at:=null;
    new.no_show_reversed_by:=null;
    new.no_show_reversal_reason:=null;
  elsif old.status='no_show' and old.status is distinct from new.status then
    if new.status<>'confirmed' or v_actor is null or not private.is_manager() then
      raise exception 'Gelmedi durumunu yalnız yönetici geri alabilir.' using errcode='42501';
    end if;
    if nullif(trim(new.no_show_reversal_reason),'') is null then
      raise exception 'Geri alma nedeni gereklidir.' using errcode='23514';
    end if;
    new.no_show_at:=old.no_show_at;
    new.no_show_by:=old.no_show_by;
    new.no_show_reversed_at:=now();
    new.no_show_reversed_by:=v_actor;
    new.no_show_reversal_reason:=left(trim(new.no_show_reversal_reason),500);
  else
    new.no_show_at:=old.no_show_at;
    new.no_show_by:=old.no_show_by;
    new.no_show_reversed_at:=old.no_show_reversed_at;
    new.no_show_reversed_by:=old.no_show_reversed_by;
    new.no_show_reversal_reason:=old.no_show_reversal_reason;
  end if;
  return new;
end $$;

create or replace function public.mark_appointment_no_show(p_appointment_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare v_row public.appointments%rowtype;
begin
  if auth.uid() is null or not private.is_active_salon_user() then
    raise exception 'Aktif personel oturumu gerekli.' using errcode='42501';
  end if;
  select * into v_row from public.appointments where id=p_appointment_id for update;
  if not found then raise exception 'Randevu bulunamadı.'; end if;
  if not private.is_manager() and v_row.employee_id is distinct from auth.uid() then
    raise exception 'Bu randevuyu yönetme yetkiniz yok.' using errcode='42501';
  end if;
  if not (v_row.status='confirmed' or
          (v_row.status='completed' and v_row.auto_completed_at is not null and v_row.completed_by is null))
     or v_row.scheduled_at>now() then
    raise exception 'Yalnız saati gelen aktif veya otomatik tamamlanan randevu Gelmedi olarak işaretlenebilir.';
  end if;
  update public.appointments set status='no_show',staff_overlap_override=false
    where id=v_row.id returning * into v_row;
  return jsonb_build_object('id',v_row.id,'status',v_row.status,'no_show_at',v_row.no_show_at);
end $$;
revoke all on function public.mark_appointment_no_show(uuid) from public,anon;
grant execute on function public.mark_appointment_no_show(uuid) to authenticated;
