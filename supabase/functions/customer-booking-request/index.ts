import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const allowedOrigins = new Set([
  'https://salonmodern.com.tr',
  'https://www.salonmodern.com.tr',
  'https://ibrahimhalilkiv-boop.github.io',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
])

function cors(req: Request) {
  const origin = req.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://salonmodern.com.tr',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json; charset=utf-8',
  }
}

function reply(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors(req) })
}

function phone(value: unknown) {
  let digits = String(value || '').replace(/\D/g, '')
  if (digits.startsWith('0090')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = `90${digits.slice(1)}`
  else if (digits.length === 10 && digits.startsWith('5')) digits = `90${digits}`
  return /^905\d{9}$/.test(digits) ? digits : ''
}

function clean(value: unknown, max = 500) {
  return String(value || '').trim().replace(/[<>]/g, '').slice(0, max)
}

async function sha256(value: string) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(raw)).map((n) => n.toString(16).padStart(2, '0')).join('')
}

function slotIso(date: string, time: string) {
  return `${date}T${time}:00+03:00`
}

function overlaps(start: number, end: number, otherStart: string, minutes: number) {
  const a = new Date(otherStart).getTime()
  return start < a + minutes * 60000 && end > a
}

async function manager(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const auth = await db.auth.getUser(token)
  if (auth.error || !auth.data.user) return null
  const profile = await db.from('profiles').select('id,full_name,role,active')
    .eq('id', auth.data.user.id).eq('active', true).eq('role', 'manager').maybeSingle()
  return profile.data || null
}

async function catalogue(req: Request) {
  const [services, profiles] = await Promise.all([
    db.from('services').select('id,name,price,duration_minutes').eq('active', true).order('name'),
    db.from('profiles').select('id,full_name').eq('active', true).order('full_name'),
  ])
  if (services.error || profiles.error) throw services.error || profiles.error
  return reply(req, { services: services.data, employees: profiles.data })
}

async function availability(req: Request, url: URL) {
  const date = url.searchParams.get('date') || ''
  const serviceId = url.searchParams.get('service') || ''
  const requestedEmployeeId = url.searchParams.get('employee') || ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !serviceId) return reply(req, { error: 'Tarih ve hizmet gerekli.' }, 400)
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date())
  if (date < today) return reply(req, { error: 'Geçmiş tarih seçilemez.' }, 400)

  const service = await db.from('services').select('id,duration_minutes').eq('id', serviceId).eq('active', true).maybeSingle()
  if (service.error || !service.data) return reply(req, { error: 'Hizmet bulunamadı.' }, 404)
  let employeeQuery = db.from('profiles').select('id,full_name').eq('active', true)
  if (requestedEmployeeId) employeeQuery = employeeQuery.eq('id', requestedEmployeeId)
  const employees = await employeeQuery.order('full_name')
  if (employees.error || !employees.data?.length) return reply(req, { slots: [] })

  const from = `${date}T00:00:00+03:00`
  const to = `${date}T23:59:59+03:00`
  const ids = employees.data.map((item) => item.id)
  const [appointments, closures] = await Promise.all([
    db.from('appointments').select('employee_id,scheduled_at,duration_minutes,status')
      .in('employee_id', ids).gte('scheduled_at', from).lte('scheduled_at', to).neq('status', 'cancelled'),
    db.from('closed_time_slots').select('employee_id,starts_at,ends_at')
      .in('employee_id', ids).lt('starts_at', to).gt('ends_at', from),
  ])
  if (appointments.error || closures.error) throw appointments.error || closures.error
  const duration = Number(service.data.duration_minutes || 60)
  const now = Date.now()
  const slots = []
  for (let minutes = 8 * 60; minutes + duration <= 24 * 60; minutes += 30) {
    const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    const start = new Date(slotIso(date, time)).getTime()
    const end = start + duration * 60000
    if (start <= now) continue
    const employeeIds = employees.data.filter((employee) => {
      const busy = (appointments.data || []).some((item) => item.employee_id === employee.id && overlaps(start, end, item.scheduled_at, Number(item.duration_minutes || 60)))
      const closed = (closures.data || []).some((item) => item.employee_id === employee.id && start < new Date(item.ends_at).getTime() && end > new Date(item.starts_at).getTime())
      return !busy && !closed
    }).map((employee) => employee.id)
    if (employeeIds.length) slots.push({ time, employeeIds })
  }
  return reply(req, { date, durationMinutes: duration, slots })
}

