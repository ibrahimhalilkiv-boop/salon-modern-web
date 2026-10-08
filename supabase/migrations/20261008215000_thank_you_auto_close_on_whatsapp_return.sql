-- WhatsApp return cannot verify delivery: record manager-triggered 'manual_handled'.
alter table public.whatsapp_message_logs
 drop constraint whatsapp_message_logs_status_check,
 add constraint whatsapp_message_logs_status_check check (status = any (array[
   'queued','sending','sent','delivered','read','failed','delivery_unknown',
   'awaiting_meta_approval','suppressed_safe_mode','skipped_template_missing',
   'skipped_template_invalid','skipped_no_phone','skipped_event_invalid',
   'manual_pending','manual_handled'
 ]));

create or replace function public.mark_manual_whatsapp_thank_you_handled(p_appointment_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog,public,private as $$
declare
 v_appointment public.appointments%rowtype;
 v_client public.clients%rowtype;
 v_key text:='appointment_thank_you:'||p_appointment_id::text;
 v_log_id uuid;
begin
 if auth.uid() is null or not private.is_active_salon_user() or not private.is_manager() then
   raise exception 'Yönetici yetkisi gerekli.' using errcode='42501';
 end if;
 select * into v_appointment from public.appointments where id=p_appointment_id for update;
 if not found then raise exception 'Randevu bulunamadı.'; end if;
 if v_appointment.status <> 'completed' or v_appointment.completed_at is null then
   raise exception 'Yalnız tamamlanmış randevular işaretlenebilir.';
 end if;
 select * into v_client from public.clients where id=v_appointment.client_id;
 if not found or v_client.whatsapp_marketing_opt_out_at is not null
    or private.normalize_tr_phone(v_client.phone) is null then
   raise exception 'Müşteri iletişimi reddetmiş veya telefon numarası geçersiz.';
 end if;
 select id into v_log_id from public.whatsapp_message_logs where idempotency_key=v_key;
 if found then return jsonb_build_object('status','already_recorded','replayed',true); end if;
 insert into public.whatsapp_message_logs(
   idempotency_key,template_key,appointment_id,client_id,
   scheduled_for,next_attempt_at,status,attempt_count,status_at,metadata
 ) values(
   v_key,'appointment_thank_you',v_appointment.id,v_appointment.client_id,
   v_appointment.completed_at,now(),'manual_handled',0,now(),
   jsonb_build_object('channel','manual_wa_me','event','returned_from_whatsapp',
       'delivery_verified',false,'handled_by',auth.uid())
 ) on conflict(idempotency_key) do nothing returning id into v_log_id;
 if v_log_id is null then
   return jsonb_build_object('status','already_recorded','replayed',true);
 end if;
 return jsonb_build_object('status','manual_handled','appointment_id',v_appointment.id,
                           'message_log_id',v_log_id,'delivery_verified',false);
end $$;
revoke all on function public.mark_manual_whatsapp_thank_you_handled(uuid) from public,anon;
grant execute on function public.mark_manual_whatsapp_thank_you_handled(uuid) to authenticated;
