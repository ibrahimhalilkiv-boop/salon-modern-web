// Server-only YCloud transport. The account and templates must be approved
// before the dispatcher is explicitly switched to this provider.
const API = "https://api.ycloud.com/v2";
export const YCLOUD_APPOINTMENT_TEMPLATES = Object.freeze({
  appointment_confirmation: "salon_modern_randevu_onayi_v2",
  appointment_update: "salon_modern_randevu_guncelleme_v3",
  appointment_reminder: "salon_modern_randevu_hatirlatma_v2",
  appointment_cancelled: "salon_modern_randevu_iptal_v2",
});
const commonParameters = ["{musteri_adi}", "{randevu_tarihi}", "{randevu_saati}", "{calisan_adi}"];
export const YCLOUD_APPOINTMENT_PARAMETERS = Object.freeze({
  appointment_confirmation: ["{musteri_adi}", "{randevu_tarihi}", "{randevu_saati}", "{islem_adi}", "{calisan_adi}"],
  appointment_update: commonParameters,
  appointment_reminder: commonParameters,
  appointment_cancelled: commonParameters,
});
export const YCLOUD_REMINDER_URL = "https://salonmodern.com.tr/konum";
export const YCLOUD_APPOINTMENT_BODIES = Object.freeze({
  appointment_confirmation: "Merhaba {{1}} 👋\n\n💈 Salon Modern randevunuz oluşturuldu.\n\n📅 Tarih: {{2}}\n🕒 Saat: {{3}}\n✂️ Hizmet: {{4}}\n👤 Berber: {{5}}\n\nSizi bekliyoruz.\nSalon Modern",
  appointment_update: "Merhaba {{1}},\n\nSalon Modern randevunuzun bilgileri güncellendi.\n\n📅 Yeni tarih: {{2}}\n🕒 Yeni saat: {{3}}\n👤 Berber: {{4}}\n\nGüncel randevu bilgileriniz yukarıdaki gibidir.\n\nSalon Modern",
  appointment_reminder: "Merhaba {{1}} 👋\n\n⏰ Salon Modern randevunuzu hatırlatmak isteriz.\n\nRandevu saatiniz yaklaşıyor.\n\n📅 Tarih: {{2}}\n🕒 Saat: {{3}}\n👤 Berber: {{4}}\n\n📍 Konumumuza ulaşmak için aşağıdaki Yol Tarifi butonunu kullanabilirsiniz.\n\nGörüşmek üzere! 💈\nSalon Modern",
  appointment_cancelled: "Merhaba {{1}},\n\nSalon Modern randevunuz iptal edilmiştir.\n\n📅 Tarih: {{2}}\n🕒 Saat: {{3}}\n👤 Berber: {{4}}\n\nBilginize sunarız.\n\nSalon Modern",
});
export function ycloudExpectedMessage(templateKey, values) {
  const body = YCLOUD_APPOINTMENT_BODIES[templateKey];
  const tokens = YCLOUD_APPOINTMENT_PARAMETERS[templateKey];
  if (!body || !tokens) return null;
  return body.replace(/\{\{(\d+)\}\}/g, (_, index) => String(values[tokens[Number(index) - 1]] ?? ""));
}

function configuration(env) {
  const apiKey = env.get("YCLOUD_API_KEY") ?? "";
  const wabaId = env.get("YCLOUD_WABA_ID") ?? "";
  const from = env.get("YCLOUD_PHONE_NUMBER") ?? "";
  if (!apiKey || !/^\d+$/.test(wabaId) || !/^\+[1-9]\d{7,14}$/.test(from)) return null;
  return { apiKey, wabaId, from };
}

export function ycloudTemplatePayload({ from, to, name, languageCode = "tr", parameterTokens, values, externalId }) {
  return {
    from,
    to: `+${String(to).replace(/^\+/, "")}`,
    type: "template",
    externalId,
    template: {
      name,
      language: { code: languageCode },
      components: [{ type: "body", parameters: parameterTokens.map((token) => ({ type: "text", text: String(values[token]) })) }],
    },
  };
}

