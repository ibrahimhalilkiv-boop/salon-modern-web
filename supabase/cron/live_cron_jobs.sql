-- Read-only source snapshot recovered from the live Salon Modern database on 2026-10-07.
-- This file was not applied to production. Secret values remain in Supabase Vault.

select cron.schedule(
  'salon-modern-auto-daily-cash-close',
  '5 21 * * *',
  'select private.auto_close_daily_cash();'
);

select cron.schedule(
  'salon-modern-retry-pending-push',
  '* * * * *',
  'select private.retry_pending_notification_pushes();'
);

select cron.schedule(
  'salon-modern-meta-reminder-queue',
  '*/5 * * * *',
  'select public.whatsapp_enqueue_due_reminders();'
);

select cron.schedule(
  'salon-modern-meta-dispatch',
  '*/5 * * * *',
  $$select net.http_post(
    url := 'https://oxuwwjsakhcqimjsfris.supabase.co/functions/v1/whatsapp-outbound-dispatch',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-salon-dispatch-secret',(select decrypted_secret from vault.decrypted_secrets where name='whatsapp_dispatch_secret')
    ),
    body := '{}'::jsonb
  );$$
);

select cron.schedule(
  'salon-modern-one-hour-reminders',
  '* * * * *',
  'select private.enqueue_due_appointment_reminders()'
);

select cron.schedule(
  'salon-modern-web-push-dispatch',
  '* * * * *',
  $$select net.http_post(
    url := 'https://oxuwwjsakhcqimjsfris.supabase.co/functions/v1/web-push-dispatch',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-salon-push-secret',(select decrypted_secret from vault.decrypted_secrets where name='web_push_dispatch_secret' limit 1)
    ),
    body := '{"action":"dispatch"}'::jsonb,
    timeout_milliseconds := 30000
  );$$
);
