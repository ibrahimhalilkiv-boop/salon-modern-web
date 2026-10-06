import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const allowedOrigins = new Set([
  'https://salonmodern.com.tr',
  'https://www.salonmodern.com.tr',
  'https://app.salonmodern.com.tr',
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
    'Cache-Control': 'no-store',
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

function timeMinutes(value: unknown, fallback: number) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/)
  if (!match) return fallback
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= 24 * 60 ? minutes : fallback
}

function minuteLabel(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

// Online customers may start no later than 19:00. The management calendar
// deliberately remains independent and can accept later manual appointments.
const ONLINE_LAST_START_MINUTES = 19 * 60
const CUSTOMER_CONTACT_MESSAGE = 'Online randevu oluşturma işleminiz için lütfen Salon Modern ile iletişime geçiniz.'
const CUSTOMER_CHANGE_CUTOFF_MESSAGE = 'Randevunuza 2 saatten az kaldığı için online değişiklik veya iptal yapılamamaktadır. Lütfen Salon Modern ile iletişime geçiniz.'
const ONLINE_HOUR_SERVICE_IDS = new Set([
  '2638b0ff-a6e0-412c-b212-0f4d238d9be1', // Saç sakal ağda maske yıkama
  '620dbf23-22f9-4362-85a4-eed7c377e9be', // Saç sakal maske yıkama
  '0cdc2d09-b75e-4545-ba73-1c01665400c7', // Saç,sakal kesim yıkama
  '65f7f4ae-77ff-4409-b10a-5607a05aceee', // Saç sakal kesim
])

function onlineDuration(serviceId: string) {
  return ONLINE_HOUR_SERVICE_IDS.has(serviceId) ? 60 : 30
}

async function bookingSchedule(date: string) {
  const [settings, override] = await Promise.all([
    db.from('booking_settings').select('online_booking_enabled,default_open_time,default_close_time').eq('id', true).maybeSingle(),
    db.from('booking_schedule_overrides').select('open_time,close_time,is_closed').eq('schedule_date', date).maybeSingle(),
  ])
  if (settings.error || override.error) throw settings.error || override.error
  const defaultOpen = timeMinutes(settings.data?.default_open_time, 9 * 60)
  const defaultClose = timeMinutes(settings.data?.default_close_time, 19 * 60)
  const open = timeMinutes(override.data?.open_time, defaultOpen)
  const close = timeMinutes(override.data?.close_time, defaultClose)
  const sunday = new Date(`${date}T12:00:00+03:00`).getUTCDay() === 0
  const onlineBookingEnabled = settings.data?.online_booking_enabled !== false
  const closed = !onlineBookingEnabled || (override.data ? override.data.is_closed === true : sunday) || close <= open
  return { closed, onlineBookingEnabled, open, close, openTime: minuteLabel(open), closeTime: minuteLabel(close), overridden: Boolean(override.data) }
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

async function onlineServices() {
  const result = await db.from('services').select('id,name,price,duration_minutes').eq('active', true)
  if (result.error) throw result.error
  return (result.data || [])
    .sort((a, b) => Number(b.price || 0) - Number(a.price || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'tr') || String(a.id).localeCompare(String(b.id)))
    .map((item) => ({ ...item, online_duration_minutes: onlineDuration(item.id) }))
}

async function catalogue(req: Request) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date())
  const currentTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
  const [services, profiles, todaySchedule] = await Promise.all([
    onlineServices(),
    db.from('profiles').select('id,full_name').eq('active', true).neq('username', 'salon.modern').order('full_name'),
    bookingSchedule(today),
  ])
  if (profiles.error) throw profiles.error
  const hasRemainingWindow = !todaySchedule.closed && timeMinutes(currentTime, 0) < Math.min(todaySchedule.close, ONLINE_LAST_START_MINUTES)
  return reply(req, { services, employees: profiles.data, onlineBookingEnabled: todaySchedule.onlineBookingEnabled, today, todaySchedule: { ...todaySchedule, hasRemainingWindow } })
}

