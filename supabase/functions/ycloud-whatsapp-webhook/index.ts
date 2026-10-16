import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { verifyYCloudSignature, ycloudStatusTransition } from "../_shared/ycloud-whatsapp.mjs";

function getAdminKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default ?? ""; } catch { return ""; }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const secret = Deno.env.get("YCLOUD_WEBHOOK_SECRET") ?? "";
  const rawBody = await request.text();
  if (!await verifyYCloudSignature(request.headers.get("YCloud-Signature"), rawBody, secret)) return new Response("Unauthorized", { status: 401 });

  let event: any;
  try { event = JSON.parse(rawBody); } catch { return new Response("Bad Request", { status: 400 }); }
  if (event?.type !== "whatsapp.message.updated") return new Response("OK");
  const message = event.whatsappMessage;
  if (!message?.id || message?.wabaId !== Deno.env.get("YCLOUD_WABA_ID") || message?.from !== Deno.env.get("YCLOUD_PHONE_NUMBER")) return new Response("OK");
  if (!["sent", "delivered", "read", "failed"].includes(message.status)) return new Response("OK");

  const url = Deno.env.get("SUPABASE_URL") ?? "", key = getAdminKey();
  if (!url || !key) return new Response("Server not configured", { status: 503 });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let result = await db.from("whatsapp_message_logs").select("id,idempotency_key,status,provider_message_id,metadata").eq("provider_message_id", message.id).maybeSingle();
  if (result.error) return new Response("Database unavailable", { status: 503 });
  if (!result.data && typeof message.externalId === "string" && message.externalId.startsWith("appointment_")) {
    result = await db.from("whatsapp_message_logs").select("id,idempotency_key,status,provider_message_id,metadata").eq("idempotency_key", message.externalId).maybeSingle();
    if (result.error) return new Response("Database unavailable", { status: 503 });
  }
  const log = result.data;
  if (!log) return typeof message.externalId === "string" && message.externalId.startsWith("appointment_") ? new Response("Try later", { status: 503 }) : new Response("OK");
  if (log.provider_message_id && log.provider_message_id !== message.id) return new Response("OK");
  if (log.metadata?.provider !== "ycloud" && log.status !== "sending") return new Response("OK");
  if (log.metadata?.provider_status === message.status) return new Response("OK");
  const status = ycloudStatusTransition(log.status, message.status);
  if (!status) return new Response("OK");
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status, provider_message_id: message.id, status_at: now, updated_at: now,
    metadata: { ...log.metadata, provider: "ycloud", provider_status: message.status },
  };
  if (message.status === "failed") patch.last_error = `ycloud_${String(message.errorCode ?? "failed").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 64)}`;
  if (message.status === "sent") patch.sent_at = now;
  const update = await db.from("whatsapp_message_logs").update(patch).eq("id", log.id).eq("status", log.status);
  return new Response(update.error ? "Database unavailable" : "OK", { status: update.error ? 503 : 200 });
});
