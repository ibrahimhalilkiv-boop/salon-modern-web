-- Online appointment requests do not use WhatsApp verification codes.
-- Keep the legacy column for backwards compatibility and audit history.
-- The customer-booking-request Edge Function does not read this setting
-- and no longer exposes OTP generation or verification endpoints.
update public.booking_settings
set online_booking_verification_enabled=false
where id=true;