async function availability(req: Request, url: URL, own?: { id: string, service_id: string, employee_id: string, duration_minutes: number }) {
  const date = url.searchParams.get('date') || ''
  const serviceId = own?.service_id || url.searchParams.get('service') || ''
  const requestedEmployeeId = own?.employee_id || url.searchParams.get('employee') || ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !serviceId) return reply(req, { error: 'Tarih ve hizmet gerekli.' }, 400)
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date())
  if (date < today) return reply(req, { error: 'Geçmiş tarih seçilemez.' }, 400)

  const service = own
    ? { id: own.service_id, online_duration_minutes: own.duration_minutes }
    : (await onlineServices()).find((item) => item.id === serviceId)
  if (!service) return reply(req, { error: 'Hizmet bulunamadı.' }, 404)
  if (!Number.isSafeInteger(service.online_duration_minutes) || service.online_duration_minutes <= 0) return reply(req, { error: 'Bu hizmetin online süresi tanımlı değil. Lütfen salonla iletişime geçin.' }, 400)
  const schedule = await bookingSchedule(date)
  if (schedule.closed) return reply(req, { date, durationMinutes: service.online_duration_minutes, slots: [], schedule })
  let employeeQuery = db.from('profiles').select('id,full_name').eq('active', true).neq('username', 'salon.modern')
  if (requestedEmployeeId) employeeQuery = employeeQuery.eq('id', requestedEmployeeId)
  const employees = await employeeQuery.order('full_name')
  if (employees.error || !employees.data?.length) return reply(req, { slots: [] })

  const from = `${date}T00:00:00+03:00`
  const to = `${date}T23:59:59+03:00`
  const ids = employees.data.map((item) => item.id)
  const [appointments, closures] = await Promise.all([
    db.from('appointments').select('id,employee_id,scheduled_at,duration_minutes,status')
      .in('employee_id', ids).lt('scheduled_at', to).gt('scheduled_end', from).neq('status', 'cancelled'),
    db.from('closed_time_slots').select('employee_id,starts_at,ends_at')
      .in('employee_id', ids).lt('starts_at', to).gt('ends_at', from),
  ])
  if (appointments.error || closures.error) throw appointments.error || closures.error
  const duration = service.online_duration_minutes
  const now = Date.now()
  const slots = []
  const cadence = 30
  const first = Math.ceil(schedule.open / cadence) * cadence
  for (let minutes = first; minutes <= ONLINE_LAST_START_MINUTES && minutes + duration <= schedule.close; minutes += cadence) {
    const time = minuteLabel(minutes)
    const start = new Date(slotIso(date, time)).getTime()
    const end = start + duration * 60000
    if (start <= now) continue
    const employeeIds = employees.data.filter((employee) => {
      const busy = (appointments.data || []).some((item) => (!own || item.id !== own.id) && item.employee_id === employee.id && overlaps(start, end, item.scheduled_at, Number(item.duration_minutes || 60)))
      const closed = (closures.data || []).some((item) => item.employee_id === employee.id && start < new Date(item.ends_at).getTime() && end > new Date(item.starts_at).getTime())
      return !busy && !closed
    }).map((employee) => employee.id)
    if (employeeIds.length) slots.push({ time, employeeIds })
  }
  return reply(req, { date, durationMinutes: duration, slots, schedule })
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
  const submissionToken = clean(body.submissionToken, 36)
  if (submissionToken && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionToken)) return reply(req, { error: 'Geçersiz kayıt anahtarı.' }, 400)
  if (customerName.length < 3 || !customerPhone || !serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) || !/^\d{2}:\d{2}$/.test(time)) {
    return reply(req, { error: 'Bilgileri kontrol edin.' }, 400)
  }
  const startAt = slotIso(requestedDate, time)
  if (submissionToken) {
    const existing = await db.from('online_booking_requests').select('id,public_token,status,phone_normalized,service_id,employee_id,scheduled_at').eq('public_token', submissionToken).maybeSingle()
    if (existing.error) throw existing.error
    if (existing.data) {
      const row = existing.data
      if (row.phone_normalized !== customerPhone || row.service_id !== serviceId || row.employee_id !== employeeId || new Date(row.scheduled_at).getTime() !== new Date(startAt).getTime()) return reply(req, { error: 'Kayıt bilgileri değişti. Sayfayı yenileyin.' }, 409)
      if (row.status === 'approved') return reply(req, { requestNumber: row.id.slice(0, 8).toUpperCase(), statusToken: row.public_token, status: 'approved' }, 200)
    }
  }
  const permission = await db.rpc('can_create_online_booking', { p_phone: customerPhone })
  if (permission.error) throw permission.error
  if (permission.data !== true) return reply(req, { error: CUSTOMER_CONTACT_MESSAGE }, 403)
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
  if (phoneCount.error || ipCount.error || service.error) throw phoneCount.error || ipCount.error || service.error
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
  if (!availabilityResponse.ok) return reply(req, { error: availabilityBody.error || 'Müsait saatler yüklenemedi.' }, availabilityResponse.status)
  const chosen = (availabilityBody.slots || []).find((item: { time: string, employeeIds: string[] }) => item.time === time)
  if (!chosen || (employeeId && !chosen.employeeIds.includes(employeeId))) return reply(req, { error: 'Seçilen saat artık müsait değil.' }, 409)

  if (!employeeId) return reply(req, { error: 'Bir çalışan seçin.' }, 400)
  const inserted = await db.rpc('create_confirmed_online_booking', { p_booking: {
    client_name: customerName, phone: customerPhone, phone_normalized: customerPhone,
    service_id: serviceId, service_name: service.data.name, amount: service.data.price,
    employee_id: employeeId, scheduled_at: startAt,
    duration_minutes: availabilityBody.durationMinutes, note, request_ip_hash: ipHash,
    public_token: submissionToken || crypto.randomUUID(),
  } })
  if (inserted.error) {
    console.error('[customer-booking-request] automatic confirmation failed', inserted.error)
    return reply(req, { error: 'Randevu kaydedilemedi. Seçtiğiniz saat dolmuş veya kapanmış olabilir. Müsait saatleri yenileyin.' }, 409)
  }
  return reply(req, { requestNumber: inserted.data.id.slice(0, 8).toUpperCase(), statusToken: inserted.data.public_token, status: 'approved' }, 201)
}

