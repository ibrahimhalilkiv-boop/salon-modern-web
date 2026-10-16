import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  postYCloudMessage, verifyYCloudSignature, ycloudDeliveryFresh,
  ycloudStatusTransition, ycloudTemplateApproved, ycloudTemplatePayload,
  YCLOUD_APPOINTMENT_BODIES, YCLOUD_APPOINTMENT_PARAMETERS,
  YCLOUD_APPOINTMENT_TEMPLATES, YCLOUD_REMINDER_URL, ycloudExpectedMessage,
} from "../supabase/functions/_shared/ycloud-whatsapp.mjs";

globalThis.crypto ??= webcrypto;
const env = new Map([["YCLOUD_API_KEY", "fixture-secret"], ["YCLOUD_WABA_ID", "1044769215039170"], ["YCLOUD_PHONE_NUMBER", "+905355038544"]]);
const tokens = YCLOUD_APPOINTMENT_PARAMETERS.appointment_update;
const values = { "{musteri_adi}": "Çağrı 👋", "{randevu_tarihi}": "15 Ekim 2026", "{randevu_saati}": "14:30", "{calisan_adi}": "Şefik", "{islem_adi}": "Saç kesimi" };
const templates = Object.values(YCLOUD_APPOINTMENT_TEMPLATES);

test("four approved Turkish utility templates preserve their own body, variable order and static URL button", async () => {
  for (const [key, name] of Object.entries(YCLOUD_APPOINTMENT_TEMPLATES)) {
    const parameterTokens = YCLOUD_APPOINTMENT_PARAMETERS[key];
    const button = key === "appointment_reminder" ? [{ type: "URL", text: "Yol Tarifi", url: YCLOUD_REMINDER_URL }] : [];
    const expectedButtons = button.map(({ type, text, url }) => ({ type, texts: [text], url }));
    const calls = [];
    const fetcher = async (url, options) => {
      calls.push({ url, options });
      if (options.method !== "POST") return Response.json({ wabaId: env.get("YCLOUD_WABA_ID"), name, language: "tr", category: "UTILITY", status: "APPROVED", components: [{ type: "BODY", text: YCLOUD_APPOINTMENT_BODIES[key] }, ...(button.length ? [{ type: "BUTTONS", buttons: button }] : [])] });
      const payload = JSON.parse(options.body);
      return Response.json({ id: `id-${name}`, externalId: payload.externalId, wabaId: env.get("YCLOUD_WABA_ID"), from: env.get("YCLOUD_PHONE_NUMBER"), status: "accepted" });
    };
    const approval = await ycloudTemplateApproved(name, "tr", parameterTokens.length, ycloudExpectedMessage(key, values), parameterTokens, values, env, fetcher, expectedButtons);
    assert.equal(approval.ok, true);
    const payload = ycloudTemplatePayload({ from: approval.from, to: "905321234567", name, parameterTokens, values, externalId: `appointment_${name}` });
    const result = await postYCloudMessage(payload, env, fetcher);
    assert.deepEqual(result, { ok: true, providerMessageId: `id-${name}`, providerStatus: "accepted" });
    assert.equal(payload.to, "+905321234567");
    assert.deepEqual(payload.template.components[0].parameters.map((item) => item.text), parameterTokens.map((token) => values[token]));
    assert.equal(payload.template.components.length, 1, "Static URL button needs no dynamic API parameter");
    assert.equal(parameterTokens.length, key === "appointment_confirmation" ? 5 : 4);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.headers["X-API-Key"], "fixture-secret");
    assert.equal(calls[1].url, "https://api.ycloud.com/v2/whatsapp/messages");
  }
});

test("wrong WABA, pending templates, and missing key cannot send", async () => {
  for (const change of [{ status: "PENDING" }, { wabaId: "other" }, { language: "en" }, { category: "MARKETING" }]) {
    const result = await ycloudTemplateApproved(templates[0], "tr", 4, null, tokens, values, env, async () => Response.json({ wabaId: env.get("YCLOUD_WABA_ID"), name: templates[0], language: "tr", category: "UTILITY", status: "APPROVED", components: [{ type: "BODY", text: "{{1}} {{2}} {{3}} {{4}}" }], ...change }));
    assert.equal(result.ok, false);
  }
  assert.equal((await ycloudTemplateApproved(templates[0], "tr", 4, null, tokens, values, new Map(), () => { throw Error("must not call"); })).ok, false);
  assert.equal((await ycloudTemplateApproved(templates[0], "tr", 4, "different content", tokens, values, env, async () => Response.json({ wabaId: env.get("YCLOUD_WABA_ID"), name: templates[0], language: "tr", category: "UTILITY", status: "APPROVED", components: [{ type: "BODY", text: "{{1}} {{2}} {{3}} {{4}}" }] }))).reason, "template_content_mismatch");
  assert.equal((await ycloudTemplateApproved(templates[2], "tr", 4, ycloudExpectedMessage("appointment_reminder", values), tokens, values, env, async () => Response.json({ wabaId: env.get("YCLOUD_WABA_ID"), name: templates[2], language: "tr", category: "UTILITY", status: "APPROVED", components: [{ type: "BODY", text: YCLOUD_APPOINTMENT_BODIES.appointment_reminder }] }), [{ type: "URL", url: YCLOUD_REMINDER_URL, texts: ["Yol Tarifi"] }])).reason, "template_button_mismatch");
  assert.equal((await ycloudTemplateApproved(templates[0], "tr", 4, null, tokens, values, env, async () => new Response("{}", { status: 503 }))).retryable, true);
});

