import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-salon-push-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const serviceKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const anonKey = publishableKeys.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function config() {
  const { data, error } = await admin.rpc("web_push_server_config");
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

async function authenticatedUser(request: Request) {
  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
}

async function bootstrapVapid(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return json({ error: "Oturum gerekli." }, 401);
  const { data: profile } = await admin.from("profiles").select("role,active").eq("id", user.id).maybeSingle();
  if (!profile?.active || profile.role !== "manager") return json({ error: "Yönetici yetkisi gerekli." }, 403);
  const existing = await config();
  if (existing?.public_key && existing?.private_key) return json({ publicKey: existing.public_key, alreadyConfigured: true });
  const keys = webpush.generateVAPIDKeys();
  const { error } = await admin.rpc("web_push_store_vapid", {
    p_public: keys.publicKey, p_private: keys.privateKey, p_subject: "mailto:ibrahimhalilkiv@gmail.com",
  });
  if (error) throw error;
  return json({ publicKey: keys.publicKey, configured: true });
}

async function createTestNotification(request: Request, subscriptionId: string) {
  const user = await authenticatedUser(request);
  if (!user) return json({ error: "Oturum gerekli." }, 401);
  if (!/^[0-9a-f-]{36}$/i.test(subscriptionId)) return json({ error: "Bu cihazın aboneliği seçilemedi." }, 400);
  const { data: target, error: targetError } = await admin.from("web_push_subscriptions")
    .select("id,endpoint,p256dh,auth_secret").eq("id", subscriptionId).eq("user_id", user.id).eq("active", true).maybeSingle();
  if (targetError) throw targetError;
  if (!target) return json({ error: "Bu cihazın aktif kaydı bulunamadı. Bağlantıyı yenileyin." }, 404);
  const cfg = await config();
  if (!cfg?.public_key || !cfg?.private_key) return json({ error: "VAPID yapılandırması eksik." }, 503);
  webpush.setVapidDetails(cfg.subject || "mailto:ibrahimhalilkiv@gmail.com", cfg.public_key, cfg.private_key);
  const notificationId = crypto.randomUUID();
  const payload = JSON.stringify({ notificationId, kind: "system", type: "system",
    title: "Salon Modern Test Bildirimi", body: "Bu cihaz için test bildirimi.", tag: `salon-${notificationId}` });
  try {
    await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth_secret } }, payload,
      { TTL: 60, urgency: "high" });
    return json({ notificationId, status: "sent", sentAt: new Date().toISOString() });
  } catch (cause: any) {
    const providerStatus = Number(cause?.statusCode || 0);
    if (providerStatus === 404 || providerStatus === 410) {
      await admin.from("web_push_subscriptions").update({ active: false, updated_at: new Date().toISOString() }).eq("id", target.id);
    }
    return json({ notificationId, status: providerStatus === 404 || providerStatus === 410 ? "expired" : "failed",
      error: providerStatus ? `Push servisi HTTP ${providerStatus}` : "Push servisine ulaşılamadı." });
  }
}

async function prepareDeliveries() {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: notes, error } = await admin.from("notifications")
    .select("id,recipient_id").gte("created_at", since).order("created_at").limit(500);
  if (error) throw error;
  if (!notes?.length) return 0;
  const recipients = [...new Set(notes.map((n) => n.recipient_id))];
  const { data: subscriptions, error: subscriptionError } = await admin.from("web_push_subscriptions")
    .select("id,user_id").in("user_id", recipients).eq("active", true);
  if (subscriptionError) throw subscriptionError;
  const rows = notes.flatMap((note) => (subscriptions ?? []).filter((sub) => sub.user_id === note.recipient_id)
    .map((sub) => ({ notification_id: note.id, subscription_id: sub.id })));
  if (!rows.length) return 0;
  const { error: insertError } = await admin.from("web_push_deliveries").upsert(rows, {
    onConflict: "notification_id,subscription_id", ignoreDuplicates: true,
  });
  if (insertError) throw insertError;
  return rows.length;
}