async function publicStatus(req: Request, token: string) {
  if (!validUuid(token)) return reply(req, { error: 'Geçersiz takip kodu.' }, 400)
  const row = await customerBooking(token)
  if (!row.data) return reply(req, { error: 'Talep bulunamadı.' }, 404)
  const item = row.data.appointment
  const starts = item?.scheduled_at || row.data.scheduled_at
  const outsideCutoff = new Date(starts).getTime() >= Date.now() + 2 * 60 * 60 * 1000
  return reply(req, { status: item?.status === 'cancelled' ? 'cancelled' : row.data.status,
    requested_date: starts, requested_start_at: starts, revision: row.data.customer_revision,
    appointment: item ? { customer: item.client_name, service: item.service_name, employee: item.employee?.full_name,
      scheduledAt: starts, durationMinutes: item.duration_minutes, amount: item.amount,
      canManage: item.status === 'confirmed' && row.data.status === 'approved' && outsideCutoff } : null,
    managementMessage: item?.status === 'confirmed' && row.data.status === 'approved' && !outsideCutoff ? CUSTOMER_CHANGE_CUTOFF_MESSAGE : null })
}

function validUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) }
type CustomerBookingRow = { status: string, scheduled_at: string, customer_revision: number,
  appointment: null | { id: string, client_name: string, service_name: string, service_id: string, employee_id: string,
    scheduled_at: string, duration_minutes: number, amount: number, status: string, employee: null | { full_name: string } } }
