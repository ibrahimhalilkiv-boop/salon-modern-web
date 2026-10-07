import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { JWT } from "npm:google-auth-library@9.15.1";

type NotificationRow = {
  id: string;
  recipient_id: string;
  appointment_id: string | null;
  title: string;
  body: string;
  kind: string;
  reminder_for: string | null;
  pushed_at: string | null;
};

type WebhookPayload = {
  type: "INSERT";
  table: "notifications";
  schema: "public";
  record: NotificationRow;
};

const projectId = Deno.env.get("FIREBASE_PROJECT_ID") ?? "";
const clientEmail = Deno.env.get("FIREBASE_CLIENT_EMAIL") ?? "";
const privateKey = (Deno.env.get("FIREBASE_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const serviceKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let cachedToken = "";
let cachedTokenUntil = 0;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedTokenUntil > Date.now() + 60_000) return cachedToken;
  const client = new JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });
  const credentials = await client.authorize();
  if (!credentials.access_token) throw new Error("Firebase erişim anahtarı üretilemedi.");
  cachedToken = credentials.access_token;
  cachedTokenUntil = Number(credentials.expiry_date || Date.now() + 45 * 60_000);
  return cachedToken;
}

function firebaseErrorCode(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const error = (value as { error?: { details?: Array<{ errorCode?: string }> } }).error;
  return error?.details?.find((item) => item.errorCode)?.errorCode ?? "";
}

function whatsappPhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `90${digits.slice(1)}`;
  else if (digits.length === 10) digits = `90${digits}`;
  return digits;
}

function renderTemplate(content: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((result, [token, value]) => result.split(token).join(value), content);
}

Deno.serve(async (request: Request) => {
  try {
    if (!projectId || !clientEmail || !privateKey || !serviceKey) {
      throw new Error("Push sunucu ayarları eksik.");
    }
    const payload = (await request.json()) as WebhookPayload;
    if (payload.type !== "INSERT" || payload.table !== "notifications" || !payload.record?.id) {
      return Response.json({ ignored: true });
    }

    const notification = payload.record;
    const { data: appointment, error: appointmentError } = notification.appointment_id
      ? await supabase
          .from("appointments")
          .select("id,scheduled_at,client_name,client_phone,employee_id,amount,status")
          .eq("id", notification.appointment_id)
          .maybeSingle()
      : { data: null, error: null };
    if (appointmentError) throw appointmentError;
    if (notification.kind === "appointment_reminder") {
      const invalidReason = !appointment || appointment.status !== "confirmed"
        ? "appointment_cancelled_or_missing"
        : !notification.reminder_for || Date.parse(notification.reminder_for) !== Date.parse(appointment.scheduled_at)
          ? "appointment_rescheduled"
          : "";
      if (invalidReason) {
        await supabase.from("notifications").update({ last_push_error: invalidReason }).eq("id", notification.id);
        return Response.json({ ignored: true, reason: invalidReason });
      }
    }
    if (appointment && Date.parse(appointment.scheduled_at) <= Date.now()) {
      return Response.json({ ignored: true, reason: "past_appointment" });
    }

    const { data: devices, error: deviceError } = await supabase
      .from("push_devices")
      .select("id,fcm_token")
      .eq("user_id", notification.recipient_id)
      .eq("active", true);
    if (deviceError) throw deviceError;
    if (!devices?.length) {
      await supabase.from("notifications").update({
        push_attempts: 1,
        last_push_error: "Aktif bildirim cihazı bulunamadı.",
      }).eq("id", notification.id);
      return Response.json({ delivered: 0, devices: 0 });
    }

    const token = await accessToken();
    const appointmentDate = appointment?.scheduled_at?.slice(0, 10) ?? "";
    let whatsappUrl = "";
    let reminderDedupeKey = "";
    if (notification.kind === "appointment_reminder" && appointment) {
      const [{ data: employee }, { data: template }] = await Promise.all([
        supabase.from("profiles").select("full_name").eq("id", appointment.employee_id).maybeSingle(),
        supabase.from("message_templates").select("content").eq("template_key", "appointment_reminder").maybeSingle(),
      ]);
      const scheduled = new Date(appointment.scheduled_at);
      const dateText = new Intl.DateTimeFormat("tr-TR", {
        timeZone: "Europe/Istanbul", day: "numeric", month: "long", weekday: "long",
      }).format(scheduled);
      const timeText = new Intl.DateTimeFormat("tr-TR", {
        timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).format(scheduled);
      const defaultTemplate = "Merhaba {musteri_adi},\n\nSalon Modern randevunuzu hatırlatmak isteriz.\n\n📅 Tarih: {randevu_tarihi}\n🕒 Saat: {randevu_saati}\n👤 Çalışan: {calisan_adi}\n\nSizi bekliyoruz.";
      const message = renderTemplate(template?.content || defaultTemplate, {
        "{musteri_adi}": appointment.client_name || "",
        "{randevu_tarihi}": dateText,
        "{randevu_saati}": timeText,
        "{calisan_adi}": employee?.full_name || "",
        "{ucret}": Number(appointment.amount || 0).toLocaleString("tr-TR"),
      });
      const phone = whatsappPhone(appointment.client_phone || "");
      if (phone) whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      reminderDedupeKey = `appointment_reminder_${appointment.id}_${scheduled.getTime()}`;
    }
    let delivered = 0;
    const errors: string[] = [];

    for (const device of devices) {
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            message: {
              token: device.fcm_token,
              // Keep data for in-app routing, and also include a notification
              // payload so Android/OEM firmware can show it while the app is
              // backgrounded or fully closed.
              notification: {
                title: notification.title,
                body: notification.body,
              },
              data: {
                notification_id: notification.id,
                appointment_id: notification.appointment_id ?? "",
                appointment_date: appointmentDate,
                salon_notification_id: notification.id,
                salon_appointment_id: notification.appointment_id ?? "",
                salon_appointment_date: appointmentDate,
                title: notification.title,
                body: notification.body,
                kind: notification.kind || "",
                whatsapp_url: whatsappUrl,
                dedupe_key: reminderDedupeKey,
              },
              android: {
                priority: "HIGH",
                // Deliver immediately when connected, but keep a short retry
                // window so a momentary mobile-network interruption does not
                // make an assignment/update alert disappear completely.
                ttl: notification.kind === "appointment_reminder" ? "300s" : "60s",
                notification: {
                  notification_priority: "PRIORITY_MAX",
                  default_sound: true,
                  default_vibrate_timings: true,
                },
              },
            },
          }),
        },
      );
      const result = await response.json();
      if (response.ok) {
        delivered += 1;
        continue;
      }
      const code = firebaseErrorCode(result);
      errors.push(code || `HTTP ${response.status}`);
      if (code === "UNREGISTERED" || code === "INVALID_ARGUMENT") {
        await supabase.from("push_devices").update({ active: false, updated_at: new Date().toISOString() }).eq("id", device.id);
      }
    }

    await supabase.from("notifications").update({
      pushed_at: delivered ? new Date().toISOString() : null,
      push_attempts: 1,
      last_push_error: errors.length ? errors.join(", ").slice(0, 1000) : null,
    }).eq("id", notification.id);

    return Response.json({ delivered, devices: devices.length, errors });
  } catch (error) {
    console.error(error);
    return Response.json({ error: error instanceof Error ? error.message : "Push gönderilemedi." }, { status: 500 });
  }
});
