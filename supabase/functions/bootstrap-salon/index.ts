import { createClient } from "npm:@supabase/supabase-js@2";

const setupKey = "8437375154bf457f39017528131799d3cc88137678690d77626eab3e10dfd9fc";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function adminClient() {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    ?? JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const expected = [
  { username: "halil.kiv", full_name: "Halil Kıv", role: "manager", commission_pct: 40 },
  { username: "mehmet.safakoglu", full_name: "Mehmet Şafakoğlu", role: "manager", commission_pct: 40 },
  { username: "cengiz.bavkir", full_name: "Cengiz Bavkır", role: "employee", commission_pct: 35 },
  { username: "talip.kose", full_name: "Talip Köse", role: "employee", commission_pct: 35 },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const admin = adminClient();
  const { count, error: countError } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true });
  if (countError) return respond({ error: "Kurulum durumu okunamadı." }, 500);

  if (req.method === "GET") return respond({ initialized: (count ?? 0) > 0 });
  if (req.method !== "POST") return respond({ error: "Yöntem desteklenmiyor." }, 405);

  let payload: { setup_key?: string; accounts?: Array<{ username?: string; password?: string }> };
  try { payload = await req.json(); } catch { return respond({ error: "Geçersiz istek." }, 400); }

  if (payload.setup_key !== setupKey) return respond({ error: "Kurulum anahtarı geçersiz." }, 401);
  if ((count ?? 0) > 0) return respond({ error: "Kurulum zaten tamamlandı." }, 409);
  if (!Array.isArray(payload.accounts) || payload.accounts.length !== expected.length) {
    return respond({ error: "Dört hesap için şifre girilmelidir." }, 400);
  }

  const supplied = new Map(payload.accounts.map((account) => [String(account.username ?? "").trim().toLowerCase(), String(account.password ?? "")]));
  const passwords = expected.map((person) => supplied.get(person.username) ?? "");
  if (passwords.some((password) => password.length < 8) || new Set(passwords).size !== passwords.length) {
    return respond({ error: "Her şifre en az 8 karakter ve birbirinden farklı olmalıdır." }, 400);
  }

  const createdIds: string[] = [];
  try {
    for (const person of expected) {
      const { data, error } = await admin.auth.admin.createUser({
        email: person.username + "@salon-modern.local",
        password: supplied.get(person.username)!,
        email_confirm: true,
        user_metadata: { username: person.username, full_name: person.full_name },
      });
      if (error || !data.user) throw error ?? new Error("Kullanıcı oluşturulamadı.");
      createdIds.push(data.user.id);

      const { error: profileError } = await admin.from("profiles").update({
        role: person.role,
        commission_pct: person.commission_pct,
        active: true,
      }).eq("id", data.user.id);
      if (profileError) throw profileError;
    }
  } catch (error) {
    await Promise.all(createdIds.map((id) => admin.auth.admin.deleteUser(id)));
    return respond({ error: error instanceof Error ? error.message : "Kurulum tamamlanamadı." }, 500);
  }

  return respond({ ok: true, users: expected.map(({ username }) => username) }, 201);
});