async function createRequest(req: Request) {
  const body = await req.json().catch(() => ({}))
  const customerName = clean(body.customerName, 120)
  const customerPhone = phone(body.customerPhone)
  const serviceId = clean(body.serviceId, 80)
  const employeeId = clean(body.employeeId, 80) || null
  const requestedDate = clean(body.date, 10)
  const time = clean(body.time, 5)
  const note = clean(body.note, 500) || null
  if (customerName.length < 3 || !customerPhone || !serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) || !/^\d{2}:\d{2}$/.test(time)) {
    return reply(req, { error: 'Bilgileri kontrol edin.' }, 400)
  }
  const startAt = slotIso(requestedDate, time)
  if (new Date(startAt).getTime() <= Date.now()) return reply(req, { error: 'Geçmiş tarih seçilemez.' }, 400)
  const max = Date.now() + 90 * 86400000
  if (new Date(startAt).getTime() > max) return reply(req, { error: 'En fazla 90 gün sonrası seçilebilir.' }, 400)

  const ip = (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown').split(',')[0].trim()
  const rateLimitSalt = Deno.env.get('BOOKING_RATE_LIMIT_SALT') || SERVICE_ROLE_KEY
  const ipHash = await sha256(`${ip}:${rateLimitSalt}`)
  const since = new Date(Date.now() - 30 * 60000).toISOString()
  const [phoneCount, ipCount, service] = await Promise.all([
    db.from('online_booking_requests').select('id', { count: 'exact', head: true }).eq('phone_normalized', customerPhone).gte('created_at', since),
    db.from('online_booking_requests').select('id', { count: 'exact', head: true }).eq('request_ip_hash', ipHash).gte('created_at', since),
    db.from('services').select('id,name,price,duration_minutes').eq('id', serviceId).eq('active', true).maybeSingle(),
  ])
  if ((phoneCount.count || 0) >= 3 || (ipCount.count || 0) >= 10) return reply(req, { error: 'Çok fazla talep gönderildi. Lütfen daha sonra deneyin.' }, 429)
  if (!service.data) return reply(req, { error: 'Hizmet bulunamadı.' }, 404)
  if (employeeId) {
    const profile = await db.from('profiles').select('id').eq('id', employeeId).eq('active', true).maybeSingle()
    if (!profile.data) return reply(req, { error: 'Çalışan bulunamadı.' }, 404)
  }

  const availabilityUrl = new URL(req.url)
  availabilityUrl.searchParams.set('date', requestedDate)
  availabilityUrl.searchParams.set('service', serviceId)
  if (employeeId) availabilityUrl.searchParams.set('employee', employeeId)
  const availabilityResponse = await availability(new Request(availabilityUrl, { headers: req.headers }), availabilityUrl)
  const availabilityBody = await availabilityResponse.json()
  const chosen = (availabilityBody.slots || []).find((item: { time: string, employeeIds: string[] }) => item.time === time)
  if (!chosen || (employeeId && !chosen.employeeIds.includes(employeeId))) return reply(req, { error: 'Seçilen saat artık müsait değil.' }, 409)

  if (!employeeId) return reply(req, { error: 'Bir çalışan seçin.' }, 400)
  const inserted = await db.from('online_booking_requests').insert({
    client_name: customerName, phone: customerPhone, phone_normalized: customerPhone,
    service_id: serviceId, service_name: service.data.name, amount: service.data.price,
    employee_id: employeeId, scheduled_at: startAt,
    duration_minutes: Number(service.data.duration_minutes || 30), note, request_ip_hash: ipHash,
  }).select('id,public_token').single()
  if (inserted.error) throw inserted.error

  const managers = await db.from('profiles').select('id').eq('active', true).eq('role', 'manager')
  if (managers.data?.length) await db.from('notifications').insert(managers.data.map((item) => ({
    recipient_id: item.id, kind: 'booking_request', title: 'YENİ RANDEVU TALEBİ',
    body: `${customerName}\n${requestedDate} • ${time}`,
  })))
  return reply(req, { requestNumber: inserted.data.id.slice(0, 8).toUpperCase(), statusToken: inserted.data.public_token }, 201)
}