export async function ycloudTemplateApproved(name, languageCode, parameterCount, expectedContent = null, parameterTokens = [], values = {}, env = Deno.env, fetcher = fetch, expectedButtons = undefined) {
  const config = configuration(env);
  if (!config) return { ok: false, reason: "missing_ycloud_configuration" };
  const url = `${API}/whatsapp/templates/${encodeURIComponent(config.wabaId)}/${encodeURIComponent(name)}/${encodeURIComponent(languageCode)}`;
  try {
    const response = await fetcher(url, { headers: { "X-API-Key": config.apiKey, accept: "application/json" } });
    if (!response.ok) return { ok: false, reason: response.status === 404 ? "template_missing" : "template_status_unavailable", retryable: response.status === 429 || response.status >= 500 };
    const template = await response.json();
    const body = template?.components?.find((component) => component.type === "BODY");
    const numbers = [...String(body?.text ?? "").matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
    const expected = Array.from({ length: parameterCount }, (_, index) => index + 1);
    if (template?.wabaId !== config.wabaId || template?.name !== name || template?.language !== languageCode || template?.category !== "UTILITY" || template?.status !== "APPROVED" || JSON.stringify([...new Set(numbers)].sort((a, b) => a - b)) !== JSON.stringify(expected)) {
      return { ok: false, reason: "template_not_approved_or_mismatched" };
    }
    const rendered = String(body.text).replace(/\{\{(\d+)\}\}/g, (_, index) => String(values[parameterTokens[Number(index) - 1]] ?? ""));
    if (expectedContent !== null && rendered.replace(/\s+/g, " ").trim() !== String(expectedContent).replace(/\s+/g, " ").trim()) return { ok: false, reason: "template_content_mismatch" };
    if (expectedButtons !== undefined) {
      const buttons = template?.components?.find((component) => component.type === "BUTTONS")?.buttons ?? [];
      if (buttons.length !== expectedButtons.length || buttons.some((button, index) =>
        button.type !== expectedButtons[index].type || button.url !== expectedButtons[index].url ||
        !expectedButtons[index].texts.includes(button.text)
      )) return { ok: false, reason: "template_button_mismatch" };
    }
    return { ok: true, from: config.from, renderedMessage: rendered };
  } catch {
    return { ok: false, reason: "template_status_unavailable", retryable: true };
  }
}

export async function postYCloudMessage(payload, env = Deno.env, fetcher = fetch, timeoutMs = 10_000) {
  const config = configuration(env);
  if (!config || payload.from !== config.from) return { ok: false, kind: "configuration", error: "missing_ycloud_configuration" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${API}/whatsapp/messages`, {
      method: "POST",
      headers: { "X-API-Key": config.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, kind: response.status === 429 ? "retryable" : response.status >= 500 ? "unknown" : "rejected", httpStatus: response.status };
    const body = await response.json().catch(() => null);
    if (!body?.id || body?.wabaId !== config.wabaId || body?.from !== config.from || body?.externalId !== payload.externalId || body?.status === "failed") {
      return { ok: false, kind: "unknown", error: "ycloud_response_unverifiable" };
    }
    return { ok: true, providerMessageId: body.id, providerStatus: body.status ?? "accepted" };
  } catch {
    // A timeout can happen after YCloud accepted the request. Never retry it
    // automatically, because externalId is a reference, not a dedupe key.
    return { ok: false, kind: "unknown", error: "ycloud_delivery_unknown" };
  } finally {
    clearTimeout(timer);
  }
}

export function ycloudDeliveryFresh(delivery, appointment, catchupMinutes = 30, now = Date.now()) {
  const scheduled = Date.parse(delivery?.scheduled_for ?? "");
  if (!Number.isFinite(scheduled) || scheduled > now || appointment?.status === "cancelled" && delivery?.template_key !== "appointment_cancelled") return false;
  if (delivery?.template_key === "appointment_cancelled" && appointment?.status !== "cancelled") return false;
  if (delivery?.template_key === "appointment_reminder") {
    return appointment?.status === "confirmed" && Date.parse(appointment?.scheduled_at ?? "") > now && now - scheduled <= catchupMinutes * 60_000;
  }
  return now - scheduled <= 30 * 60_000;
}

export async function verifyYCloudSignature(header, rawBody, secret, now = Date.now()) {
  if (!header || !secret) return false;
  const fields = Object.fromEntries(header.split(",").map((field) => field.trim().split("=")));
  const seconds = Number(fields.t);
  if (!Number.isSafeInteger(seconds) || Math.abs(now - seconds * 1000) > 5 * 60_000 || !/^[a-f0-9]{64}$/i.test(fields.s ?? "")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${fields.t}.${rawBody}`));
  const expected = new Uint8Array(digest);
  const supplied = Uint8Array.from(fields.s.match(/../g), (byte) => Number.parseInt(byte, 16));
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ supplied[index];
  return difference === 0;
}

export function ycloudStatusTransition(current, next) {
  if (current === "read" || current === "failed" || current === "delivery_unknown") return null;
  if (current === "delivered" && next !== "read") return null;
  if (next === "read") return "read";
  if (next === "delivered") return "delivered";
  if (next === "failed" && (current === "sent" || current === "sending")) return "failed";
  if (next === "sent" && current === "sending") return "sent";
  if (next === "sent" && current === "sent") return "sent";
  return null;
}
