import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { normalizeTrPhone } from "../_shared/whatsapp-assistant-core.mjs";
import { META_TEMPLATE_TOKENS, metaTemplatePayload, postMetaMessage, renderMessageTemplate, sha256 } from "../_shared/meta-whatsapp.mjs";

const SAFE_MODE = (Deno.env.get("SAFE_MODE") ?? "true").toLowerCase() !== "false";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}
function getAdminKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default ?? ""; } catch { return ""; }
}
function istanbulParts(iso: string) {
  const parts = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", weekday: "long" }).format(new Date(iso)), time: `${byType.hour}:${byType.minute}` };
}
function valuesFor(appointment: any, client: any, employee: any) {
  const time = istanbulParts(appointment.scheduled_at);
  return {
    "{musteri_adi}": client?.full_name ?? appointment.client_name ?? "",
    "{randevu_tarihi}": time.date,
    "{randevu_saati}": time.time,
    "{calisan_adi}": employee?.full_name ?? "",
    "{islem_adi}": appointment.service_name ?? "",
    "{ucret}": Number(appointment.amount ?? 0).toLocaleString("tr-TR"),
  };
}


function onlyDigits(value: string) {
  return String(value ?? "").replace(/\D/g, "");
}
function normalizeComparablePhone(value: string) {
  const raw = onlyDigits(value);
  if (raw.startsWith("0090")) return raw.slice(2);
  if (raw.startsWith("0") && raw.length === 11) return "90" + raw.slice(1);
  if (raw.startsWith("5") && raw.length === 10) return "90" + raw;
  return raw;
}
async function graphRead(path: string, token: string, version: string) {
  try {
    const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: { error: { message: error instanceof Error ? error.message : String(error) } } };
  }
}
async function diagnoseMeta(expectedPhone: string) {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
  const version = Deno.env.get("WHATSAPP_GRAPH_API_VERSION") ?? "";
  const output: Record<string, unknown> = {
    access_token: token ? "PRESENT" : "MISSING",
    phone_number_id: phoneId ? "PRESENT" : "MISSING",
    graph_api_version: version ? "PRESENT" : "MISSING",
    token_phone_access: "UNKNOWN",
    phone_number_match: "UNKNOWN",
    coexistence: "UNKNOWN",
    platform_type: "UNKNOWN",
    quality_rating: "UNKNOWN",
    display_name_status: "UNKNOWN",
    registration_status: "UNKNOWN",
    templates: {},
  };
  if (!token || !phoneId || !version) return output;
  const core = await graphRead(`${encodeURIComponent(phoneId)}?fields=id,display_phone_number,verified_name,quality_rating,platform_type`, token, version);
  if (!core.ok) {
    const error = core.body?.error ?? {};
    output.token_phone_access = core.status === 401 || error?.code === 190 ? "INVALID" : "UNKNOWN";
    output.meta_read_error = { http_status: core.status, code: error?.code ?? null, message: error?.message ?? "unknown" };
    return output;
  }
  output.token_phone_access = "VALID";
  output.phone_number_match = normalizeComparablePhone(core.body?.display_phone_number) === normalizeComparablePhone(expectedPhone) ? "MATCH" : "MISMATCH";
  output.platform_type = core.body?.platform_type ?? "UNKNOWN";
  output.quality_rating = core.body?.quality_rating ?? "UNKNOWN";

  for (const field of ["is_on_biz_app", "name_status", "code_verification_status"]) {
    const detail = await graphRead(`${encodeURIComponent(phoneId)}?fields=${field}`, token, version);
    if (detail.ok) {
      if (field === "is_on_biz_app") output.coexistence = detail.body?.is_on_biz_app === true ? "ENABLED" : "NOT_ENABLED";
      if (field === "name_status") output.display_name_status = detail.body?.name_status ?? "UNKNOWN";
      if (field === "code_verification_status") output.registration_status = detail.body?.code_verification_status ?? "UNKNOWN";
    }
  }

  const waba = await graphRead(`${encodeURIComponent(phoneId)}?fields=whatsapp_business_account`, token, version);
  const wabaId = waba.ok ? waba.body?.whatsapp_business_account?.id : null;
  if (wabaId) {
    const templates = await graphRead(`${encodeURIComponent(wabaId)}/message_templates?fields=name,status,language&limit=100`, token, version);
    if (templates.ok) {
      const expected = ["salon_modern_randevu_onayi","salon_modern_randevu_guncelleme_v2","salon_modern_randevu_hatirlatma","salon_modern_randevu_iptal"];
      output.templates = Object.fromEntries(expected.map((name) => {
        const row = (templates.body?.data ?? []).find((item: any) => item.name === name && item.language === "tr");
        return [name, row?.status ?? "MISSING"];
      }));
    }
  }
  return output;
}

