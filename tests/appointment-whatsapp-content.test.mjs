import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const js = readFileSync("whatsapp-messages-2.4.5.js", "utf8");
const migration = readFileSync("supabase/migrations/20261016074006_refresh_appointment_whatsapp_content.sql", "utf8");
const values = {
  "{musteri_adi}": "Çağrı Çığ",
  "{randevu_tarihi}": "20 Ekim 2026",
  "{randevu_saati}": "14:30",
  "{islem_adi}": "Saç kesimi",
  "{calisan_adi}": "Şefik",
  "{yol_tarifi_url}": "https://salonmodern.com.tr/konum",
};
const context = {
  whatsappTemplateConfig: { customer_return_reminder: { title: "Return", content: "Merhaba {musteri_adi}", allowed: [] } },
  salonMessageTemplates: {},
  appointmentTemplateValues: () => ({ ...values }),
  renderSavedTemplate(key, replacement) {
    return context.whatsappTemplateConfig[key].content.replace(/\{[^{}]+\}/g, (token) => replacement[token] ?? token);
  },
  whatsappPhone: () => "905321234567",
};
context.window = context;
vm.runInNewContext(js, context);

test("four manual WhatsApp drafts match stored text, preserve service and short directions", () => {
  const keys = ["appointment_confirmation", "appointment_update", "appointment_reminder", "appointment_cancelled"];
  for (const key of keys) {
    const row = migration.match(new RegExp("\\('" + key + "','[^']+',\\$message\\$([\\s\\S]*?)\\$message\\$\\)"));
    assert.ok(row, `Missing database message: ${key}`);
    const rendered = context.renderSavedTemplate(key, context.appointmentTemplateValues());
    const storedRendered = row[1].replace(/\r\n/g, '\n').replace(/\{[^{}]+\}/g, (token) => values[token] ?? token);
    assert.equal(rendered, storedRendered, `Frontend and database differ for ${key}`);
    assert.ok(rendered.includes("Çağrı Çığ"));
    assert.ok(rendered.includes("Şefik"));
    assert.doesNotMatch(rendered, /\uFFFD|\{[^{}]+\}/);
  }
  const confirmation = context.renderSavedTemplate("appointment_confirmation", context.appointmentTemplateValues());
  const reminder = context.renderSavedTemplate("appointment_reminder", context.appointmentTemplateValues());
  assert.match(confirmation, /✂️ Hizmet: Saç kesimi/);
  assert.doesNotMatch(confirmation, /maps\/dir|Yol Tarifi/);
  assert.match(reminder, /📍 Yol Tarifi: https:\/\/salonmodern\.com\.tr\/konum/);
  assert.doesNotMatch(reminder, /maps\/dir/);
  const url = new URL(context.whatsappAppointmentUrl("Çağrı Çığ", "05321234567", "2026-10-20", "14:30", "Şefik", 0, "Saç kesimi"));
  assert.equal(url.host, "wa.me");
  assert.match(url.searchParams.get("text"), /✂️ Hizmet: Saç kesimi/);
});
