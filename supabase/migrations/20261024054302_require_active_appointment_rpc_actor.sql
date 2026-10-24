-- SECURITY DEFINER RPCs bypass table RLS; enforce the same active-actor gate.
-- Existing function owners, grants, row locks and state transitions are preserved.
CREATE OR REPLACE FUNCTION public.cancel_appointment(p_appointment_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_actor uuid:=auth.uid();
  v_row public.appointments%rowtype;
begin
  if v_actor is null or not private.is_active_salon_user() then
    raise exception 'Aktif personel oturumu gerekli.' using errcode='42501';
  end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.complete_appointment(p_appointment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_actor uuid:=auth.uid();
  v_row public.appointments%rowtype;
begin
  if v_actor is null or not private.is_active_salon_user() then
    raise exception 'Aktif personel oturumu gerekli.' using errcode='42501';
  end if;
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
end $function$;

