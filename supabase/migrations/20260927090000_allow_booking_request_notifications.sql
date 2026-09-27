alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check check (kind = any (array[
    'appointment'::text,
    'appointment_update'::text,
    'appointment_reminder'::text,
    'appointment_cancelled'::text,
    'appointment_reassigned_from'::text,
    'booking_request'::text,
    'system'::text
  ]));
