# WhatsApp readiness — 2 October 2026

## Completed, without customer sends

- Imported the actual deployed `whatsapp-assistant-v31` v18 source into this repository (not the divergent old local backend copy).
- Deployed v19 with signed delivery receipts, conditional monotonic delivery states and template revocation handling.
- `WHATSAPP_ASSISTANT_ENABLED` defaults to false. Outbound appointment dispatch `SAFE_MODE` no longer implicitly enables the inbound bot, AI calls or booking writes.
- Incoming Business App echoes/history are not handled as customer requests. No history/state-sync subscriptions are needed for this appointment notification task.
- Rejected/paused/disabled/deleted templates clear their approved hash; APPROVED events alone cannot approve unverified content.
- Existing webhook challenge token fallback, HMAC authentication and original assistant implementation retained. No new database schema, migration, customer record or appointment changes.
- Meta `message_template_status_update` field subscribed. `messages` requires separate user approval because it transmits incoming conversations to the webhook; with the bot disabled only receipts are persisted.

## Validation

- `node tests/meta-webhook-readiness.test.mjs`: 10 checks PASS, including actual signed handler with mock DB, invalid signature, receipt ID targeting, disabled inbound processing and original verification challenge.
- Existing backend `tests/meta-whatsapp.mjs`: PASS.
- Existing backend `tests/whatsapp-assistant-v31-core.mjs`: PASS.
- Syntax: Node TypeScript stripping + VM compilation of deployed handler PASS; git diff whitespace check PASS.
- Live function v19 ACTIVE; unsigned GET 403, unsigned POST 401. No signed production test write or customer message sent.

## Still required — do not call production messaging ready

1. Meta business verification, app review/access verification and official Coexistence onboarding. Do not delete/disconnect the phone Business App or use API-only registration to bypass this.
2. After onboarding, complete server-side code exchange and securely provision the actual WABA/phone access token. The existing setup HTML reports success but does not perform exchange or persist credentials. It was not changed to claim readiness.
3. Confirm the token is authorized for WABA 1859183478383573 / phone ID 1335195816350109; existing historical logs refer to a different old phone ID. Never print tokens, send them to the browser or commit them.
4. Subscribe the app to the selected WABA (distinct from app-level webhook fields), then verify HMAC with the correct Meta app secret.
5. Reconcile the four templates against the actual selected WABA: name, language, status, placeholder order and content hash. Existing database approval metadata is not proof of approval on the new WABA.
6. Controlled recipient-approved test of one new confirmation and one reminder, delivered/read receipts, then switch outbound mode only after these checks. Do not retry the historical failed queue in bulk.

## Activation safeguards

- Keep `WHATSAPP_ASSISTANT_ENABLED` unset/false; chatbot activation is outside automatic appointment messaging.
- Preserve current outbound SAFE_MODE and sender credentials until official onboarding and template validation complete.
- Do not enable `history`, `smb_message_echoes`, `smb_app_state_sync` or unrelated webhook fields for this task.
- Do not auto-approve a template solely from a webhook event. Server-side Graph reconciliation must validate the selected WABA and approved content.
- A positive API send response is not delivery; verify receipts before declaring success.

## Scope

Calendar, customers, debt, notifications, PWA files, frontend WhatsApp deep links, database and outbound dispatcher are unchanged. The shared assistant core is an exact copy of live v18. Rollback is redeployment of the original v18 source bundle, not deletion of database records.