async function dispatch() {
  const cfg = await config();
  if (!cfg?.public_key || !cfg?.private_key) return { configured: false, sent: 0, failed: 0 };
  webpush.setVapidDetails(cfg.subject || "mailto:ibrahimhalilkiv@gmail.com", cfg.public_key, cfg.private_key);
  await prepareDeliveries();
  const { data: pending, error } = await admin.from("web_push_deliveries")
    .select("id,notification_id,subscription_id,status,attempt_count")
    .in("status", ["queued", "failed"]).lte("next_attempt_at", new Date().toISOString())
    .lt("attempt_count", 3).order("created_at").limit(50);
  if (error) throw error;
  let sent = 0, failed = 0, expired = 0;
  for (const item of pending ?? []) {
    const { data: claimed } = await admin.from("web_push_deliveries").update({
      status: "sending", attempt_count: item.attempt_count + 1, updated_at: new Date().toISOString(),
    }).eq("id", item.id).in("status", ["queued", "failed"]).select("id").maybeSingle();
    if (!claimed) continue;
    const [{ data: note }, { data: sub }] = await Promise.all([
      admin.from("notifications").select("id,recipient_id,appointment_id,kind,title,body,reminder_for,mori_event_id").eq("id", item.notification_id).maybeSingle(),
      admin.from("web_push_subscriptions").select("id,user_id,endpoint,p256dh,auth_secret,active").eq("id", item.subscription_id).maybeSingle(),
    ]);
    if (!note || !sub?.active || sub.user_id !== note.recipient_id) {
      await admin.from("web_push_deliveries").update({ status: "expired", last_error: "Kayıt veya abonelik artık aktif değil." }).eq("id", item.id);
      expired++; continue;
    }
    if (note.kind === "customer_return_due") {
      const [{ data: settings, error: settingsError }, { data: owner, error: ownerError }] = await Promise.all([
        admin.from("booking_settings").select("whatsapp_return_auto_enabled").eq("id", true).maybeSingle(),
        admin.from("profiles").select("username,role,active").eq("id", note.recipient_id).maybeSingle(),
      ]);
      if (settingsError || ownerError) throw settingsError ?? ownerError;
      if (!settings || settings.whatsapp_return_auto_enabled || owner?.username !== "halil.kiv" || owner?.role !== "manager" || !owner?.active) {
        await admin.from("web_push_deliveries").update({ status: "expired", last_error: "Manuel geri çağırma bildirimi artık geçerli değil." }).eq("id", item.id);
        expired++; continue;
      }
    }
    if (note.kind === "mori_alert") {
      const [{ data: event }, { data: settings }] = await Promise.all([
        admin.from("mori_events").select("state,recipient_id,category").eq("id", note.mori_event_id).maybeSingle(),
        admin.from("mori_follow_settings").select("enabled,categories").eq("user_id", note.recipient_id).maybeSingle(),
      ]);
      if (!event || event.state !== "active" || event.recipient_id !== note.recipient_id ||
        !settings?.enabled || !settings.categories?.includes(event.category)) {
        await admin.from("web_push_deliveries").update({ status: "expired", last_error: "MORİ uyarısı artık geçerli değil." }).eq("id", item.id);
        expired++; continue;
      }
    }
    let appointment: any = null;
    if (note.appointment_id) {
      const result = await admin.from("appointments").select("id,scheduled_at,status,employee_id").eq("id", note.appointment_id).maybeSingle();
      appointment = result.data;
    }
    if (note.kind === "appointment_thank_you") {
      const { data: current, error: validityError } = await admin.rpc("manual_thank_you_push_is_current", {
        p_notification_id: note.id,
      });
      if (validityError) throw validityError;
      if (!current) {
        await admin.from("web_push_deliveries").update({ status: "expired", last_error: "Teşekkür artık uygun değil." }).eq("id", item.id);
        expired++; continue;
      }
    }
    const cancellation = note.kind === "appointment_cancelled" || note.kind === "appointment_reassigned_from";
    const reminderValid = note.kind !== "appointment_reminder" ||
      (appointment?.status === "confirmed" && appointment?.scheduled_at === note.reminder_for && Date.parse(appointment.scheduled_at) > Date.now());
    const assignedToRecipient = !["appointment", "appointment_update", "appointment_reminder"].includes(note.kind) ||
      appointment?.employee_id === note.recipient_id;
    const eventValid = note.kind === "appointment_thank_you" || cancellation || !note.appointment_id ||
      (appointment?.status === "confirmed" && Date.parse(appointment.scheduled_at) > Date.now());
    if (!reminderValid || !eventValid || !assignedToRecipient) {
      await admin.from("web_push_deliveries").update({ status: "expired", last_error: "Randevu değişti, iptal oldu veya geçmişte kaldı." }).eq("id", item.id);
      expired++; continue;
    }
    const date = appointment?.scheduled_at ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(appointment.scheduled_at)) : "";
    const payload = JSON.stringify({
      title: note.title, body: note.body, tag: `salon-${note.id}`, notificationId: note.id,
      moriEventId: note.mori_event_id || "",
      appointmentId: note.appointment_id || "", appointmentDate: date, kind: note.kind,
      type: note.kind, reminderFor: note.reminder_for || "",
      url: note.kind === "mori_alert"
        ? `./salon-modern.html?kind=mori_alert&event=${encodeURIComponent(note.mori_event_id || "")}`
        : `./salon-modern.html${date ? `?date=${encodeURIComponent(date)}&appointment=${encodeURIComponent(note.appointment_id || "")}&kind=${encodeURIComponent(note.kind || "")}` : ""}`,
    });
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_secret } }, payload, { TTL: 3600, urgency: "high" });
      await admin.from("web_push_deliveries").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", item.id);
      sent++;
    } catch (cause: any) {
      const status = Number(cause?.statusCode || 0);
      if (status === 404 || status === 410) {
        await admin.from("web_push_subscriptions").update({ active: false, updated_at: new Date().toISOString() }).eq("id", sub.id);
        await admin.from("web_push_deliveries").update({ status: "expired", last_error: `Push aboneliği geçersiz (${status}).` }).eq("id", item.id);
        expired++;
      } else {
        const attempts = item.attempt_count + 1;
        await admin.from("web_push_deliveries").update({
          status: attempts >= 3 ? "delivery_unknown" : "failed",
          next_attempt_at: new Date(Date.now() + attempts * 60_000).toISOString(),
          last_error: String(cause?.message || cause).slice(0, 1000), updated_at: new Date().toISOString(),
        }).eq("id", item.id);
        failed++;
      }
    }
  }
  return { configured: true, sent, failed, expired };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = new URL(request.url);
    if (request.method === "GET" && url.searchParams.get("action") === "public-key") {
      const cfg = await config();
      return json({ publicKey: cfg?.public_key || null, configured: Boolean(cfg?.public_key) });
    }
    const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
    if (body.action === "bootstrap-vapid") return await bootstrapVapid(request);
    if (body.action === "test") return await createTestNotification(request, body.subscriptionId || "");
    if (body.action === "dispatch") {
      const cfg = await config();
      if (!cfg?.dispatch_secret || request.headers.get("x-salon-push-secret") !== cfg.dispatch_secret) return json({ error: "Yetkisiz." }, 401);
      return json(await dispatch());
    }
    return json({ error: "Geçersiz işlem." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Web Push işlemi başarısız." }, 500);
  }
});
