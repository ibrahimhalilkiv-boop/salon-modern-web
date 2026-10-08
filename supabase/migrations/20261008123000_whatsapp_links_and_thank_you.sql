-- Central WhatsApp content settings, 60-minute reminders and opt-in-only
-- post-appointment thank-you delivery through the existing message queue.

alter table public.booking_settings
  alter column appointment_reminder_minutes set default 60,
  add column if not exists instagram_url text not null default 'https://www.instagram.com/salonmodernn/',
  add column if not exists google_maps_url text not null default 'https://www.google.com/maps/dir/?api=1&destination=Salon+Modern%2C+Bat%C4%B1kent+K%C3%BCr%C5%9Fat+T%C3%BCzmen+Bulvar%C4%B1%2C+9024.+Sk.%2C+%C5%9Eehitkamil%2FGaziantep',
  add column if not exists google_review_url text not null default 'https://g.page/r/CXLi6ZostkeBEBM/review',
  add column if not exists whatsapp_thank_you_enabled boolean not null default false,
  add column if not exists whatsapp_thank_you_delay_minutes integer not null default 120;

alter table public.booking_settings
  drop constraint if exists booking_settings_whatsapp_thank_you_delay_check,
  add constraint booking_settings_whatsapp_thank_you_delay_check
    check (whatsapp_thank_you_delay_minutes in (60,120,180,1440)),
  drop constraint if exists booking_settings_message_urls_check,
  add constraint booking_settings_message_urls_check check (
    instagram_url ~ '^https://' and google_maps_url ~ '^https://' and google_review_url ~ '^https://'
  );

alter table public.clients
  add column if not exists whatsapp_marketing_opt_in boolean not null default false,
  add column if not exists whatsapp_marketing_opt_in_at timestamptz,
  add column if not exists whatsapp_marketing_opt_out_at timestamptz;

alter table public.clients
  drop constraint if exists clients_whatsapp_marketing_consent_check,
  add constraint clients_whatsapp_marketing_consent_check check (
    (not whatsapp_marketing_opt_in)
    or (whatsapp_marketing_opt_in_at is not null and whatsapp_marketing_opt_out_at is null)
  );

alter table public.appointments
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references public.profiles(id) on delete set null;

alter table public.appointments
  drop constraint if exists appointments_completion_metadata_check,
  add constraint appointments_completion_metadata_check check (
    (status='completed' and completed_at is not null)
    or
    (status<>'completed' and completed_at is null and completed_by is null)
  );

alter table public.whatsapp_message_logs
  drop constraint if exists whatsapp_message_logs_template_key_check,
  add constraint whatsapp_message_logs_template_key_check check (
    template_key in ('appointment_confirmation','appointment_update','appointment_reminder','appointment_cancelled','appointment_thank_you')
  );

alter table public.whatsapp_meta_template_mappings
  drop constraint if exists whatsapp_meta_template_mappings_template_key_check,
  add constraint whatsapp_meta_template_mappings_template_key_check check (
    template_key in ('appointment_confirmation','appointment_update','appointment_reminder','appointment_cancelled','appointment_thank_you')
  );

create or replace function private.set_appointment_completion_metadata()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
begin
  if new.status='completed' and (tg_op='INSERT' or old.status is distinct from 'completed') then
    new.completed_at:=now();
    new.completed_by:=auth.uid();
  elsif new.status<>'completed' then
    new.completed_at:=null;
    new.completed_by:=null;
  elsif tg_op='UPDATE' then
    new.completed_at:=old.completed_at;
    new.completed_by:=old.completed_by;
  end if;
  return new;
end $$;

revoke all on function private.set_appointment_completion_metadata() from public,anon,authenticated;

drop trigger if exists appointments_set_completion_metadata on public.appointments;
create trigger appointments_set_completion_metadata
before insert or update of status,completed_at,completed_by on public.appointments
for each row execute function private.set_appointment_completion_metadata();

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
  update public.appointments set status='completed',staff_overlap_override=false where id=v_row.id returning * into v_row;
  return jsonb_build_object('id',v_row.id,'status',v_row.status,'completed_at',v_row.completed_at);
end $$;

revoke all on function public.complete_appointment(uuid) from public,anon;
grant execute on function public.complete_appointment(uuid) to authenticated;