async function publicStatus(req: Request, token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return reply(req, { error: 'Geçersiz takip kodu.' }, 400)
  const row = await db.from('online_booking_requests').select('status,scheduled_at').eq('public_token', token).maybeSingle()
  if (!row.data) return reply(req, { error: 'Talep bulunamadı.' }, 404)
  return reply(req, { status: row.data.status, requested_date: row.data.scheduled_at, requested_start_at: row.data.scheduled_at })
}

async function adminList(req: Request) {
  const actor = await manager(req)
  if (!actor) return reply(req, { error: 'Yönetici oturumu gerekli.' }, 401)
  const rows = await db.from('online_booking_requests').select('*,services(name,price),requested_profile:profiles!online_booking_requests_employee_id_fkey(full_name)')
    .order('created_at', { ascending: false }).limit(250)
  if (rows.error) throw rows.error
  return reply(req, { requests: (rows.data || []).map((row) => ({
    ...row,
    customer_name: row.client_name,
    customer_phone: row.phone_normalized,
    requested_employee_id: row.employee_id,
    requested_start_at: row.scheduled_at,
    assigned_profile: row.requested_profile,
  })) })
}

async function adminAction(req: Request, action: string) {
  const actor = await manager(req)
  if (!actor) return reply(req, { error: 'Yönetici oturumu gerekli.' }, 401)
  const body = await req.json().catch(() => ({}))
  const requestId = clean(body.requestId, 80)
  if (!requestId) return reply(req, { error: 'Talep kimliği gerekli.' }, 400)
  if (action === 'approve') {
    const userDb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get('authorization') || '' } } })
    const result = await userDb.rpc('approve_online_booking_request', { p_request_id: requestId })
    if (result.error) return reply(req, { error: result.error.message }, 409)
    return reply(req, { approved: true, result: result.data || null })
  }
  const userDb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get('authorization') || '' } } })
  const result = await userDb.rpc('reject_online_booking_request', { p_request_id: requestId })
  if (result.error) return reply(req, { error: result.error.message }, 409)
  const reason = clean(body.reason, 300) || null
  if (reason) await db.from('online_booking_requests').update({ rejection_reason: reason }).eq('id', requestId).eq('status', 'rejected')
  return reply(req, { rejected: true })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) })
  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action') || ''
    if (req.method === 'GET' && action === 'catalogue') return await catalogue(req)
    if (req.method === 'GET' && action === 'availability') return await availability(req, url)
    if (req.method === 'GET' && action === 'status') return await publicStatus(req, url.searchParams.get('token') || '')
    if (req.method === 'GET' && action === 'admin-list') return await adminList(req)
    if (req.method === 'POST' && action === 'create') return await createRequest(req)
    if (req.method === 'POST' && (action === 'approve' || action === 'reject')) return await adminAction(req, action)
    return reply(req, { error: 'İşlem bulunamadı.' }, 404)
  } catch (error) {
    console.error('[customer-booking-request]', error)
    return reply(req, { error: 'İşlem tamamlanamadı. Lütfen tekrar deneyin.' }, 500)
  }
})
