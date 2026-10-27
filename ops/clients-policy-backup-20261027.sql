-- Read-only snapshot of the live public.clients RLS policies before deployment.
-- Captured 2026-10-27 from pg_policies, project oxuwwjsakhcqimjsfris.
-- Keep this file for rollback review; do not run it as a migration.

-- clients_delete_by_manager, DELETE, authenticated
create policy clients_delete_by_manager on public.clients
  for delete to authenticated using ((select private.is_manager()));

-- clients_insert_by_active_users, INSERT, authenticated
create policy clients_insert_by_active_users on public.clients
  for insert to authenticated with check ((select private.is_active_salon_user()));

-- clients_read_by_active_users, SELECT, authenticated
create policy clients_read_by_active_users on public.clients
  for select to authenticated using ((select private.is_active_salon_user()));

-- clients_update_by_manager, UPDATE, authenticated
create policy clients_update_by_manager on public.clients
  for update to authenticated
  using ((select private.is_manager()))
  with check ((select private.is_manager()));

-- The deployment changes only the SELECT policy. The other policies are
-- recorded here to verify that they remain identical after deployment.