create or replace function public.whatsapp_enqueue_due_thank_yous()
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_count integer:=0;
begin
  insert into public.whatsapp_message_logs(
    idempotency_key,template_key,appointment_id,client_id,scheduled_for,next_attempt_at
  )
  select
    'appointment_thank_you:'||a.id::text,
    'appointment_thank_you',a.id,a.client_id,
    a.completed_at+make_interval(mins=>s.whatsapp_thank_you_delay_minutes),
    a.completed_at+make_interval(mins=>s.whatsapp_thank_you_delay_minutes)
  from public.appointments a
  join public.clients c on c.id=a.client_id
  join public.booking_settings s on s.id=true
  join public.whatsapp_meta_template_mappings m on m.template_key='appointment_thank_you'
  where s.whatsapp_thank_you_enabled
    and m.approval_status='approved' and m.approved_content_hash is not null
    and a.status='completed' and a.completed_at is not null
    and c.whatsapp_marketing_opt_in and c.whatsapp_marketing_opt_in_at is not null
    and c.whatsapp_marketing_opt_out_at is null
    and a.completed_at+make_interval(mins=>s.whatsapp_thank_you_delay_minutes)<=now()
  on conflict(idempotency_key) do nothing;
  get diagnostics v_count=row_count;
  return jsonb_build_object('appointment_thank_yous_enqueued',v_count);
end $$;

revoke all on function public.whatsapp_enqueue_due_thank_yous() from public,anon,authenticated;
grant execute on function public.whatsapp_enqueue_due_thank_yous() to service_role;

create or replace function private.set_appointment_reminder_schedule()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_minutes integer:=60;
begin
  if tg_op='INSERT' or new.scheduled_at is distinct from old.scheduled_at then
    select coalesce(appointment_reminder_minutes,60) into v_minutes
      from public.booking_settings where id=true;
    v_minutes:=coalesce(v_minutes,60);
    new.reminder_eligible:=new.scheduled_at>=now()+make_interval(mins=>v_minutes);
    new.reminder_target_at:=case when new.reminder_eligible
      then new.scheduled_at-make_interval(mins=>v_minutes) else null end;
  end if;
  return new;
end $$;

revoke all on function private.set_appointment_reminder_schedule() from public,anon,authenticated;

insert into public.message_templates(template_key,title,content)
values
('appointment_confirmation','Yeni randevu onayı','Merhaba {musteri_adi} 👋

💈 Salon Modern randevunuz oluşturuldu.

📅 Tarih: {randevu_tarihi}
🕒 Saat: {randevu_saati}
✂️ Hizmet: {islem_adi}
👤 Berber: {calisan_adi}

📍 Salonumuza yol tarifi:
{google_haritalar_url}

Sizi bekliyoruz.

Salon Modern'),
('appointment_reminder','1 saatlik randevu hatırlatması','Merhaba {musteri_adi} 👋

⏰ Salon Modern randevunuzu hatırlatmak isteriz.

Randevunuza yaklaşık 1 saat kaldı.

📅 Tarih: {randevu_tarihi}
🕒 Saat: {randevu_saati}
👤 Berber: {calisan_adi}

📍 Yol tarifi:
{google_haritalar_url}

Görüşmek üzere! 💈'),
('appointment_thank_you','Randevu sonrası teşekkür','Merhaba {musteri_adi} 👋

💈 Bugün Salon Modern''i tercih ettiğiniz için teşekkür ederiz.

Memnuniyetiniz bizim için çok değerli.

⭐ Deneyiminizi Google''da paylaşabilirsiniz:
{google_yorum_url}

📸 Instagram''da bizi takip edebilirsiniz:
{instagram_url}

Tekrar görüşmek dileğiyle.

Salon Modern ✂️')
on conflict(template_key) do update set
  title=excluded.title,content=excluded.content,updated_at=now();

insert into public.whatsapp_meta_template_mappings(
  template_key,meta_template_name,language_code,placeholder_order,approved_content_hash,approval_status
) values (
  'appointment_thank_you','salon_modern_tesekkur_v1','tr',
  '["{musteri_adi}","{google_yorum_url}","{instagram_url}"]'::jsonb,
  null,'pending'
) on conflict(template_key) do nothing;

-- Content changed, so preserve the existing approved Meta template/hash for
-- safe fallback while clearly marking the replacement content as pending.
update public.whatsapp_meta_template_mappings
set approval_status='pending',updated_at=now()
where template_key in ('appointment_confirmation','appointment_reminder');

update public.booking_settings
set appointment_reminder_minutes=60,updated_at=now()
where id=true;
