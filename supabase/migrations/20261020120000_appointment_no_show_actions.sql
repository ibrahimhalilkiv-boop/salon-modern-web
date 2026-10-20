-- Keep no-shows as appointments. Their status is also the source of truth for
-- the existing rolling six-month online booking gate.
alter table public.appointments
  add column if not exists no_show_at timestamptz,
  add column if not exists no_show_by uuid references public.profiles(id) on delete set null,
  add column if not exists no_show_reversed_at timestamptz,
  add column if not exists no_show_reversed_by uuid references public.profiles(id) on delete set null,
  add column if not exists no_show_reversal_reason text;

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
    if old.status<>'confirmed' or new.scheduled_at>now() then
      raise exception 'Yalnız saati gelen aktif randevu Gelmedi olarak işaretlenebilir.' using errcode='23514';
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

revoke all on function private.guard_appointment_no_show() from public,anon,authenticated;
drop trigger if exists appointments_guard_no_show on public.appointments;
create trigger appointments_guard_no_show
before insert or update of status,no_show_at,no_show_by,no_show_reversed_at,no_show_reversed_by,no_show_reversal_reason
on public.appointments for each row execute function private.guard_appointment_no_show();

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
  if v_row.status<>'confirmed' or v_row.scheduled_at>now() then
    raise exception 'Yalnız saati gelen aktif randevu Gelmedi olarak işaretlenebilir.';
  end if;
  update public.appointments set status='no_show',staff_overlap_override=false
    where id=v_row.id returning * into v_row;
  return jsonb_build_object('id',v_row.id,'status',v_row.status,'no_show_at',v_row.no_show_at);
end $$;

create or replace function public.undo_appointment_no_show(p_appointment_id uuid,p_reason text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare v_row public.appointments%rowtype;
begin
  if auth.uid() is null or not private.is_manager() then
    raise exception 'Geri alma yalnız yöneticiye açıktır.' using errcode='42501';
  end if;
  if nullif(trim(p_reason),'') is null then
    raise exception 'Geri alma nedeni gereklidir.';
  end if;
  select * into v_row from public.appointments where id=p_appointment_id for update;
  if not found then raise exception 'Randevu bulunamadı.'; end if;
  if v_row.status<>'no_show' then raise exception 'Randevu Gelmedi durumunda değil.'; end if;
  update public.appointments set status='confirmed',no_show_reversal_reason=left(trim(p_reason),500)
    where id=v_row.id returning * into v_row;
  return jsonb_build_object('id',v_row.id,'status',v_row.status,'reversed_at',v_row.no_show_reversed_at);
end $$;

revoke all on function public.mark_appointment_no_show(uuid) from public,anon,authenticated;
revoke all on function public.undo_appointment_no_show(uuid,text) from public,anon,authenticated;
grant execute on function public.mark_appointment_no_show(uuid) to authenticated;
grant execute on function public.undo_appointment_no_show(uuid,text) to authenticated;
