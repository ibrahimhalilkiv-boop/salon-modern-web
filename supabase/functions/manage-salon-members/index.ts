import { createClient } from "npm:@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const reply = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers });
const normalizeUsername = (value: unknown) => {
  const username = String(value ?? "").trim().toLocaleLowerCase("tr-TR")
    .replace(/[Ã§Ã‡]/g, "c").replace(/[ÄŸÄ]/g, "g").replace(/[Ä±Ä°]/g, "i")
    .replace(/[Ã¶Ã–]/g, "o").replace(/[ÅŸÅ]/g, "s").replace(/[Ã¼Ãœ]/g, "u")
    .replace(/\s+/g, ".").replace(/[^a-z0-9._-]/g, "").replace(/\.{2,}/g, ".");
  return /^[a-z0-9._-]{3,40}$/.test(username) ? username : null;
};
const validRole = (value: unknown) => value === "manager" || value === "employee" ? value : null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "YÃ¶ntem desteklenmiyor." }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) return reply({ error: "Oturum sÃ¼resi dolmuÅŸ. Yeniden giriÅŸ yapÄ±n." }, 401);
  const { data: manager } = await admin.from("profiles").select("id,role,active").eq("id", authData.user.id).maybeSingle();
  if (!manager || manager.role !== "manager" || !manager.active) return reply({ error: "Bu iÅŸlem iÃ§in yÃ¶netici yetkisi gerekir." }, 403);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: "GeÃ§ersiz istek." }, 400); }

  if (body.action === "create") {
    const username = normalizeUsername(body.username);
    const fullName = String(body.full_name ?? "").trim();
    const password = String(body.password ?? "");
    const role = validRole(body.role);
    const commission = Number(body.commission_pct ?? 0);
    if (!username || fullName.length < 2 || fullName.length > 100 || password.length < 8 || !role || commission < 0 || commission > 100) {
      return reply({ error: "Ad, kullanÄ±cÄ± adÄ± ve en az 8 karakterlik ÅŸifreyi kontrol edin." }, 400);
    }
    const { data: existing } = await admin.from("profiles").select("id,active").eq("username", username).maybeSingle();
    if (existing?.active) return reply({ error: "Bu kullanÄ±cÄ± adÄ± zaten aktif bir Ã§alÄ±ÅŸana ait." }, 409);
    if (existing && !existing.active) {
      const authUpdate = await admin.auth.admin.updateUserById(existing.id, {
        password, email_confirm: true, user_metadata: { username, full_name: fullName },
      });
      if (authUpdate.error) return reply({ error: "Eski Ã§alÄ±ÅŸan hesabÄ± yeniden aÃ§Ä±lamadÄ±." }, 400);
      const restored = await admin.from("profiles").update({ full_name: fullName, role, commission_pct: commission, active: true })
        .eq("id", existing.id).select("id,username,full_name,role,commission_pct,active").single();
      if (restored.error) return reply({ error: "Ã‡alÄ±ÅŸan profili yeniden etkinleÅŸtirilemedi." }, 400);
      return reply({ member: restored.data, restored: true });
    }
    const created = await admin.auth.admin.createUser({
      email: `${username}@salon-modern.local`, password, email_confirm: true,
      user_metadata: { username, full_name: fullName },
    });
    if (created.error || !created.data.user) {
      const duplicate = created.error?.message?.toLowerCase().includes("already");
      return reply({ error: duplicate ? "Bu kullanÄ±cÄ± adÄ± daha Ã¶nce kullanÄ±lmÄ±ÅŸ. FarklÄ± bir kullanÄ±cÄ± adÄ± seÃ§in." : created.error?.message ?? "Ã‡alÄ±ÅŸan hesabÄ± oluÅŸturulamadÄ±." }, 400);
    }
    const member = await admin.from("profiles").update({ role, commission_pct: commission, active: true })
      .eq("id", created.data.user.id).select("id,username,full_name,role,commission_pct,active").single();
    if (member.error) {
      await admin.auth.admin.deleteUser(created.data.user.id);
      return reply({ error: "Ã‡alÄ±ÅŸan profili kaydedilemedi." }, 500);
    }
    return reply({ member: member.data }, 201);
  }

  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return reply({ error: "GeÃ§ersiz kullanÄ±cÄ±." }, 400);
  const { data: target } = await admin.from("profiles").select("id,role,active").eq("id", id).maybeSingle();
  if (!target) return reply({ error: "KullanÄ±cÄ± bulunamadÄ±." }, 404);
  if (body.action === "update") {
    const fullName = String(body.full_name ?? "").trim(), role = validRole(body.role);
    const commission = Number(body.commission_pct), active = Boolean(body.active), password = String(body.password ?? "");
    if (fullName.length < 2 || !role || !Number.isFinite(commission) || commission < 0 || commission > 100 || (password && password.length < 8)) return reply({ error: "GÃ¼ncelleme bilgilerini kontrol edin." }, 400);
    const updated = await admin.from("profiles").update({ full_name: fullName, role, commission_pct: commission, active })
      .eq("id", id).select("id,username,full_name,role,commission_pct,active").single();
    if (updated.error) return reply({ error: "KullanÄ±cÄ± gÃ¼ncellenemedi." }, 400);
    if (password) {
      const passwordResult = await admin.auth.admin.updateUserById(id, { password });
      if (passwordResult.error) return reply({ error: "Profil kaydedildi; ÅŸifre deÄŸiÅŸtirilemedi." }, 500);
    }
    return reply({ member: updated.data });
  }
  if (body.action === "deactivate") {
    if (id === authData.user.id) return reply({ error: "Kendi hesabÄ±nÄ±zÄ± pasifleÅŸtiremezsiniz." }, 400);
    if (target.role === "manager" && target.active) {
      const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "manager").eq("active", true).neq("id", id);
      if ((count ?? 0) === 0) return reply({ error: "Son aktif yÃ¶netici pasifleÅŸtirilemez." }, 400);
    }
    const result = await admin.from("profiles").update({ active: false }).eq("id", id);
    if (result.error) return reply({ error: "Ã‡alÄ±ÅŸan pasifleÅŸtirilemedi." }, 400);
    return reply({ ok: true });
  }
  return reply({ error: "Bilinmeyen iÅŸlem." }, 400);
});
