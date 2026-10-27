drop policy if exists clients_read_by_active_users on public.clients;
create policy clients_read_by_manager on public.clients for select to authenticated
  using ((select private.is_manager()));