test("HTTP errors and uncertain outcomes are classified without duplicate-prone retries", async () => {
  const payload = ycloudTemplatePayload({ from: env.get("YCLOUD_PHONE_NUMBER"), to: "905321234567", name: templates[0], parameterTokens: tokens, values, externalId: "appointment_test" });
  for (const [code, kind] of [[400, "rejected"], [401, "rejected"], [429, "retryable"], [500, "unknown"]]) {
    assert.equal((await postYCloudMessage(payload, env, async () => new Response("{}", { status: code }))).kind, kind);
  }
  assert.equal((await postYCloudMessage(payload, env, async () => { throw Error("timeout"); })).kind, "unknown");
  assert.equal((await postYCloudMessage(payload, env, async () => Response.json({ id: "x", wabaId: "wrong", from: payload.from, externalId: payload.externalId }))).kind, "unknown");
});

test("signed webhook rejects tampering and replay; statuses advance once", async () => {
  const raw = JSON.stringify({ type: "whatsapp.message.updated", whatsappMessage: { id: "msg", status: "delivered" } });
  const timestamp = Math.floor(Date.now() / 1000);
  const secret = "fixture-signing-secret";
  const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  const header = `t=${timestamp},s=${signature}`;
  assert.equal(await verifyYCloudSignature(header, raw, secret), true);
  assert.equal(await verifyYCloudSignature(header, `${raw}x`, secret), false);
  assert.equal(await verifyYCloudSignature(header, raw, secret, Date.now() + 6 * 60_000), false);
  assert.equal(ycloudStatusTransition("sent", "delivered"), "delivered");
  assert.equal(ycloudStatusTransition("delivered", "sent"), null);
  assert.equal(ycloudStatusTransition("delivered", "delivered"), null);
  assert.equal(ycloudStatusTransition("read", "failed"), null);
  assert.equal(ycloudStatusTransition("sent", "failed"), "failed");
});

test("old, cancelled and late reminder deliveries remain blocked", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const appointment = { status: "confirmed", scheduled_at: "2026-10-15T12:30:00Z" };
  assert.equal(ycloudDeliveryFresh({ template_key: "appointment_confirmation", scheduled_for: "2026-10-15T11:31:00Z" }, appointment, 30, now), true);
  assert.equal(ycloudDeliveryFresh({ template_key: "appointment_confirmation", scheduled_for: "2026-10-15T11:29:00Z" }, appointment, 30, now), false);
  assert.equal(ycloudDeliveryFresh({ template_key: "appointment_reminder", scheduled_for: "2026-10-15T11:31:00Z" }, appointment, 30, now), true);
  assert.equal(ycloudDeliveryFresh({ template_key: "appointment_reminder", scheduled_for: "2026-10-15T11:29:00Z" }, appointment, 30, now), false);
  assert.equal(ycloudDeliveryFresh({ template_key: "appointment_reminder", scheduled_for: "2026-10-15T11:31:00Z" }, { ...appointment, status: "cancelled" }, 30, now), false);
});

test("dispatcher keeps Meta default, idempotent claim and manual cancellation fallback", () => {
  const edge = readFileSync("supabase/functions/whatsapp-outbound-dispatch/index.ts", "utf8");
  const sql = readFileSync("supabase/migrations/20261008213000_manual_appointment_cancellation_whatsapp.sql", "utf8");
  assert.match(edge, /WHATSAPP_PROVIDER"\) \?\? "meta"/);
  assert.match(edge, /YCLOUD_ACCOUNT_READY/);
  assert.match(edge, /whatsapp_claim_message_logs/);
  assert.match(sql, /'manual_pending'/);
});
