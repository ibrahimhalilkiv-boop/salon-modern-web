-- A manually confirmed legacy cancellation is not a provider delivery receipt.
create or replace function public.appointment_whatsapp_status(p_appointment_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,private as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not private.is_active_salon_user() or not private.is_manager() then
    raise exception 'Yönetici yetkisi gerekli.' using errcode='42501';
  end if;
  if not exists(select 1 from public.appointments where id=p_appointment_id) then
    raise exception 'Randevu bulunamadı.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',l.id,'template_key',l.template_key,
    'status',case when l.status='sent' and l.metadata->>'channel'='manual_wa_me' then 'manual_handled'
                  when l.status='failed' and l.metadata->>'manual_handled'='true' then 'manual_handled'
                  when l.status='failed' and l.metadata->>'channel'='manual_fallback' then 'manual_pending'
                  else l.status end,
    'can_manual',l.status='failed' and l.metadata->>'provider'='ycloud'
      and l.metadata->>'manual_handled' is distinct from 'true'
      and ((l.template_key='appointment_cancelled' and a.status='cancelled') or
           (l.template_key<>'appointment_cancelled' and a.status<>'cancelled' and a.scheduled_at>now()))
      and not exists(select 1 from public.whatsapp_message_logs x
        where x.appointment_id=l.appointment_id and x.template_key=l.template_key
          and x.id<>l.id and x.status in ('queued','sending','delivery_unknown')),
    'can_mark',l.status='failed' and l.metadata->>'channel'='manual_fallback'
      and l.metadata->>'manual_handled' is distinct from 'true',
    'can_legacy_manual',l.status='manual_pending' and l.metadata->>'channel'='manual_wa_me'
  ) order by l.created_at desc),'[]'::jsonb) into v_result
  from (select distinct on (template_key) id,appointment_id,template_key,status,metadata,created_at
        from public.whatsapp_message_logs
        where appointment_id=p_appointment_id
          and template_key in ('appointment_confirmation','appointment_update','appointment_reminder','appointment_cancelled')
        order by template_key,created_at desc,id desc) l
  join public.appointments a on a.id=l.appointment_id;
  return v_result;
end $$;
revoke all on function public.appointment_whatsapp_status(uuid) from public,anon;
grant execute on function public.appointment_whatsapp_status(uuid) to authenticated;
