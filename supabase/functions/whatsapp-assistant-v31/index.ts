import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import {
  classifyIntent,
  formatIstanbulDateTime,
  formatTurkishDate,
  isNo,
  isYes,
  istanbulDateTimeIso,
  maskPhone,
  nextDate,
  normalizeText,
  normalizeTrPhone,
  parseTime,
  parseTurkishDate,
  rangesOverlap,
  resolveNamedEntity,
  todayInIstanbul,
} from "../_shared/whatsapp-assistant-core.mjs";
import { assistantEnabled, extractMetaEvents, receiptUpdate, templateRevocation } from "../_shared/meta-webhook.mjs";

type DbClient = ReturnType<typeof createClient>;
type Intent = "price" | "service" | "availability" | "create_appointment" | "reschedule_appointment" | "cancel_appointment" | "general" | "handoff";

const SAFE_MODE = (Deno.env.get("SAFE_MODE") ?? "true").toLowerCase() !== "false";
const ASSISTANT_ENABLED = assistantEnabled(Deno.env);
// Public asset ID, not a credential. Only this Salon Modern WABA may revoke
// mappings; an old/test WABA with the same template name cannot affect them.
const WEBHOOK_WABA_ID = Deno.env.get("WHATSAPP_BUSINESS_ACCOUNT_ID") ?? "1859183478383573";
const BOOKING_WRITE_ENABLED = ASSISTANT_ENABLED && !SAFE_MODE && (Deno.env.get("BOOKING_WRITE_ENABLED") ?? "false").toLowerCase() === "true";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

async function hmacHex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getAdminKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    return keys.default ?? "";
  } catch {
    return "";
  }
}

function textFromResponse(response: any) {
  if (typeof response?.output_text === "string") return response.output_text;
  for (const item of response?.output ?? []) {
    for (const content of item?.content ?? []) if (content?.type === "output_text" && typeof content.text === "string") return content.text;
  }
  return "";
}

async function optionalAiIntent(message: string): Promise<{ intent: Intent; confidence: number } | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  const model = Deno.env.get("OPENAI_MODEL") ?? "";
  if (!apiKey || !model) return null;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        store: false,
        input: [
          { role: "system", content: "Yalnızca Türkçe berber randevu mesajının niyetini sınıflandır. Veri sorgulama, SQL veya işlem yapma." },
          { role: "user", content: message },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "salon_intent",
            strict: true,
            schema: {
              type: "object",
              properties: {
                intent: { type: "string", enum: ["price", "service", "availability", "create_appointment", "reschedule_appointment", "cancel_appointment", "general", "handoff"] },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["intent", "confidence"],
              additionalProperties: false,
            },
          },
        },
      }),
    });
    if (!response.ok) return null;
    const parsed = JSON.parse(textFromResponse(await response.json()));
    return parsed?.intent ? parsed : null;
  } catch (error) {
    console.error("optional_ai_intent_failed", error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function detectIntent(message: string): Promise<{ intent: Intent; confidence: number; source: string }> {
  const local = classifyIntent(message) as { intent: Intent; confidence: number };
  if (local.confidence >= 0.6) return { ...local, source: "rules" };
  const ai = await optionalAiIntent(message);
  if (ai && ai.confidence >= 0.72) return { ...ai, source: "openai_classifier" };
  return { ...local, source: "rules_low_confidence" };
}

async function deliverAssistantMessage(db: DbClient, conversationId: string, recipient: string, content: string, metadata: Record<string, unknown>) {
  if (!ASSISTANT_ENABLED) return { sent: false, reason: "assistant_disabled" };
  const stored = await db.from("assistant_messages").insert({
    conversation_id: conversationId,
    direction: "outbound",
    role: "assistant",
    message_type: "text",
    content,
    metadata: { ...metadata, safe_mode: SAFE_MODE, booking_write_enabled: BOOKING_WRITE_ENABLED, delivery: SAFE_MODE ? "suppressed_safe_mode" : "pending" },
  }).select("id").single();
  if (stored.error || !stored.data) throw stored.error ?? new Error("assistant_message_store_failed");
  if (SAFE_MODE) return { sent: false, reason: "safe_mode" };

  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
  const graphVersion = Deno.env.get("WHATSAPP_GRAPH_API_VERSION") ?? "";
  if (!accessToken || !phoneNumberId || !graphVersion) {
    await db.from("assistant_messages").update({ metadata: { ...metadata, safe_mode: false, delivery: "missing_whatsapp_configuration" } }).eq("id", stored.data.id);
    return { sent: false, reason: "missing_configuration" };
  }
  const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(graphVersion)}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: recipient, type: "text", text: { preview_url: false, body: content } }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    await db.from("assistant_messages").update({ metadata: { ...metadata, safe_mode: false, delivery: "failed", http_status: response.status } }).eq("id", stored.data.id);
    console.error("whatsapp_send_failed", response.status);
    return { sent: false, reason: "provider_error" };
  }
  const providerMessageId = result?.messages?.[0]?.id ?? null;
  await db.from("assistant_messages").update({ provider_message_id: providerMessageId, metadata: { ...metadata, safe_mode: false, delivery: "sent" } }).eq("id", stored.data.id);
  return { sent: true };
}

