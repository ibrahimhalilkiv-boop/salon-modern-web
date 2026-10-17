import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store" };
const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: jsonHeaders });
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const nextDay = (day: string) => new Date(Date.parse(day + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
const dateRange = (day: string) => ({ start: day + "T00:00:00+03:00", end: nextDay(day) + "T00:00:00+03:00" });

type Message = { role: "user" | "assistant"; content: string };
type ToolName = "none" | "daily_summary" | "appointments" | "alerts";
const system = `Sen MORİ'sin, Salon Modern'in yapay zekâ asistanısın. Türkçe, doğal ve kısa konuş. Kullanıcının önceki mesajlarını bağlam olarak kullan. İşletme verisi gerektiğinde yalnızca daily_summary, appointments veya alerts araçlarından birini seç. Araç sonuçları güvenilir sayısal verilerdir; sonuçta olmayan müşteri adı, telefon, kasa tutarı veya randevu ayrıntısı uydurma. Hiçbir değişiklik yapma veya WhatsApp gönderme. Yanıtını yalnızca şu JSON biçiminde ver: {"tool":"none|daily_summary|appointments|alerts","answer":"Türkçe yanıt"}. Bir veri sorusu için tool seç, answer alanını araç sonucu gelene kadar boş bırak. Genel sohbet ve açıklamalar için tool none seç.`;

async function model(messages: Message[], instruction: string): Promise<string> {
  const provider = Deno.env.get("SALON_AI_PROVIDER") || "cloudflare";
  const body = { messages: [{ role: "system", content: instruction }, ...messages], max_completion_tokens: 650, temperature: 0.45, store: false };
  let url: string, headers: Record<string, string>;
  if (provider === "cloudflare") {
    const account = Deno.env.get("CLOUDFLARE_ACCOUNT_ID"), key = Deno.env.get("CLOUDFLARE_API_TOKEN");
    if (!account || !key) throw new Error("AI yapılandırılmadı.");
    url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${Deno.env.get("SALON_AI_MODEL") || "@cf/zai-org/glm-4.7-flash"}`;
    headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  } else if (provider === "openai_compatible" && Deno.env.get("SALON_AI_ALLOW_PAID") === "true") {
    url = Deno.env.get("SALON_AI_ENDPOINT") || "";
    const key = Deno.env.get("SALON_AI_API_KEY"), name = Deno.env.get("SALON_AI_MODEL");
    if (!/^https:\/\//.test(url) || !key || !name) throw new Error("AI yapılandırılmadı.");
    headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    (body as Record<string, unknown>).model = name;
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
  const { data: profile } = await admin.from("profiles").select("role,active").eq("id", user.id).maybeSingle();
  if (!profile?.active || !["manager", "employee"].includes(profile.role)) return respond({ error: "Erişim izni yok." }, 403);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return respond({ error: "Geçersiz istek." }, 400); }
  const action = body.action;
  if (action === "history") {
    const { data, error } = await admin.from("salon_ai_messages").select("session_id,role,content,created_at")
      .eq("user_id", user.id).gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()).order("created_at", { ascending: false }).limit(160);
    return error ? respond({ error: "Geçmiş yüklenemedi." }, 500) : respond({ messages: (data || []).reverse() });
  }
  if (action === "clear" && uuid(body.session_id)) {
    const { error } = await admin.from("salon_ai_messages").delete().eq("user_id", user.id).eq("session_id", body.session_id);
    return error ? respond({ error: "Sohbet silinemedi." }, 500) : respond({ ok: true });
  }
  if (action !== "send" || !uuid(body.session_id) || typeof body.message !== "string" || body.message.trim().length < 1 || body.message.length > 1200) return respond({ error: "Mesajı kontrol edin." }, 400);
  const sessionId = body.session_id, question = body.message.trim();
  const { data: previous, error: previousError } = await admin.from("salon_ai_messages").select("role,content").eq("user_id", user.id).eq("session_id", sessionId)
    .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()).order("created_at", { ascending: false }).limit(12);
  if (previousError) return respond({ error: "Sohbet yüklenemedi." }, 500);
  const messages = [...(previous || []).reverse(), { role: "user", content: question }] as Message[];
  try {
    const raw = await model(messages, system);
    let parsed: { tool?: ToolName; answer?: string } = {};
    try { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { parsed.answer = raw; }
    const allowed: ToolName[] = ["daily_summary", "appointments", "alerts"];
    const tool = allowed.includes(parsed.tool as ToolName) ? parsed.tool as ToolName : "none";
    let answer = String(parsed.answer || "").slice(0, 2500);
    if (tool !== "none") {
      const result = await readTool(tool, admin, user.id, profile.role === "manager");
      answer = await model([...messages, { role: "assistant", content: `Salt okunur ${tool} araç sonucu: ${JSON.stringify(result)}` }],
        "Sen MORİ'sin, Salon Modern'in yapay zekâ asistanısın. Araç sonucuna dayanarak kullanıcının sorusunu doğal Türkçeyle yanıtla. Yalnızca araç sonucundaki bilgileri kullan. Müşteri adı, telefon veya kasa tutarı uydurma. Düz metin yanıt ver, JSON kullanma.");
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
