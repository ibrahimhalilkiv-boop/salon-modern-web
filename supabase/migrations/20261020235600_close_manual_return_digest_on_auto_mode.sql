-- Switching to automatic Meta returns closes the manual 09:00 digest even if
-- Meta approval later lapses. The automatic enqueue/send gates then fail closed.
create or replace function private.salon_enqueue_daily_return_digest()
returns jsonb
language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_day date:=(now() at time zone 'Europe/Istanbul')::date;
 v_owner uuid;
 v_count integer;
 v_notif uuid;
 v_row integer;
begin
 if (select s.whatsapp_return_auto_enabled from public.booking_settings s where s.id=true) is true
 then return jsonb_build_object('status','auto_enabled_digest_disabled'); end if;

 select p.id into v_owner from public.profiles p
 where p.username='halil.kiv' and p.role='manager' and p.active=true
 limit 1;
 if v_owner is null then return jsonb_build_object('status','no_owner'); end if;
 insert into private.salon_return_daily_runs(digest_day,recipient_id)
 values (v_day,v_owner)
 on conflict (digest_day) do nothing;
 get diagnostics v_row=row_count;
 if v_row=0 then return jsonb_build_object('status','already_created','day',v_day); end if;
 select count(*) into v_count from private.salon_return_due_rows(v_day);
 insert into public.notifications(recipient_id,kind,title,body)
 values (
   v_owner,'customer_return_due','Tıraş süresi dolan müşteriler',
   case when v_count=0
        then 'Bugün tıraş zamanı gelen müşteri bulunmuyor. Listeyi görmek için dokunun.'
        else v_count::text||' müşterinin tıraş zamanı geldi. Listeyi açıp WhatsApp mesajlarını tek tek hazırlayabilirsiniz.'
   end
 ) returning id into v_notif;
 update private.salon_return_daily_runs set notification_id=v_notif where digest_day=v_day;
 return jsonb_build_object('status','created','day',v_day,'count',v_count,'notification_id',v_notif);
end;
$$;
revoke all on function private.salon_enqueue_daily_return_digest() from public,anon,authenticated;

-- Close the authenticated RPC too; an old browser tab must not record a
-- manual WhatsApp contact after the owner switches to automatic delivery.
create or replace function public.salon_mark_return_contact(p_client_id uuid, p_last_visit date)
returns boolean
language plpgsql security definer set search_path=pg_catalog
as $$
declare v_count integer;
begin
  if not exists (
    select 1 from public.profiles p where p.id=auth.uid()
      and p.username='halil.kiv' and p.role='manager' and p.active=true
  ) then
    raise exception 'Yetkisiz işlem.' using errcode='42501';
  end if;
  if (select s.whatsapp_return_auto_enabled from public.booking_settings s where s.id=true) is true then
    raise exception 'Otomatik geri çağırma açıkken manuel kayıt kapalı.' using errcode='42501';
  end if;
  if not exists (
    select 1 from private.salon_return_due_rows(
      (now() at time zone 'Europe/Istanbul')::date
    ) d where d.client_id=p_client_id and d.last_visit=p_last_visit
  ) then
    return false;
  end if;
  insert into public.customer_return_contacts(client_id,last_visit,contacted_by)
  values (p_client_id,p_last_visit,auth.uid())
  on conflict(client_id,last_visit) do nothing;
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$$;
revoke all on function public.salon_mark_return_contact(uuid,date) from public,anon;
grant execute on function public.salon_mark_return_contact(uuid,date) to authenticated;
