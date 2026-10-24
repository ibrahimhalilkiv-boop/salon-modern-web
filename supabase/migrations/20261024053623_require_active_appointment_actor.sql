-- Preserve the manager/assignee policies, adding a shared active-account gate.
-- Service-role booking/cron operations continue to bypass RLS.
-- Rollback: DROP POLICY appointments_require_active_actor ON public.appointments;
create policy appointments_require_active_actor
on public.appointments
as restrictive
for all
to authenticated
using ((select private.is_active_salon_user()))
with check ((select private.is_active_salon_user()));
