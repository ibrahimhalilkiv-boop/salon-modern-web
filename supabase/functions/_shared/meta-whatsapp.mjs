
// Shared server-only Meta Cloud API helpers. No credential belongs in the APK.
export const META_TEMPLATE_TOKENS = {
  appointment_confirmation: ["{musteri_adi}", "{randevu_tarihi}", "{randevu_saati}", "{calisan_adi}"],
  appointment_update: ["{musteri_adi}", "{randevu_tarihi}", "{randevu_saati}", "{calisan_adi}"],
  appointment_reminder: ["{musteri_adi}", "{randevu_tarihi}", "{randevu_saati}", "{calisan_adi}"],
  appointment_cancelled: ["{musteri_adi}", "{randevu_tarihi}", "{randevu_saati}", "{calisan_adi}"],
};

export async function sha256(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value ?? "")));
  return [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

export function renderMessageTemplate(template, values, allowedTokens = null) {
  const source = String(template ?? "").trim();
  if (!source) return { ok: false, reason: "missing" };
  const tokens = [...new Set(source.match(/\{[^{}]+\}/g) ?? [])];
  const allowed = allowedTokens ?? Object.values(META_TEMPLATE_TOKENS).flat();
  const unknown = tokens.filter((token) => !allowed.includes(token));
  if (unknown.length) return { ok: false, reason: "invalid", unknown };
  let content = source;
  for (const token of tokens) {
    const value = values?.[token];
    if (value === undefined || value === null || String(value).trim() === "") return { ok: false, reason: "unresolved", token };
    content = content.split(token).join(String(value));
  }
  return { ok: true, content, tokens };
}

export function metaTemplatePayload({ to, name, languageCode = "tr", parameterTokens = [], values }) {
  const parameters = parameterTokens.map((token) => ({ type: "text", text: String(values?.[token] ?? "") }));
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name,
      language: { code: languageCode || "tr" },
      components: parameters.length ? [{ type: "body", parameters }] : [],
    },
  };
}

export async function postMetaMessage(payload, env = Deno.env, timeoutMs = 10_000) {
  const accessToken = env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
  const phoneNumberId = env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
  const graphVersion = env.get("WHATSAPP_GRAPH_API_VERSION") ?? "";
  if (!accessToken || !phoneNumberId || !graphVersion) return { ok: false, kind: "configuration", error: "missing_meta_configuration" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(graphVersion)}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, kind: response.status >= 500 ? "retryable" : "rejected", httpStatus: response.status, body };
    return { ok: true, httpStatus: response.status, body, providerMessageId: body?.messages?.[0]?.id ?? null };
  } catch (error) {
    return { ok: false, kind: "unknown", error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
