# Live migration history

Read-only history captured from Supabase project `oxuwwjsakhcqimjsfris` on 2026-10-07. This file is documentation only; no migration was applied during source synchronization.

| Live version | Migration name | SQL source in repository |
|---|---|---|
| `20260808221237` | `create_salon_realtime_schema` | not recovered |
| `20260808221434` | `improve_salon_policy_and_indexes` | not recovered |
| `20260808224052` | `add_service_durations_and_hourly_schedule` | not recovered |
| `20260808230525` | `add_quarter_hour_durations_and_global_closed_slots` | not recovered |
| `20260808230856` | `enforce_appointment_quarter_hour_durations` | not recovered |
| `20260808231603` | `make_closed_slots_employee_specific_and_prevent_overlap` | not recovered |
| `20260809194457` | `allow_employees_manage_own_appointments` | not recovered |
| `20260811214830` | `enable_public_online_booking_v2` | not recovered |
| `20260812065823` | `allow_manual_appointment_amount_and_snapshot_store` | not recovered |
| `20260812075428` | `create_edge_html_snapshots` | not recovered |
| `20260812080229` | `add_customer_debts` | not recovered |
| `20260812185348` | `customer_debts_and_tariff_151` | not recovered |
| `20260812185731` | `customer_debts_realtime` | not recovered |
| `20260812214052` | `business_expenses_cash_tracking` | not recovered |
| `20260812215540` | `secure_online_booking` | not recovered |
| `20260812220119` | `online_booking_security_hardening` | not recovered |
| `20260814073149` | `recurring_tariff_and_creator_reminders` | not recovered |
| `20260814073803` | `notification_recipient_consistency` | not recovered |
| `20260814090331` | `preserve_history_when_manager_deletes_client` | not recovered |
| `20260820085629` | `message_templates_customer_returns_and_partial_debts` | not recovered |
| `20260820085815` | `initialize_debt_original_amount` | not recovered |
| `20260820090012` | `customer_access_policy_and_fk_indexes` | not recovered |
| `20260820091624` | `debt_delete_and_all_whatsapp_templates` | not recovered |
| `20260820214843` | `optimize_calendar_appointment_queries` | not recovered |
| `20260821091603` | `add_appointment_update_message_template` | not recovered |
| `20260821120758` | `employee_assignment_push_notifications` | not recovered |
| `20260821133232` | `immediate_assignment_update_notifications` | not recovered |
| `20260821144513` | `creator_exact_appointment_reminders` | not recovered |
| `20260821145747` | `notification_reminder_kinds` | not recovered |
| `20260823221357` | `smart_customer_identity_and_audit` | not recovered |
| `20260823222706` | `complete_customer_audit_indexes` | not recovered |
| `20260823230511` | `salon_phase2_intelligence` | not recovered |
| `20260901144954` | `salon_finance_v230` | not recovered |
| `20260901145603` | `salon_finance_v230_indexes` | not recovered |
| `20260901150023` | `salon_finance_v230_hardening` | not recovered |
| `20260901151533` | `salon_finance_v231_fund_save` | not recovered |
| `20260902081305` | `product_sale_debts_and_custom_prices` | not recovered |
| `20260902172649` | `auto_daily_cash_closing` | not recovered |
| `20260904221042` | `add_whatsapp_assistant_v31_foundation` | not recovered |
| `20260904223104` | `whatsapp_assistant_v31_safe_tools` | not recovered |
| `20260904223410` | `whatsapp_assistant_v31_fk_index` | not recovered |
| `20260904223507` | `whatsapp_assistant_v31_client_context` | not recovered |
| `20260908080401` | `sync_appointment_phone_to_client_and_backfill` | not recovered |
| `20260908094407` | `fix_debt_collection_cash_flow` | not recovered |
| `20260908095128` | `use_single_cash_without_partner_split` | not recovered |
| `20260908184326` | `salon_finance_v2312_single_cash` | not recovered |
| `20260908203641` | `preserve_debt_payments_when_debt_deleted` | not recovered |
| `20260908204649` | `daily_cash_close_compatibility_and_expense_details` | not recovered |
| `20260912113418` | `fix_push_timeout_and_retry` | not recovered |
| `20260912134801` | `add_atomic_appointment_amount_update` | not recovered |
| `20260912134913` | `harden_appointment_amount_update` | not recovered |
| `20260916191453` | `show_manager_appointments_to_authenticated_staff` | not recovered |
| `20260916191650` | `restore_employee_appointment_visibility` | not recovered |
| `20260919155249` | `web_push_pwa` | not recovered |
| `20260919155934` | `schedule_web_push_dispatch` | not recovered |
| `20260919160415` | `web_push_delivery_fk_index` | not recovered |
| `20260919160508` | `appointments_confirmed_reminder_index` | not recovered |
| `20260921091244` | `exact_one_hour_appointment_push_reminders` | not recovered |
| `20260921104451` | `allow_users_manage_own_web_push_subscriptions` | not recovered |
| `20260921110311` | `harden_web_push_appointment_notifications` | yes (name match) |
| `20260921110341` | `sync_web_push_delivery_status` | yes (name match) |
| `20260921111049` | `route_reminders_to_creator` | yes (name match) |
| `20260924174152` | `cascade_appointment_debt_on_delete` | not recovered |
| `20260924193731` | `add_primary_debt_account_member` | yes (name match) |
| `20260925184118` | `extend_existing_online_booking_requests_for_public_portal` | not recovered |
| `20260926080452` | `enforce_appointment_creator_from_auth` | not recovered |
| `20260927005848` | `allow_booking_request_notifications` | yes (name match) |
| `20260927032400` | `add_booking_schedule_settings` | not recovered |
| `20261001064321` | `online_booking_auto_confirm` | yes (name match) |
| `20261001083123` | `finance_period_summary` | yes (name match) |
| `20261001114547` | `online_booking_service_duration` | yes (name match) |
| `20261001143908` | `allow_staff_appointment_overlap` | yes (name match) |
| `20261001194428` | `calendar_real_duration_customer_management` | yes (name match) |
| `20261002090623` | `enforce_staff_appointment_conflicts` | yes (name match) |
| `20261002162411` | `reminder_five_minute_catchup` | yes (name match) |
| `20261002183836` | `online_booking_reminder_recipient` | yes (name match) |
| `20261004211051` | `extend_push_reminder_catchup` | yes (name match) |
| `20261004212626` | `online_service_display_order_durations` | yes (name match) |
| `20261005121439` | `online_booking_no_show_and_two_hour_cutoff` | yes (name match) |
| `20261006084953` | `allow_exact_two_hour_customer_changes` | yes (name match) |
| `20261007053034` | `allow_authenticated_client_phone_normalization` | yes (name match) |
| `20261007160054` | `soft_cancel_and_configurable_reminders` | yes (name match) |

## Local migration files without an exact live history name

- `20260920183000_add_debt_account_groups.sql`
- `20260924103000_delete_linked_debt_with_appointment.sql`
- `20260925120000_customer_booking_requests.sql`
