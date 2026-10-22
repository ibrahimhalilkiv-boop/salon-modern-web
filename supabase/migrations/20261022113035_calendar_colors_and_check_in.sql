-- Arrival is separate from completion and has no effect on visit analytics.
alter table public.profiles add column if not exists calendar_color text;
alter table public.profiles drop constraint if exists profiles_calendar_color_format;
alter table public.profiles add constraint profiles_calendar_color_format
  check (calendar_color is null or calendar_color ~ '^#[0-9A-Fa-f]{6}$');
update public.profiles set calendar_color=case username
  when 'halil.kiv' then '#2563EB'
  when 'cengiz.bavkir' then '#15803D'
  when 'talip.kose' then '#7C3AED'
  when 'mehmet.safakoglu' then '#EA580C'
end
where calendar_color is null and username in
  ('halil.kiv','cengiz.bavkir','talip.kose','mehmet.safakoglu');

alter table public.appointments add column if not exists checked_in_at timestamptz;
alter table public.appointments add column if not exists checked_in_by uuid references public.profiles(id);
alter table public.appointments add constraint appointments_check_in_pair
  check ((checked_in_at is null)=(checked_in_by is null));

create or replace function public.set_appointment_check_in(p_appointment_id uuid,p_arrived boolean)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare v_actor uuid:=auth.uid(); v_row public.appointments%rowtype;
begin
  if v_actor is null or not private.is_active_salon_user() then
    raise exception 'Aktif personel oturumu gerekli.' using errcode='42501';
  end if;
  select * into v_row from public.appointments where id=p_appointment_id for update;
  if not found then raise exception 'Randevu bulunamadı.'; end if;
  if not private.is_manager() and v_row.employee_id is distinct from v_actor then
    raise exception 'Bu randevuyu yönetme yetkiniz yok.' using errcode='42501';
  end if;
  if v_row.status not in ('confirmed','completed') then
    raise exception 'İptal veya Gelmedi randevusunda geliş kaydı değiştirilemez.';
  end if;
  if p_arrived and v_row.scheduled_at>now() then
    raise exception 'Randevu saati gelmeden Geldi kaydedilemez.';
  end if;
  if (v_row.checked_in_at is not null)=p_arrived then
    return jsonb_build_object('id',v_row.id,'checked_in_at',v_row.checked_in_at,'replayed',true);
  end if;
  update public.appointments
    set checked_in_at=case when p_arrived then now() else null end,
        checked_in_by=case when p_arrived then v_actor else null end
    where id=v_row.id returning * into v_row;
  return jsonb_build_object('id',v_row.id,'checked_in_at',v_row.checked_in_at,'replayed',false);
end $$;
revoke all on function public.set_appointment_check_in(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_appointment_check_in(uuid,boolean) to authenticated;

-- A check-in changes neither cash nor the booking's financial value.
create or replace function private.v230_dirty_appointment_day()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
begin
  if tg_op='UPDATE' and
    to_jsonb(new)-array['checked_in_at','checked_in_by','updated_at','updated_by']
      = to_jsonb(old)-array['checked_in_at','checked_in_by','updated_at','updated_by'] then
    return new;
  end if;
  if tg_op <> 'INSERT' then perform private.v230_mark_closing_dirty((old.scheduled_at at time zone 'Europe/Istanbul')::date); end if;
  if tg_op <> 'DELETE' then perform private.v230_mark_closing_dirty((new.scheduled_at at time zone 'Europe/Istanbul')::date); end if;
  return coalesce(new,old);
end $$;