async function customerBooking(token: string) {
  const result = await db.from('online_booking_requests')
    .select('status,scheduled_at,customer_revision,appointment:appointments!online_booking_requests_appointment_id_fkey(id,client_name,service_name,service_id,employee_id,scheduled_at,duration_minutes,amount,status,employee:profiles!appointments_employee_id_fkey(full_name))')
    .eq('public_token', token).maybeSingle().returns<CustomerBookingRow>()
  if (result.error) throw result.error
  return result
}
async function customerAvailability(req: Request, url: URL) {
  const token = url.searchParams.get('token') || ''
  if (!validUuid(token)) return reply(req, { error: 'Geçersiz takip kodu.' }, 400)
  const row = await customerBooking(token), item = row.data?.appointment
  if (!item || item.status !== 'confirmed' || row.data?.status !== 'approved') return reply(req, { error: 'Randevu değiştirilemez.' }, 409)
  if (new Date(item.scheduled_at).getTime() < Date.now() + 2 * 60 * 60 * 1000) return reply(req, { error: CUSTOMER_CHANGE_CUTOFF_MESSAGE }, 409)
  return availability(req, url, item)
}
async function customerAction(req: Request, action: string) {
  const body = await req.json().catch(() => ({}))
  if (body.appointmentId || body.employeeId || body.serviceId || body.staff_overlap_override) return reply(req, { error: 'Yalnız bağlı randevunun tarihi ve saati değiştirilebilir.' }, 400)
  if (!validUuid(body.token || '') || !validUuid(body.operation || '') || !Number.isInteger(body.revision)) return reply(req, { error: 'Geçersiz işlem bilgileri.' }, 400)
  if (action === 'update' && (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '') || !/^\d{2}:\d{2}$/.test(body.time || ''))) return reply(req, { error: 'Tarih ve saat seçin.' }, 400)
  const booking = await customerBooking(body.token), appointment = booking.data?.appointment
  if (!appointment || appointment.status !== 'confirmed' || booking.data?.status !== 'approved') return reply(req, { error: 'Randevu değiştirilemez.' }, 409)
  if (new Date(appointment.scheduled_at).getTime() < Date.now() + 2 * 60 * 60 * 1000) return reply(req, { error: CUSTOMER_CHANGE_CUTOFF_MESSAGE }, 409)
  const result = await db.rpc('manage_customer_online_booking', { p_token: body.token, p_operation: body.operation,
    p_revision: body.revision, p_action: action, p_start: action === 'update' ? slotIso(body.date, body.time) : null })
  if (result.error) return reply(req, { error: String(result.error.message || '').includes('2 saat') ? CUSTOMER_CHANGE_CUTOFF_MESSAGE : 'Randevu değiştirilemedi. Bilgileri ve müsait saatleri yenileyin.' }, 409)
  return reply(req, result.data)
}

async function adminList(req: Request) {
  const sourceIds = new URL(req.url).searchParams.get('sourceIds')
  if (sourceIds !== null) {
    const ids = sourceIds.split(',').filter(Boolean)
    if (ids.length > 200 || ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) return reply(req, { error: 'Randevu kimliklerini kontrol edin.' }, 400)
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const auth = await db.auth.getUser(token)
    if (auth.error || !auth.data.user) return reply(req, { error: 'Personel oturumu gerekli.' }, 401)
    const actor = await db.from('profiles').select('id').eq('id', auth.data.user.id).eq('active', true).maybeSingle()
    if (actor.error || !actor.data) return reply(req, { error: 'Aktif personel oturumu gerekli.' }, 403)
    if (!ids.length) return reply(req, { sourceAppointmentIds: [] })
    const userDb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get('authorization') || '' } } })
    const allowed = await userDb.from('appointments').select('id').in('id', ids)
    if (allowed.error) throw allowed.error
    const allowedIds = (allowed.data || []).map(row => row.id)
    if (!allowedIds.length) return reply(req, { sourceAppointmentIds: [] })
    const sources = await db.from('online_booking_requests').select('appointment_id').in('appointment_id', allowedIds)
    if (sources.error) throw sources.error
    return reply(req, { sourceAppointmentIds: (sources.data || []).map(row => row.appointment_id) })
  }
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
    if (req.method === 'GET' && action === 'customer-availability') return await customerAvailability(req, url)
    if (req.method === 'GET' && action === 'admin-list') return await adminList(req)
    if (req.method === 'POST' && action === 'create') return await createRequest(req)
    if (req.method === 'POST' && (action === 'customer-update' || action === 'customer-cancel')) return await customerAction(req, action === 'customer-update' ? 'update' : 'cancel')
    if (req.method === 'POST' && (action === 'approve' || action === 'reject')) return await adminAction(req, action)
    return reply(req, { error: 'İşlem bulunamadı.' }, 404)
  } catch (error) {
    console.error('[customer-booking-request]', error)
    return reply(req, { error: 'İşlem tamamlanamadı. Lütfen tekrar deneyin.' }, 500)
  }
})
