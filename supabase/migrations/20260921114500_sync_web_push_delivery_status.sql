create or replace function private.sync_web_push_delivery_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.notifications n
  set pushed_at = case
        when exists(select 1 from public.web_push_deliveries d where d.notification_id=new.notification_id and d.status='sent')
          then coalesce(n.pushed_at, now())
        else n.pushed_at
      end,
      push_attempts = greatest(n.push_attempts, coalesce((
        select max(d.attempt_count) from public.web_push_deliveries d where d.notification_id=new.notification_id
      ),0)),
      last_push_error = case
        when exists(select 1 from public.web_push_deliveries d where d.notification_id=new.notification_id and d.status='sent') then null
        else (select d.last_error from public.web_push_deliveries d
              where d.notification_id=new.notification_id and d.last_error is not null
              order by d.updated_at desc limit 1)
      end
  where n.id=new.notification_id;
  return new;
end;
$$;

drop trigger if exists web_push_deliveries_sync_notification on public.web_push_deliveries;
create trigger web_push_deliveries_sync_notification
after insert or update of status,attempt_count,last_error,sent_at on public.web_push_deliveries
for each row execute function private.sync_web_push_delivery_status();