async function loadCatalog(db: DbClient) {
  const [serviceResult, profileResult] = await Promise.all([
    db.from("services").select("id,name,price,duration_minutes").eq("active", true).order("price", { ascending: false }),
    db.from("profiles").select("id,full_name,role").eq("active", true).order("full_name"),
  ]);
  if (serviceResult.error) throw serviceResult.error;
  if (profileResult.error) throw profileResult.error;
  return { services: serviceResult.data ?? [], profiles: profileResult.data ?? [] };
}

function dateFromIso(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function timeFromIso(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

async function loadEmployeeSchedule(db: DbClient, employeeId: string, date: string) {
  const dayStart = istanbulDateTimeIso(date, "00:00");
  const dayEnd = istanbulDateTimeIso(nextDate(date), "00:00");
  const [appointmentResult, closedResult] = await Promise.all([
    db.from("appointments").select("id,scheduled_at,scheduled_end,duration_minutes,status").eq("employee_id", employeeId).gte("scheduled_at", dayStart).lt("scheduled_at", dayEnd),
    db.from("closed_time_slots").select("starts_at,ends_at").eq("employee_id", employeeId).lt("starts_at", dayEnd).gt("ends_at", dayStart),
  ]);
  if (appointmentResult.error) throw appointmentResult.error;
  if (closedResult.error) throw closedResult.error;
  return { appointments: appointmentResult.data ?? [], closedSlots: closedResult.data ?? [] };
}

function scheduleSlotFree(schedule: any, startIso: string, durationMinutes: number, excludeAppointmentId?: string) {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const occupied = schedule.appointments.some((item: any) => {
    if (excludeAppointmentId && item.id === excludeAppointmentId) return false;
    const itemEnd = item.scheduled_end ?? new Date(new Date(item.scheduled_at).getTime() + Number(item.duration_minutes || 30) * 60_000).toISOString();
    return rangesOverlap(start.toISOString(), end.toISOString(), item.scheduled_at, itemEnd);
  });
  const closed = schedule.closedSlots.some((item: any) => rangesOverlap(start.toISOString(), end.toISOString(), item.starts_at, item.ends_at));
  return !occupied && !closed;
}

async function isSlotFree(db: DbClient, employeeId: string, startIso: string, durationMinutes: number, excludeAppointmentId?: string) {
  const schedule = await loadEmployeeSchedule(db, employeeId, dateFromIso(startIso));
  return scheduleSlotFree(schedule, startIso, durationMinutes, excludeAppointmentId);
}

async function findAvailableTimes(db: DbClient, employeeId: string, date: string, durationMinutes: number, excludeAppointmentId?: string) {
  const times: string[] = [];
  const schedule = await loadEmployeeSchedule(db, employeeId, date);
  for (let minute = 8 * 60; minute + durationMinutes <= 24 * 60; minute += 30) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const iso = istanbulDateTimeIso(date, time);
    if (!iso || new Date(iso) <= new Date()) continue;
    if (scheduleSlotFree(schedule, iso, durationMinutes, excludeAppointmentId)) times.push(time);
    if (times.length >= 5) break;
  }
  return times;
}

async function replacePendingAction(db: DbClient, conversationId: string, actionType: string, payload: Record<string, unknown>) {
  await db.from("assistant_pending_actions").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("conversation_id", conversationId).eq("status", "pending");
  const result = await db.from("assistant_pending_actions").insert({
    conversation_id: conversationId,
    action_type: actionType,
    payload,
    status: "pending",
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  }).select("id,action_type,payload,status,expires_at").single();
  if (result.error) throw result.error;
  return result.data;
}

async function currentPendingAction(db: DbClient, conversationId: string) {
  const result = await db.from("assistant_pending_actions").select("id,action_type,payload,status,expires_at").eq("conversation_id", conversationId).eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw result.error;
  if (result.data?.expires_at && new Date(result.data.expires_at) <= new Date()) {
    await db.from("assistant_pending_actions").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", result.data.id);
    return null;
  }
  return result.data;
}

function confirmationText(action: any, catalog: any) {
  const service = catalog.services.find((item: any) => item.id === action.payload.service_id);
  const employee = catalog.profiles.find((item: any) => item.id === action.payload.employee_id);
  const verb = action.action_type === "create_appointment" ? "oluşturayım mı" : action.action_type === "reschedule_appointment" ? "güncelleyeyim mi" : "iptal edeyim mi";
  if (action.action_type === "cancel_appointment") {
    return `${action.payload.client_name} adına ${formatIstanbulDateTime(action.payload.expected_scheduled_at)} randevusunu iptal edeyim mi? Lütfen Evet veya Hayır yazın.`;
  }
  return `${action.payload.client_name} — ${formatIstanbulDateTime(action.payload.scheduled_at)}, ${employee?.full_name ?? "çalışan"}, ${service?.name ?? action.payload.service_name ?? "hizmet"}. Randevuyu ${verb}? Lütfen Evet veya Hayır yazın.`;
}

async function handlePending(db: DbClient, conversation: any, sender: string, message: string, pending: any, catalog: any) {
  if (isNo(message)) {
    await db.from("assistant_pending_actions").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", pending.id);
    await deliverAssistantMessage(db, conversation.id, sender, "İşlemi iptal ettim. Başka nasıl yardımcı olabilirim?", { intent: pending.action_type, action_id: pending.id, decision: "cancelled" });
    return true;
  }
  if (pending.action_type === "create_appointment" && pending.payload?.stage === "awaiting_time") {
    const time = parseTime(message);
    if (!time) return false;
    const scheduledAt = istanbulDateTimeIso(pending.payload.date, time);
    const service = catalog.services.find((item: any) => item.id === pending.payload.service_id);
    if (!scheduledAt || !service || !(await isSlotFree(db, pending.payload.employee_id, scheduledAt, Number(service.duration_minutes || 30)))) {
      await deliverAssistantMessage(db, conversation.id, sender, "Bu saat dolu veya kapalı. Size sunduğum müsait saatlerden başka birini seçebilirsiniz.", { intent: "create_appointment", action_id: pending.id, slot_rejected: true });
      return true;
    }
    const payload = { ...pending.payload, stage: "awaiting_confirmation", scheduled_at: scheduledAt, confirmation_ready: true };
    await db.from("assistant_pending_actions").update({ payload, updated_at: new Date().toISOString() }).eq("id", pending.id);
    await deliverAssistantMessage(db, conversation.id, sender, confirmationText({ ...pending, payload }, catalog), { intent: "create_appointment", action_id: pending.id, awaiting_confirmation: true });
    return true;
  }
  if (!isYes(message)) return false;
  if (!pending.payload?.confirmation_ready) return false;
  if (SAFE_MODE) {
    await deliverAssistantMessage(db, conversation.id, sender, "SAFE_MODE açık: onay algılandı, ancak test modunda randevu kaydı ve WhatsApp gönderimi yapılmadı.", { intent: pending.action_type, action_id: pending.id, decision: "confirmed_suppressed" });
    return true;
  }
  if (!BOOKING_WRITE_ENABLED) {
    await deliverAssistantMessage(db, conversation.id, sender, "Randevu bilgilerinizi aldım. Otomatik kayıt şu anda kapalı; ekibimiz işlemi tamamlayacak.", { intent: pending.action_type, action_id: pending.id, decision: "confirmed_write_disabled" });
    return true;
  }
  const execution = await db.rpc("assistant_execute_pending_action", { p_action_id: pending.id });
  if (execution.error) {
    await db.from("assistant_pending_actions").update({ status: "failed", updated_at: new Date().toISOString(), payload: { ...pending.payload, last_error: execution.error.message } }).eq("id", pending.id);
    await deliverAssistantMessage(db, conversation.id, sender, `İşlem tamamlanamadı: ${execution.error.message}`, { intent: pending.action_type, action_id: pending.id, decision: "failed" });
    return true;
  }
  const successText = pending.action_type === "cancel_appointment" ? "Randevunuz iptal edildi." : pending.action_type === "reschedule_appointment" ? "Randevunuz güncellendi." : "Randevunuz oluşturuldu.";
  await deliverAssistantMessage(db, conversation.id, sender, successText, { intent: pending.action_type, action_id: pending.id, appointment_id: execution.data?.appointment_id, decision: "executed" });
  return true;
}

async function futureAppointments(db: DbClient, clientId: string) {
  const result = await db.from("appointments").select("id,client_id,client_name,service_id,service_name,employee_id,scheduled_at,duration_minutes,status").eq("client_id", clientId).neq("status", "cancelled").gte("scheduled_at", new Date().toISOString()).order("scheduled_at").limit(5);
  if (result.error) throw result.error;
  return result.data ?? [];
}

async function createDraft(db: DbClient, conversation: any, sender: string, message: string, client: any, catalog: any) {
  if (!client) return "Randevu için kayıtlı müşteri eşleşmesi gerekiyor. Bir çalışanımızla görüşmek isterseniz 'personel' yazabilirsiniz.";
  const employee = resolveNamedEntity(message, catalog.profiles, "full_name") ?? catalog.profiles.find((item: any) => item.id === client.preferred_employee_id);
  const service = resolveNamedEntity(message, catalog.services, "name") ?? catalog.services.find((item: any) => item.id === client.preferred_service_id);
  const date = parseTurkishDate(message);
  const time = parseTime(message);
  if (!employee) return "Hangi çalışanı tercih ettiğinizi yazar mısınız?";
  if (!service) return "Hangi hizmeti istediğinizi yazar mısınız?";
  if (!date) return "Randevuyu hangi gün için istediğinizi yazar mısınız?";
  if (time) {
    const scheduledAt = istanbulDateTimeIso(date, time);
    if (!scheduledAt || !(await isSlotFree(db, employee.id, scheduledAt, Number(service.duration_minutes || 30)))) {
      const alternatives = await findAvailableTimes(db, employee.id, date, Number(service.duration_minutes || 30));
      return alternatives.length ? `${employee.full_name} o saatte dolu veya kapalı. Yakın müsait seçenekler: ${alternatives.join(", ")}.` : `${employee.full_name} için o gün uygun saat bulunamadı.`;
    }
    const action = await replacePendingAction(db, conversation.id, "create_appointment", {
      stage: "awaiting_confirmation", confirmation_ready: true, client_id: client.client_id, client_name: client.full_name,
      employee_id: employee.id, service_id: service.id, scheduled_at: scheduledAt,
    });
    return confirmationText(action, catalog);
  }
  const available = await findAvailableTimes(db, employee.id, date, Number(service.duration_minutes || 30));
  if (!available.length) return `${employee.full_name} için ${formatTurkishDate(date)} günü uygun saat bulunamadı.`;
  await replacePendingAction(db, conversation.id, "create_appointment", {
    stage: "awaiting_time", confirmation_ready: false, client_id: client.client_id, client_name: client.full_name,
    employee_id: employee.id, service_id: service.id, date, offered_times: available,
  });
  return `Genellikle ${employee.full_name} ile ${service.name} hizmetini tercih ediyorsunuz. ${formatTurkishDate(date)} için ${available.join(", ")} müsait. Hangisini ayırayım?`;
}

async function rescheduleDraft(db: DbClient, conversation: any, message: string, client: any, catalog: any) {
  if (!client) return "Randevu değişikliği için kayıtlı müşteri eşleşmesi gerekiyor.";
  const appointments = await futureAppointments(db, client.client_id);
  if (!appointments.length) return "Değiştirilebilecek gelecek randevunuz bulunamadı.";
  if (appointments.length > 1 && !parseTurkishDate(message)) return `Birden fazla randevunuz var: ${appointments.map((item: any) => formatIstanbulDateTime(item.scheduled_at)).join(", ")}. Değiştirmek istediğiniz tarihi yazın.`;
  const requestedDate = parseTurkishDate(message);
  const appointment = requestedDate ? appointments.find((item: any) => dateFromIso(item.scheduled_at) === requestedDate) : appointments[0];
  if (!appointment) return "Belirttiğiniz tarihte değiştirilebilecek randevu bulunamadı.";
  const targetDate = requestedDate ?? dateFromIso(appointment.scheduled_at);
  const targetTime = parseTime(message);
  if (!targetTime) return "Yeni saati HH:MM biçiminde yazar mısınız?";
  const employee = resolveNamedEntity(message, catalog.profiles, "full_name") ?? catalog.profiles.find((item: any) => item.id === appointment.employee_id);
  const scheduledAt = istanbulDateTimeIso(targetDate, targetTime);
  if (!employee || !scheduledAt || !(await isSlotFree(db, employee.id, scheduledAt, Number(appointment.duration_minutes || 30), appointment.id))) return "Seçilen yeni saat dolu veya kapalı. Lütfen başka bir saat seçin.";
  const action = await replacePendingAction(db, conversation.id, "reschedule_appointment", {
    stage: "awaiting_confirmation", confirmation_ready: true, appointment_id: appointment.id, client_id: client.client_id,
    client_name: client.full_name, employee_id: employee.id, service_id: appointment.service_id, service_name: appointment.service_name,
    scheduled_at: scheduledAt, expected_scheduled_at: appointment.scheduled_at, expected_employee_id: appointment.employee_id,
  });
  return confirmationText(action, catalog);
}

async function cancelDraft(db: DbClient, conversation: any, message: string, client: any, catalog: any) {
  if (!client) return "Randevu iptali için kayıtlı müşteri eşleşmesi gerekiyor.";
  const appointments = await futureAppointments(db, client.client_id);
  if (!appointments.length) return "İptal edilebilecek gelecek randevunuz bulunamadı.";
  if (appointments.length > 1 && !parseTurkishDate(message)) return `Birden fazla randevunuz var: ${appointments.map((item: any) => formatIstanbulDateTime(item.scheduled_at)).join(", ")}. İptal etmek istediğiniz tarihi yazın.`;
  const requestedDate = parseTurkishDate(message);
  const appointment = requestedDate ? appointments.find((item: any) => dateFromIso(item.scheduled_at) === requestedDate) : appointments[0];
  if (!appointment) return "Belirttiğiniz tarihte iptal edilebilecek randevu bulunamadı.";
  const action = await replacePendingAction(db, conversation.id, "cancel_appointment", {
    stage: "awaiting_confirmation", confirmation_ready: true, appointment_id: appointment.id, client_id: client.client_id,
    client_name: client.full_name, expected_scheduled_at: appointment.scheduled_at, expected_employee_id: appointment.employee_id,
  });
  return confirmationText(action, catalog);
}

async function availabilityReply(db: DbClient, message: string, catalog: any) {
  const date = parseTurkishDate(message);
  if (!date) return "Müsaitliği hangi gün için kontrol edeyim?";
  const employee = resolveNamedEntity(message, catalog.profiles, "full_name");
  if (!employee) return "Hangi çalışan için müsaitlik aradığınızı yazar mısınız?";
  const requestedTime = parseTime(message);
  const duration = 30;
  if (requestedTime) {
    const start = istanbulDateTimeIso(date, requestedTime);
    return start && await isSlotFree(db, employee.id, start, duration) ? `${employee.full_name}, ${formatTurkishDate(date)} saat ${requestedTime} için müsait.` : `${employee.full_name}, ${formatTurkishDate(date)} saat ${requestedTime} için dolu veya kapalı.`;
  }
  const times = await findAvailableTimes(db, employee.id, date, duration);
  return times.length ? `${employee.full_name} için ${formatTurkishDate(date)} müsait saatler: ${times.join(", ")}.` : `${employee.full_name} için o gün müsait saat bulunamadı.`;
}

async function handleMessage(db: DbClient, conversation: any, sender: string, message: string, client: any) {
  const catalog = await loadCatalog(db);
  const pending = await currentPendingAction(db, conversation.id);
  if (pending && await handlePending(db, conversation, sender, message, pending, catalog)) return;

  const detected = await detectIntent(message);
  let reply = "";
  if (detected.intent === "handoff" || detected.confidence < 0.55) {
    await db.from("assistant_conversations").update({ status: "human", updated_at: new Date().toISOString() }).eq("id", conversation.id);
    await replacePendingAction(db, conversation.id, "handoff", { reason: detected.intent === "handoff" ? "customer_requested" : "low_intent_confidence", original_message: message });
    await db.from("assistant_pending_actions").update({ status: "executed", updated_at: new Date().toISOString() }).eq("conversation_id", conversation.id).eq("status", "pending").eq("action_type", "handoff");
    reply = "Sizi salon ekibine aktarıyorum. Bu görüşmede bot artık otomatik yanıt vermeyecek.";
  } else if (detected.intent === "price" || detected.intent === "service") {
    const selected = resolveNamedEntity(message, catalog.services, "name");
    reply = selected ? `${selected.name}: ${Number(selected.price).toLocaleString("tr-TR")} TL.` : `Aktif hizmetlerimiz: ${catalog.services.map((item: any) => `${item.name} ${Number(item.price).toLocaleString("tr-TR")} TL`).join(", ")}.`;
  } else if (detected.intent === "availability") {
    reply = await availabilityReply(db, message, catalog);
  } else if (detected.intent === "create_appointment") {
    reply = await createDraft(db, conversation, sender, message, client, catalog);
  } else if (detected.intent === "reschedule_appointment") {
    reply = await rescheduleDraft(db, conversation, message, client, catalog);
  } else if (detected.intent === "cancel_appointment") {
    reply = await cancelDraft(db, conversation, message, client, catalog);
  } else {
    const personal = client ? `Merhaba ${client.full_name}. ` : "Merhaba. ";
    reply = `${personal}Hizmet fiyatlarını, çalışan müsaitliğini veya randevu işlemlerini sorabilirsiniz.`;
  }
  await deliverAssistantMessage(db, conversation.id, sender, reply, { intent: detected.intent, intent_source: detected.source, intent_confidence: detected.confidence, client_id: client?.client_id ?? null });
}

Deno.serve(async (request: Request) => {
  const url = new URL(request.url);
  const verifyToken = Deno.env.get("WHATSAPP_META_VERIFY_TOKEN") ?? Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
  if (request.method === "GET") {
    const valid = url.searchParams.get("hub.mode") === "subscribe" && verifyToken && safeEqual(url.searchParams.get("hub.verify_token") ?? "", verifyToken);
    return valid ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("Forbidden", { status: 403 });
  }
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const appSecret = Deno.env.get("META_APP_SECRET") ?? "";
  if (!appSecret) return json({ ok: false, error: "whatsapp_not_configured" }, 503);
  const rawBody = await request.text();
  const expected = `sha256=${await hmacHex(appSecret, rawBody)}`;
  if (!safeEqual(request.headers.get("x-hub-signature-256") ?? "", expected)) return new Response("Unauthorized", { status: 401 });

  let body: any;
  try { body = JSON.parse(rawBody); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const adminKey = getAdminKey();
  if (!supabaseUrl || !adminKey) return json({ ok: false, error: "server_not_configured" }, 503);
  const db = createClient(supabaseUrl, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { messages, statuses, templateChanges } = extractMetaEvents(body);
  const results: Array<Record<string, unknown>> = [];

  // Conditional updates prevent out-of-order/duplicate receipts from turning
  // an already-read message back into sent/failed. Unknown IDs update no rows.
  for (const receipt of statuses) {
    const update = receiptUpdate(receipt);
    if (!update) continue;
    const saved = await db.from("whatsapp_message_logs").update(update.patch)
      .eq("provider_message_id", update.id).in("status", update.predecessors);
    if (saved.error) return json({ ok: false, error: "receipt_store_failed" }, 503);
  }
  for (const change of templateChanges) {
    if (change.waba_id !== WEBHOOK_WABA_ID) continue;
    const revoked = templateRevocation(change);
    if (!revoked) continue;
    const saved = await db.from("whatsapp_meta_template_mappings")
      .update({ ...revoked.patch, updated_at: new Date().toISOString() })
      .eq("meta_template_name", revoked.name).eq("language_code", revoked.language);
    if (saved.error) return json({ ok: false, error: "template_status_store_failed" }, 503);
  }

  // Appointment notifications and inbound chatbot activation are independent.
  // Do not store private conversations or call AI/booking tools unless opted in.
  if (!ASSISTANT_ENABLED) return json({ ok: true, assistant_enabled: false, receipts: statuses.length });

  for (const inbound of messages) {
    const providerMessageId = String(inbound?.id ?? "");
    const sender = normalizeTrPhone(String(inbound?.from ?? ""));
    const content = inbound?.text?.body ? String(inbound.text.body).trim() : "";
    if (!providerMessageId || !sender) { results.push({ provider_message_id: providerMessageId || null, status: "ignored_invalid_sender" }); continue; }

    try {
      const lookup = await db.rpc("assistant_lookup_client_context_by_phone", { p_phone: sender });
      if (lookup.error) throw lookup.error;
      const clients = lookup.data ?? [];
      const conversationPayload: Record<string, unknown> = { channel: "whatsapp", external_user_id: sender, last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      if (clients.length === 1) conversationPayload.client_id = clients[0].client_id;
      const conversationResult = await db.from("assistant_conversations").upsert(conversationPayload, { onConflict: "channel,external_user_id" }).select("id,status,client_id,bot_paused_until").single();
      if (conversationResult.error || !conversationResult.data) throw conversationResult.error ?? new Error("conversation_upsert_failed");
      const conversation = conversationResult.data;

      const insert = await db.from("assistant_messages").insert({
        conversation_id: conversation.id,
        provider_message_id: providerMessageId,
        direction: "inbound",
        role: "user",
        message_type: String(inbound?.type ?? "unknown"),
        content: content || null,
        metadata: { timestamp: inbound?.timestamp ?? null, normalized_sender: sender, safe_mode: SAFE_MODE },
      }).select("id").single();
      if (insert.error?.code === "23505") { results.push({ provider_message_id: providerMessageId, status: "duplicate" }); continue; }
      if (insert.error) throw insert.error;

      if (clients.length > 1) {
        await db.from("assistant_conversations").update({ status: "human", updated_at: new Date().toISOString() }).eq("id", conversation.id);
        await replacePendingAction(db, conversation.id, "handoff", { reason: "ambiguous_phone", candidate_client_ids: clients.map((item: any) => item.client_id), candidates: clients.map((item: any) => ({ client_id: item.client_id, full_name: item.full_name, phone: maskPhone(item.phone) })) });
        await db.from("assistant_pending_actions").update({ status: "executed", updated_at: new Date().toISOString() }).eq("conversation_id", conversation.id).eq("status", "pending").eq("action_type", "handoff");
        await deliverAssistantMessage(db, conversation.id, sender, "Bu telefon numarasıyla birden fazla müşteri kaydı bulundu. Yanlış randevu oluşturmamak için görüşmeyi salon ekibine aktarıyorum.", { intent: "handoff", reason: "ambiguous_phone" });
        results.push({ provider_message_id: providerMessageId, status: "human_handoff_ambiguous_client" });
        continue;
      }
      if (conversation.status === "human" || (conversation.bot_paused_until && new Date(conversation.bot_paused_until) > new Date())) {
        results.push({ provider_message_id: providerMessageId, status: "stored_human_mode" });
        continue;
      }
      if (inbound?.type !== "text" || !content) {
        await deliverAssistantMessage(db, conversation.id, sender, "Şimdilik yalnızca yazılı mesajları anlayabiliyorum. Lütfen isteğinizi yazar mısınız?", { intent: "general", unsupported_message_type: inbound?.type ?? "unknown" });
        results.push({ provider_message_id: providerMessageId, status: SAFE_MODE ? "drafted_safe_mode" : "processed" });
        continue;
      }
      const client = clients[0] ?? null;
      await handleMessage(db, conversation, sender, content, client);
      results.push({ provider_message_id: providerMessageId, status: SAFE_MODE ? "drafted_safe_mode" : "processed", client_id: client?.client_id ?? null });
    } catch (error) {
      console.error("message_processing_failed", providerMessageId, error instanceof Error ? error.message : String(error));
      results.push({ provider_message_id: providerMessageId, status: "failed" });
    }
  }
  return json({ ok: true, safe_mode: SAFE_MODE, booking_write_enabled: BOOKING_WRITE_ENABLED, processed: results });
});
