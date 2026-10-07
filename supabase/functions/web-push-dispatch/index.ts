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

async function createTestNotification(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return json({ error: "Oturum gerekli." }, 401);
  const { data, error } = await admin.from("notifications").insert({
    recipient_id: user.id, kind: "system", title: "Salon Modern Test Bildirimi",
    body: "Web Push bildirimleri bu cihazda çalışıyor.",
  }).select("id").single();
  if (error) throw error;
  return json({ queued: true, notificationId: data.id, dispatched: await dispatch() });
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
      admin.from("notifications").select("id,appointment_id,kind,title,body,reminder_for").eq("id", item.notification_id).maybeSingle(),
      admin.from("web_push_subscriptions").select("id,endpoint,p256dh,auth_secret,active").eq("id", item.subscription_id).maybeSingle(),
    ]);
    if (!note || !sub?.active) {
      await admin.from("web_push_deliveries").update({ status: "expired", last_error: "Kayıt veya abonelik artık aktif değil." }).eq("id", item.id);
      expired++; continue;
    }
    let appointment: any = null;
    if (note.appointment_id) {
      const result = await admin.from("appointments").select("id,scheduled_at,status").eq("id", note.appointment_id).maybeSingle();
      appointment = result.data;
    }
    const cancellation = note.kind === "appointment_cancelled" || note.kind === "appointment_reassigned_from";
    const reminderValid = note.kind !== "appointment_reminder" ||
      (appointment?.status === "confirmed" && appointment?.scheduled_at === note.reminder_for && Date.parse(appointment.scheduled_at) > Date.now());
    const eventValid = cancellation || !note.appointment_id ||
      (appointment?.status === "confirmed" && Date.parse(appointment.scheduled_at) > Date.now());
    if (!reminderValid || !eventValid) {
      await admin.from("web_push_deliveries").update({ status: "expired", last_error: "Randevu değişti, iptal oldu veya geçmişte kaldı." }).eq("id", item.id);
      expired++; continue;
    }
    const date = appointment?.scheduled_at ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(appointment.scheduled_at)) : "";
    const payload = JSON.stringify({
      title: note.title, body: note.body, tag: `salon-${note.id}`, notificationId: note.id,
      appointmentId: note.appointment_id || "", appointmentDate: date, kind: note.kind,
      type: note.kind, reminderFor: note.reminder_for || "",
      url: `./salon-modern.html${date ? `?date=${encodeURIComponent(date)}&appointment=${encodeURIComponent(note.appointment_id || "")}&kind=${encodeURIComponent(note.kind || "")}` : ""}`,
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
    if (body.action === "test") return await createTestNotification(request);
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