async function processDelivery(db: any, delivery: any) {
  const appointmentResult = await db.from("appointments").select("id,client_id,client_name,client_phone,service_name,amount,employee_id,scheduled_at,status,reminder_eligible,reminder_target_at").eq("id", delivery.appointment_id).maybeSingle();
  const appointment = appointmentResult.data;
  if (appointmentResult.error || !appointment) return db.from("whatsapp_message_logs").update({ status: "skipped_event_invalid", last_error: appointmentResult.error?.message ?? "appointment_not_found", updated_at: new Date().toISOString() }).eq("id", delivery.id);
  if (delivery.template_key !== "appointment_cancelled" && appointment.status === "cancelled") return db.from("whatsapp_message_logs").update({ status: "skipped_event_invalid", last_error: "appointment_cancelled", updated_at: new Date().toISOString() }).eq("id", delivery.id);
  if (delivery.template_key === "appointment_reminder" && (
    appointment.status !== "confirmed" || !appointment.reminder_eligible || !appointment.reminder_target_at ||
    Date.parse(delivery.scheduled_for) !== Date.parse(appointment.reminder_target_at)
  )) return db.from("whatsapp_message_logs").update({ status: "skipped_event_invalid", last_error: "appointment_rescheduled", updated_at: new Date().toISOString() }).eq("id", delivery.id);
  const [clientResult, employeeResult, templateResult, mappingResult] = await Promise.all([
    appointment.client_id ? db.from("clients").select("id,full_name,phone").eq("id", appointment.client_id).maybeSingle() : Promise.resolve({ data: null }),
    appointment.employee_id ? db.from("profiles").select("id,full_name").eq("id", appointment.employee_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("message_templates").select("template_key,content").eq("template_key", delivery.template_key).maybeSingle(),
    db.from("whatsapp_meta_template_mappings").select("template_key,meta_template_name,language_code,placeholder_order,approved_content_hash,approval_status").eq("template_key", delivery.template_key).maybeSingle(),
  ]);
  const client = clientResult.data;
  const phone = normalizeTrPhone(client?.phone ?? appointment.client_phone ?? "");
  if (!phone) return db.from("whatsapp_message_logs").update({ status: "skipped_no_phone", last_error: "invalid_or_missing_phone", updated_at: new Date().toISOString() }).eq("id", delivery.id);
  if (templateResult.error || !templateResult.data?.content?.trim()) return db.from("whatsapp_message_logs").update({ status: templateResult.data ? "skipped_template_invalid" : "skipped_template_missing", last_error: templateResult.error?.message ?? "template_missing", updated_at: new Date().toISOString() }).eq("id", delivery.id);
  const allowed = META_TEMPLATE_TOKENS[delivery.template_key as keyof typeof META_TEMPLATE_TOKENS] ?? [];
  const values = valuesFor(appointment, client, employeeResult.data);
  const rendered = renderMessageTemplate(templateResult.data.content, values, allowed);
  if (!rendered.ok) return db.from("whatsapp_message_logs").update({ status: "skipped_template_invalid", last_error: `template_${rendered.reason}`, updated_at: new Date().toISOString() }).eq("id", delivery.id);
  const currentHash = await sha256(templateResult.data.content);
  const mapping = mappingResult.data;
  // A text edit changes the mapping status to pending, but its previously
  // approved Meta template/hash remains usable until the replacement is
  // approved. A mapping with no approved hash has nothing safe to send.
  if (!mapping?.meta_template_name || !mapping.approved_content_hash) return db.from("whatsapp_message_logs").update({ status: "awaiting_meta_approval", template_content_hash: currentHash, last_error: "meta_template_not_approved", updated_at: new Date().toISOString() }).eq("id", delivery.id);
  const parameterTokens = Array.isArray(mapping.placeholder_order) && mapping.placeholder_order.length ? mapping.placeholder_order : allowed;
  if (parameterTokens.some((token: string) => !allowed.includes(token) || !String(values[token] ?? "").trim())) return db.from("whatsapp_message_logs").update({ status: "skipped_template_invalid", last_error: "invalid_meta_placeholder_order", updated_at: new Date().toISOString() }).eq("id", delivery.id);
  if (SAFE_MODE) return db.from("whatsapp_message_logs").update({ status: "suppressed_safe_mode", template_content_hash: currentHash, rendered_message: rendered.content, metadata: { safe_mode: true, meta_template_name: mapping.meta_template_name, content_changed_pending_meta_approval: mapping.approved_content_hash !== currentHash }, updated_at: new Date().toISOString() }).eq("id", delivery.id);
  const result = await postMetaMessage(metaTemplatePayload({ to: phone, name: mapping.meta_template_name, languageCode: mapping.language_code, parameterTokens, values }));
  if (result.ok) return db.from("whatsapp_message_logs").update({ status: "sent", provider_message_id: result.providerMessageId, template_content_hash: currentHash, rendered_message: mapping.approved_content_hash === currentHash ? rendered.content : null, metadata: { meta_template_name: mapping.meta_template_name, content_changed_pending_meta_approval: mapping.approved_content_hash !== currentHash }, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", delivery.id);
  if (result.kind === "retryable" && Number(delivery.attempt_count) < 3) return db.from("whatsapp_message_logs").update({ status: "queued", next_attempt_at: new Date(Date.now() + 60_000 * Math.pow(2, Math.max(0, Number(delivery.attempt_count) - 1))).toISOString(), last_error: `meta_${result.httpStatus}`, updated_at: new Date().toISOString() }).eq("id", delivery.id);
  return db.from("whatsapp_message_logs").update({ status: result.kind === "unknown" ? "delivery_unknown" : "failed", last_error: result.error ?? `meta_${result.httpStatus}`, metadata: { provider_response: result.body ?? null }, updated_at: new Date().toISOString() }).eq("id", delivery.id);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const secret = Deno.env.get("WHATSAPP_DISPATCH_SECRET") ?? "";
  if (!safeEqual(request.headers.get("x-salon-dispatch-secret") ?? "", secret)) return new Response("Unauthorized", { status: 401 });
  let requestBody: any = {};
  try { requestBody = await request.json(); } catch { requestBody = {}; }
  if (requestBody?.mode === "diagnose") return json(await diagnoseMeta(String(requestBody?.expected_phone ?? "")));
  const url = Deno.env.get("SUPABASE_URL") ?? "", key = getAdminKey();
  if (!url || !key) return json({ ok: false, error: "server_not_configured" }, 503);
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const queued = await db.rpc("whatsapp_enqueue_due_reminders");
  const claimed = await db.rpc("whatsapp_claim_message_logs", { p_limit: 25 });
  if (queued.error || claimed.error) return json({ ok: false, error: queued.error?.message ?? claimed.error?.message }, 500);
  const outcomes = [];
  for (const delivery of claimed.data ?? []) {
    try { await processDelivery(db, delivery); outcomes.push({ id: delivery.id, ok: true }); }
    catch (error) { await db.from("whatsapp_message_logs").update({ status: "failed", last_error: error instanceof Error ? error.message : String(error), updated_at: new Date().toISOString() }).eq("id", delivery.id); outcomes.push({ id: delivery.id, ok: false }); }
  }
  return json({ ok: true, safe_mode: SAFE_MODE, queued: queued.data, processed: outcomes });
});
