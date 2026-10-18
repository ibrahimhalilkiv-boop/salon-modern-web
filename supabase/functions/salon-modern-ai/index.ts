import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { handlePhase2 } from "./phase2.ts";

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store" };
const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: jsonHeaders });
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const nextDay = (day: string) => new Date(Date.parse(day + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
const dateRange = (day: string) => ({ start: day + "T00:00:00+03:00", end: nextDay(day) + "T00:00:00+03:00" });

type Message = { role: "user" | "assistant"; content: string };
type ToolName = "none" | "daily_summary" | "appointments" | "alerts";
const system = `Sen MORİ'sin, Salon Modern'in yapay zekâ asistanısın. Türkçe, doğal ve kısa konuş. Kullanıcının önceki mesajlarını bağlam olarak kullan; araç seçerken en son kullanıcının ne sorduğunu esas al, önceki konunun yanıtını tekrarlama. İşletme verisi gerektiğinde yalnızca daily_summary, appointments veya alerts araçlarından birini seç. Randevu adedi ve saatleri için appointments; geliş zamanı gelen, geciken veya riskli müşteri sayıları için alerts; genel günlük işletme özeti veya randevu ve uyarıların birlikte sorulduğu durumlar için daily_summary seç. Araç sonuçları güvenilir sayısal verilerdir; sonuçta olmayan müşteri adı, telefon, kasa tutarı veya randevu ayrıntısı uydurma. Hiçbir değişiklik yapma veya WhatsApp gönderme. Yanıtını yalnızca şu JSON biçiminde ver: {"tool":"none|daily_summary|appointments|alerts","answer":"Türkçe yanıt"}. Bir veri sorusu için tool seç, answer alanını araç sonucu gelene kadar boş bırak. Genel sohbet ve açıklamalar için tool none seç.`;

const privateText = (value: string) => value
  .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[e-posta]")
  .replace(/(?:\+?90\s?)?(?:\(?0?5\d{2}\)?[\s.-]?)\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/g, "[telefon]");

async function model(messages: Message[], instruction: string, json = false): Promise<string> {
  const provider = Deno.env.get("SALON_AI_PROVIDER") || "cloudflare";
  const body: Record<string, unknown> = { messages: [{ role: "system", content: instruction }, ...messages.map((message) => ({ ...message, content: privateText(message.content) }))], max_completion_tokens: 650, temperature: 0.45 };
  let url: string, headers: Record<string, string>;
  if (provider === "cloudflare") {
    const account = Deno.env.get("CLOUDFLARE_ACCOUNT_ID"), key = Deno.env.get("CLOUDFLARE_API_TOKEN");
    if (!account || !key) throw new Error("AI yapılandırılmadı.");
    url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${Deno.env.get("SALON_AI_MODEL") || "@cf/zai-org/glm-4.7-flash"}`;
    headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    body.store = false;
  } else if (provider === "groq_free") {
    const key = Deno.env.get("GROQ_API_KEY");
    if (!key) throw new Error("AI yapılandırılmadı.");
    url = "https://api.groq.com/openai/v1/chat/completions";
    headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    body.model = "openai/gpt-oss-120b";
    body.reasoning_effort = "low";
    body.reasoning_format = "hidden";
    if (json) body.response_format = { type: "json_object" };
  } else if (provider === "openai_compatible" && Deno.env.get("SALON_AI_ALLOW_PAID") === "true") {
    url = Deno.env.get("SALON_AI_ENDPOINT") || "";
    const key = Deno.env.get("SALON_AI_API_KEY"), name = Deno.env.get("SALON_AI_MODEL");
    if (!/^https:\/\//.test(url) || !key || !name) throw new Error("AI yapılandırılmadı.");
    headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    body.model = name;
    body.store = false;
  } else throw new Error("AI sağlayıcısı etkin değil.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    if (!response.ok) throw new Error("AI şu anda yanıt veremiyor.");
    const data = await response.json();
    const value = data?.result?.response ?? data?.result?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.message?.content;
    if (typeof value !== "string" || !value.trim()) throw new Error("AI boş yanıt verdi.");
    return value.trim();
  } finally { clearTimeout(timeout); }
}

async function readTool(name: ToolName, admin: ReturnType<typeof createClient<any, "public", any>>, userId: string, manager: boolean) {
  const day = today(), range = dateRange(day);
  if (name === "appointments" || name === "daily_summary") {
    let query = admin.from("appointments").select("scheduled_at,employee_id,status,service_name")
      .gte("scheduled_at", range.start).lt("scheduled_at", range.end).neq("status", "cancelled");
    if (!manager) query = query.eq("employee_id", userId);
    const { data, error } = await query.limit(500);
    if (error) throw new Error("Randevu özeti alınamadı.");
    const rows = data || [];
    const appointments = { date: day, scope: manager ? "salon" : "kendi randevuları", count: rows.length,
      planned: rows.filter((row) => row.status !== "completed" && row.status !== "tamamlandi").length,
      completed: rows.filter((row) => row.status === "completed" || row.status === "tamamlandi").length,
      times: rows.slice(0, 20).map((row) => new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(new Date(String(row.scheduled_at)))) };
    if (name === "appointments") return appointments;
    return { ...appointments, alerts: manager ? await alertCounts(admin) : null };
  }
  if (name === "alerts") return manager ? await alertCounts(admin) : { error: "Uyarı toplamları yalnızca yöneticiye açıktır." };
  return null;
}

async function alertCounts(admin: ReturnType<typeof createClient<any, "public", any>>) {
  const { data, error } = await admin.from("client_visit_intelligence").select("last_visit_date,average_visit_days,distinct_visit_days").limit(5000);
  if (error) throw new Error("Uyarılar alınamadı.");
  const now = Date.parse(today() + "T12:00:00Z");
  const counts = { due: 0, overdue: 0, risk: 0 };
  for (const row of data || []) {
    if (!row.last_visit_date || Number(row.distinct_visit_days) < 3 || !Number(row.average_visit_days)) continue;
    const ratio = Math.max(0, Math.round((now - Date.parse(row.last_visit_date + "T12:00:00Z")) / 86400000)) / Number(row.average_visit_days);
    if (ratio >= 1.75) counts.risk++;
    else if (ratio >= 1.25) counts.overdue++;
    else if (ratio >= 1) counts.due++;
  }
  return counts;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: jsonHeaders });
  if (req.method !== "POST") return respond({ error: "Yöntem desteklenmiyor." }, 405);
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return respond({ error: "Oturum gerekli." }, 401);
  const url = Deno.env.get("SUPABASE_URL") || "";
  const publishable = Deno.env.get("SUPABASE_ANON_KEY") || JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}").default || "";
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || "";
  const caller = createClient(url, publishable, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authError } = await caller.auth.getUser(auth.slice(7));
  if (authError || !user) return respond({ error: "Oturum süresi doldu." }, 401);
  const { data: profile } = await admin.from("profiles").select("role,active,full_name,commission_pct").eq("id", user.id).maybeSingle();
  if (!profile?.active || !["manager", "employee"].includes(profile.role)) return respond({ error: "Erişim izni yok." }, 403);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return respond({ error: "Geçersiz istek." }, 400); }
  const action = body.action;
  if (action === "follow_settings") {
    const { data, error } = await admin.from("mori_follow_settings")
      .select("enabled,categories,digest_time,quiet_start,quiet_end")
      .eq("user_id", user.id).maybeSingle();
    if (error) return respond({ error: "Takip ayarları alınamadı." }, 500);
    return respond({ settings: data || { enabled: profile.role === "manager",
      categories: profile.role === "manager" ? ["calendar","booking","debt","delivery","performance","cash","customers","daily"] : ["calendar"],
      digest_time: "09:00", quiet_start: "22:00", quiet_end: "08:00" } });
  }
  if (action === "save_follow_settings") {
    const allowed = profile.role === "manager"
      ? ["calendar","booking","debt","delivery","performance","cash","customers","daily"] : ["calendar"];
    const categories = body.categories;
    const clock = (value: unknown) => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    if (typeof body.enabled !== "boolean" || !Array.isArray(categories) ||
      !categories.every((v) => typeof v === "string" && allowed.includes(v)) ||
      !clock(body.quiet_start) || !clock(body.quiet_end) ||
      (profile.role === "manager" && !clock(body.digest_time)))
      return respond({ error: "Takip ayarlarını kontrol edin." }, 400);
    const { data: old } = await admin.from("mori_follow_settings").select("digest_time")
      .eq("user_id", user.id).maybeSingle();
    const values = { user_id: user.id, enabled: body.enabled,
      categories: [...new Set(categories)], quiet_start: body.quiet_start,
      quiet_end: body.quiet_end,
      digest_time: profile.role === "manager" ? body.digest_time : old?.digest_time || "09:00",
      updated_at: new Date().toISOString() };
    const { error } = await admin.from("mori_follow_settings").upsert(values);
    return error ? respond({ error: "Takip ayarları kaydedilemedi." }, 500) : respond({ ok: true });
  }
  if (action === "proactive_alerts") {
    const [{ data: events, error }, { data: digests, error: digestError }] = await Promise.all([
      admin.from("mori_events").select("id,category,severity,title,detail,route,context,state,read_at,resolved_at,first_seen_at,last_seen_at,notification_id")
        .eq("recipient_id", user.id).gte("first_seen_at", new Date(Date.now() - 90 * 86400000).toISOString())
        .order("last_seen_at", { ascending: false }).limit(100),
      admin.from("mori_daily_summaries").select("business_date,facts,created_at")
        .eq("recipient_id", user.id).order("business_date", { ascending: false }).limit(7),
    ]);
    return error || digestError ? respond({ error: "MORİ uyarıları alınamadı." }, 500)
      : respond({ events: events || [], digests: digests || [] });
  }
  if (action === "read_proactive_alert" && uuid(body.event_id)) {
    const { data, error } = await admin.from("mori_events").update({ read_at: new Date().toISOString() })
      .eq("id", body.event_id).eq("recipient_id", user.id).is("read_at", null).select("id").maybeSingle();
    if (error) return respond({ error: "Uyarı güncellenemedi." }, 500);
    if (!data) {
      const { data: existing } = await admin.from("mori_events").select("id")
        .eq("id", body.event_id).eq("recipient_id", user.id).maybeSingle();
      if (!existing) return respond({ error: "Uyarı bulunamadı." }, 404);
    }
    return respond({ ok: true });
  }
  if (action === "summary") {
    try { return respond({ summary: await readTool("daily_summary", admin, user.id, profile.role === "manager") }); }
    catch { return respond({ error: "Günlük özet alınamadı." }, 503); }
  }
  if (action === "history") {
    const { data, error } = await admin.from("salon_ai_messages").select("session_id,role,content,created_at")
      .eq("user_id", user.id).gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()).order("created_at", { ascending: false }).limit(160);
    return error ? respond({ error: "Geçmiş yüklenemedi." }, 500) : respond({ messages: (data || []).reverse() });
  }
  if (action === "clear" && uuid(body.session_id)) {
    const { error } = await admin.from("salon_ai_messages").delete().eq("user_id", user.id).eq("session_id", body.session_id);
    return error ? respond({ error: "Sohbet silinemedi." }, 500) : respond({ ok: true });
  }
  if (action === "send" || action === "confirm") {
    if (action === "send") {
      const { data: claimed, error: quotaError } = await admin.rpc("mori_claim_ai_call", { p_user: user.id });
      if (quotaError) return respond({ error: "AI kullanım sınırı kontrol edilemedi." }, 503);
      if (!claimed) return respond({ error: "Bugünkü ücretsiz MORİ sohbet sınırına ulaşıldı." }, 429);
    }
    try { return respond(await handlePhase2(body, admin, caller, { id: user.id, role: profile.role, full_name: profile.full_name, commission_pct: Number(profile.commission_pct || 0) }, model)); }
    catch (error) { return respond({ error: error instanceof Error ? error.message : "MORİ yanıt veremiyor." }, 503); }
  }
  if (action !== "send" || !uuid(body.session_id) || typeof body.message !== "string" || body.message.trim().length < 1 || body.message.length > 1200) return respond({ error: "Mesajı kontrol edin." }, 400);
  const sessionId = body.session_id, question = body.message.trim();
  const { data: previous, error: previousError } = await admin.from("salon_ai_messages").select("role,content").eq("user_id", user.id).eq("session_id", sessionId)
    .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()).order("created_at", { ascending: false }).limit(12);
  if (previousError) return respond({ error: "Sohbet yüklenemedi." }, 500);
  const messages = [...(previous || []).reverse(), { role: "user", content: question }] as Message[];
  try {
    const raw = await model(messages, system, true);
    let parsed: { tool?: ToolName; answer?: string } = {};
    try { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { parsed.answer = raw; }
    const allowed: ToolName[] = ["daily_summary", "appointments", "alerts"];
    const tool = allowed.includes(parsed.tool as ToolName) ? parsed.tool as ToolName : "none";
    let answer = String(parsed.answer || "").slice(0, 2500);
    if (tool !== "none") {
      const result = await readTool(tool, admin, user.id, profile.role === "manager");
      answer = await model([...messages, { role: "assistant", content: `Salt okunur ${tool} araç sonucu: ${JSON.stringify(result)}` }],
        "Sen MORİ'sin, Salon Modern'in yapay zekâ asistanısın. Araç sonucuna dayanarak kullanıcının son sorusunu doğal Türkçeyle yanıtla. Yalnızca araç sonucundaki bilgileri kullan. Kullanıcı hem randevu hem uyarı özeti istediyse ikisinin sayılarını da belirt. Uyarılardaki geciken, beklenen tekrar ziyaret süresini aşan müşteridir; kaçırılmış randevu anlamına gelmez. Müşteri adı, telefon veya kasa tutarı uydurma. Markdown kullanmadan düz metin yanıt ver, JSON kullanma.");
    }
    if (!answer) throw new Error("AI boş yanıt verdi.");
    const { error: saveError } = await admin.from("salon_ai_messages").insert([
      { user_id: user.id, session_id: sessionId, role: "user", content: question },
      { user_id: user.id, session_id: sessionId, role: "assistant", content: answer.slice(0, 4000) },
    ]);
    if (saveError) throw new Error("Sohbet kaydedilemedi.");
    return respond({ answer, session_id: sessionId });
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : "AI şu anda erişilemiyor." }, 503);
  }
});
