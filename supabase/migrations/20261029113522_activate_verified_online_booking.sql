-- Activate only after the WhatsApp authentication template and PWA are live.
update public.booking_settings
set online_booking_verification_enabled = true
where id = true and online_booking_verification_enabled is distinct from true;
