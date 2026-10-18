-- MORİ actions: a private proposal, explicit confirmation and one atomic execution.
create table public.salon_ai_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  kind text not null check (kind in ('appointment_create','appointment_move','appointment_cancel','client_create','client_update','expense_create','commission_update','service_price_update')),
  payload jsonb not null,
  state text not null default 'pending' check (state in ('pending','applied','failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  applied_at timestamptz
);
create index salon_ai_actions_user_session_idx on public.salon_ai_actions(user_id,session_id,created_at desc);
alter table public.salon_ai_actions enable row level security;
revoke all on public.salon_ai_actions from anon,authenticated;
grant select on public.salon_ai_actions to authenticated;
create policy "Own MORİ actions" on public.salon_ai_actions for select to authenticated
  using (user_id=(select auth.uid()) and created_at > now()-interval '30 days');

create or replace function public.salon_ai_commit_action(p_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$
declare
  a public.salon_ai_actions%rowtype;
  actor public.profiles%rowtype;
  employee public.profiles%rowtype;
  service public.services%rowtype;
  appointment public.appointments%rowtype;
  client public.clients%rowtype;
  client_count integer;
  starts timestamptz;
  duration integer;
  result jsonb;
  label text;
  amount numeric;
  created_id uuid;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode='42501'; end if;
  select * into a from public.salon_ai_actions where id=p_id and user_id=auth.uid() for update;
  if not found then raise exception 'İşlem bulunamadı.' using errcode='42501'; end if;
  if a.state='applied' then return a.result; end if;
  if a.state<>'pending' or a.expires_at<now() then raise exception 'İşlem onayı süresi doldu.'; end if;
  select * into actor from public.profiles where id=auth.uid() and active;
  if not found or actor.role not in ('manager','employee') then raise exception 'İşlem yetkisi yok.' using errcode='42501'; end if;
  if a.kind in ('appointment_create','appointment_move','appointment_cancel','client_update','expense_create','commission_update','service_price_update')
    and actor.role<>'manager' then raise exception 'Yönetici onayı gerekli.' using errcode='42501'; end if;

  if a.kind in ('appointment_create','appointment_move') then
    select * into employee from public.profiles where id=(a.payload->>'employee_id')::uuid and active and username is distinct from 'salon.modern';
    if not found then raise exception 'Çalışan bulunamadı.'; end if;
    if actor.role='employee' and employee.id<>actor.id then raise exception 'Yalnız kendi takviminizi değiştirebilirsiniz.' using errcode='42501'; end if;
    starts:=(a.payload->>'scheduled_at')::timestamptz;
    if starts<now()-interval '5 minutes' or starts>now()+interval '366 days' then raise exception 'Randevu zamanı geçersiz.'; end if;
    if extract(minute from starts at time zone 'Europe/Istanbul') not in (0,30) then raise exception 'Randevu saati 30 dakikalık dilimde olmalı.'; end if;
    if (starts at time zone 'Europe/Istanbul')::time < time '08:00' or (starts at time zone 'Europe/Istanbul')::time > time '23:30' then raise exception 'Takvim saati dışında.'; end if;
    if a.kind='appointment_create' then
      select * into service from public.services where id=(a.payload->>'service_id')::uuid and active;
      if not found then raise exception 'Hizmet bulunamadı.'; end if;
      duration:=case when lower(service.name) ~ 'saç[ ,]+sakal' then greatest(service.duration_minutes,60) else service.duration_minutes end;
    else
      select * into appointment from public.appointments where id=(a.payload->>'appointment_id')::uuid for update;
      if not found or appointment.status='cancelled' then raise exception 'Randevu bulunamadı.'; end if;
      if appointment.source='online' then raise exception 'Online randevu yönetim ekranından değiştirilmelidir.'; end if;
      if actor.role='employee' and appointment.employee_id<>actor.id then raise exception 'Randevu yetkisi yok.' using errcode='42501'; end if;
      duration:=appointment.duration_minutes;
    end if;
    perform pg_advisory_xact_lock(hashtextextended(employee.id::text,93));
    if exists(select 1 from public.appointments ap where ap.employee_id=employee.id and ap.status<>'cancelled'
      and (a.kind='appointment_create' or ap.id<>appointment.id)
      and ap.scheduled_at<starts+make_interval(mins=>duration)
      and coalesce(ap.scheduled_end,ap.scheduled_at+make_interval(mins=>ap.duration_minutes))>starts) then
      raise exception 'Seçilen saatte başka randevu var.' using errcode='23P01';
    end if;
    if exists(select 1 from public.closed_time_slots c where c.employee_id=employee.id
      and c.starts_at<starts+make_interval(mins=>duration) and c.ends_at>starts) then raise exception 'Seçilen saat kapalı.'; end if;
    if a.kind='appointment_create' then
      label:=btrim(a.payload->>'client_name');
      if length(label)<2 or length(label)>100 then raise exception 'Müşteri adı geçersiz.'; end if;
      select count(*) into client_count from public.clients where active and deleted_at is null and lower(full_name)=lower(label);
      if client_count>1 then raise exception 'Aynı isimde birden çok müşteri var; müşteri ekranından seçim yapın.'; end if;
      select * into client from public.clients where active and deleted_at is null and lower(full_name)=lower(label) limit 1;
      if not found then
        insert into public.clients(full_name,created_by) values(label,actor.id) returning * into client;
      end if;
      insert into public.appointments(client_id,client_name,client_phone,service_id,service_name,amount,
        employee_id,scheduled_at,duration_minutes,created_by,status,source,tariff_price_snapshot)
        values(client.id,client.full_name,client.phone,service.id,service.name,service.price,
          employee.id,starts,duration,actor.id,'confirmed','staff',service.price) returning * into appointment;
      if appointment.duration_minutes is distinct from duration then
        update public.appointments set duration_minutes=duration where id=appointment.id returning * into appointment;
      end if;
      result:=jsonb_build_object('kind',a.kind,'appointment_id',appointment.id,'client_name',appointment.client_name,
        'employee',employee.full_name,'service',service.name,'scheduled_at',appointment.scheduled_at,'duration_minutes',appointment.duration_minutes);
    else
      update public.appointments set employee_id=employee.id,scheduled_at=starts,updated_by=actor.id
        where id=appointment.id returning * into appointment;
      result:=jsonb_build_object('kind',a.kind,'appointment_id',appointment.id,'client_name',appointment.client_name,
        'employee',employee.full_name,'service',appointment.service_name,'scheduled_at',appointment.scheduled_at,'duration_minutes',appointment.duration_minutes);
    end if;
  elsif a.kind='appointment_cancel' then
    select * into appointment from public.appointments where id=(a.payload->>'appointment_id')::uuid for update;
    if not found or appointment.status='cancelled' then raise exception 'Randevu bulunamadı veya zaten iptal edilmiş.'; end if;
    if appointment.source='online' then raise exception 'Online randevu yönetim ekranından iptal edilmelidir.'; end if;
    update public.appointments set status='cancelled',cancellation_source='staff',cancellation_reason='MORİ yönetici onayı',updated_by=actor.id
      where id=appointment.id;
    result:=jsonb_build_object('kind',a.kind,'appointment_id',appointment.id,'client_name',appointment.client_name);
  elsif a.kind='client_create' then
    label:=btrim(a.payload->>'full_name');
    if length(label)<2 or length(label)>100 then raise exception 'Müşteri adı geçersiz.'; end if;
    if exists(select 1 from public.clients where active and deleted_at is null and lower(full_name)=lower(label)) then raise exception 'Müşteri zaten kayıtlı.'; end if;
    insert into public.clients(full_name,phone,note,created_by) values(label,nullif(a.payload->>'phone',''),nullif(a.payload->>'note',''),actor.id) returning * into client;
    result:=jsonb_build_object('kind',a.kind,'client_id',client.id,'client_name',client.full_name);
  elsif a.kind='client_update' then
    select * into client from public.clients where id=(a.payload->>'client_id')::uuid and active and deleted_at is null for update;
    if not found then raise exception 'Müşteri bulunamadı.'; end if;
    label:=btrim(coalesce(a.payload->>'full_name',client.full_name));
    if length(label)<2 or length(label)>100 then raise exception 'Müşteri adı geçersiz.'; end if;
    update public.clients set full_name=label,phone=coalesce(a.payload->>'phone',phone),note=coalesce(a.payload->>'note',note),updated_by=actor.id
      where id=client.id returning * into client;
    result:=jsonb_build_object('kind',a.kind,'client_id',client.id,'client_name',client.full_name);
  elsif a.kind='expense_create' then
    amount:=(a.payload->>'amount')::numeric;
    if amount<=0 or amount>1000000 then raise exception 'Tutar geçersiz.'; end if;
    label:=btrim(a.payload->>'category');
    if length(label)<2 or length(label)>80 then raise exception 'Kategori geçersiz.'; end if;
    insert into public.business_expenses(expense_date,category,description,amount,created_by,account_scope)
      values((a.payload->>'date')::date,label,nullif(a.payload->>'description',''),amount,actor.id,'daily')
      returning id into created_id;
    result:=jsonb_build_object('kind',a.kind,'amount',amount,'category',label,'date',a.payload->>'date');
  elsif a.kind='commission_update' then
    amount:=(a.payload->>'percent')::numeric;
    if amount<0 or amount>100 then raise exception 'Prim yüzdesi geçersiz.'; end if;
    update public.profiles set commission_pct=amount where id=(a.payload->>'employee_id')::uuid and active and role='employee' returning * into employee;
    if not found then raise exception 'Çalışan bulunamadı.'; end if;
    result:=jsonb_build_object('kind',a.kind,'employee',employee.full_name,'percent',employee.commission_pct);
  elsif a.kind='service_price_update' then
    amount:=(a.payload->>'price')::numeric;
    if amount<0 or amount>1000000 then raise exception 'Fiyat geçersiz.'; end if;
    update public.services set price=amount where id=(a.payload->>'service_id')::uuid and active returning * into service;
    if not found then raise exception 'Hizmet bulunamadı.'; end if;
    result:=jsonb_build_object('kind',a.kind,'service',service.name,'price',service.price);
  else
    raise exception 'İşlem desteklenmiyor.';
  end if;
  update public.salon_ai_actions set state='applied',result=result,applied_at=now() where id=a.id;
  return result;
end $$;
revoke all on function public.salon_ai_commit_action(uuid) from public,anon;
grant execute on function public.salon_ai_commit_action(uuid) to authenticated;
select cron.schedule('salon-ai-action-retention','29 2 * * *',
  $$delete from public.salon_ai_actions where created_at < now()-interval '30 days'$$);
