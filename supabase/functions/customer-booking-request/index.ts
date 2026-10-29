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

function timeMinutes(value: unknown, fallback: number) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/)
  if (!match) return fallback
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= 24 * 60 ? minutes : fallback
}

function minuteLabel(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

const CUSTOMER_CONTACT_MESSAGE = 'Online randevu oluşturma işleminiz için lütfen Salon Modern ile iletişime geçiniz.'
const CUSTOMER_CHANGE_CUTOFF_MESSAGE = 'Randevunuza 2 saatten az kaldığı için online değişiklik veya iptal yapılamamaktadır. Lütfen Salon Modern ile iletişime geçiniz.'
const OTP_TEMPLATE = 'salon_modern_giris_kodu'
let otpTemplateCache = { until: 0, ready: false }
const NEW_CUSTOMER_EMPLOYEES = new Set([
  'd2bc11fe-e0dd-4609-bd26-f691ef049e32', // Cengiz
  '5fdd9b99-9669-4e36-9183-1380d61ea5bb', // Talip
])

function normalizedCustomerName(value: unknown) {
  const name = clean(value, 120).normalize('NFKC').replace(/\s+/g, ' ').trim()
  return name.split(' ').length >= 2 ? name.toLocaleLowerCase('tr-TR') : ''
}

async function otpHash(value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SERVICE_ROLE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const raw = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return Array.from(new Uint8Array(raw)).map((n) => n.toString(16).padStart(2, '0')).join('')
}

function randomOtp() {
  const values = new Uint32Array(1)
  const limit = Math.floor(0x100000000 / 1000000) * 1000000
  do crypto.getRandomValues(values); while (values[0] >= limit)
  return String(values[0] % 1000000).padStart(6, '0')
}

function randomSession() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32))).map((n) => n.toString(16).padStart(2, '0')).join('')
}

function ycloudOtpConfig() {
  const key = Deno.env.get('YCLOUD_API_KEY') || ''
  const waba = Deno.env.get('YCLOUD_WABA_ID') || ''
  const sender = Deno.env.get('YCLOUD_PHONE_NUMBER') || ''
  return key && /^\d+$/.test(waba) && /^\+[1-9]\d{7,14}$/.test(sender) ? { key, waba, sender } : null
}

async function approvedOtpTemplate(config: { key: string, waba: string }) {
  if (otpTemplateCache.until > Date.now()) return otpTemplateCache.ready
  const response = await fetch(`https://api.ycloud.com/v2/whatsapp/templates/${config.waba}/${OTP_TEMPLATE}/tr`, {
    headers: { 'X-API-Key': config.key, accept: 'application/json' }, signal: AbortSignal.timeout(5000),
  })
  const template = response.ok ? await response.json() : null
  const ready = String(template?.wabaId) === config.waba && template?.name === OTP_TEMPLATE
    && template?.language === 'tr' && template?.category === 'AUTHENTICATION' && template?.status === 'APPROVED'
  otpTemplateCache = { until: Date.now() + 60_000, ready }
  return ready
}

async function verifiedPhoneSession(body: Record<string, unknown>) {
  const customerPhone = phone(body.phone)
  const normalizedName = normalizedCustomerName(body.name)
  const token = String(body.session || '')
  if (!customerPhone || !normalizedName || !/^[a-f0-9]{64}$/.test(token)) return null
  const [sessionHash, phoneHash, nameHash] = await Promise.all([
    sha256(token), otpHash(`phone:${customerPhone}`), otpHash(`name:${normalizedName}`),
  ])
  const valid = await db.rpc('customer_phone_session_valid', {
    p_session_hash: sessionHash, p_phone_hash: phoneHash, p_name_hash: nameHash,
  })
  if (valid.error) throw valid.error
  return valid.data === true ? { customerPhone, normalizedName } : null
}

async function bookingEmployees(customerPhone: string, customerName: string) {
  const [registered, profiles] = await Promise.all([
    db.rpc('online_booking_customer_registered', { p_phone: customerPhone, p_name: customerName }),
    db.from('profiles').select('id,full_name').eq('active', true).neq('username', 'salon.modern').order('full_name'),
  ])
  if (registered.error || profiles.error) throw registered.error || profiles.error
  return (profiles.data || []).filter((profile) => registered.data === true || NEW_CUSTOMER_EMPLOYEES.has(profile.id))
}

async function requestPhoneCode(req: Request) {
  const body = await req.json().catch(() => ({}))
  const customerPhone = phone(body.phone), normalizedName = normalizedCustomerName(body.name)
  if (!customerPhone || !normalizedName) return reply(req, { error: 'Ad soyad ve telefon numaranızı kontrol edin.' }, 400)
  const config = ycloudOtpConfig()
  if (!config) return reply(req, { error: 'WhatsApp doğrulaması şu anda kullanılamıyor.' }, 503)
  if (`+${customerPhone}` === config.sender)
    return reply(req, { error: 'Bu numara Salon Modern’in WhatsApp gönderici numarasıdır. Doğrulama için farklı bir WhatsApp numarası girin.' }, 400)
  const ip = (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown').split(',')[0].trim()
  const id = crypto.randomUUID(), code = randomOtp()
  const [phoneHash, nameHash, ipHash, codeHash] = await Promise.all([
    otpHash(`phone:${customerPhone}`), otpHash(`name:${normalizedName}`),
    otpHash(`ip:${ip}`), otpHash(`code:${id}:${code}`),
  ])
  const issue = await db.rpc('begin_customer_phone_verification', {
    p_id: id, p_phone_hash: phoneHash, p_name_hash: nameHash, p_ip_hash: ipHash, p_code_hash: codeHash,
  })
  if (issue.error) throw issue.error
  if (issue.data !== true) return reply(req, { error: 'Çok fazla kod istendi. Lütfen biraz sonra tekrar deneyin.' }, 429)
  let templateReady = false
  try { templateReady = await approvedOtpTemplate(config) } catch { /* Provider lookup failed. */ }
  if (!templateReady) {
    await db.rpc('mark_customer_phone_verification_delivery', { p_id: id, p_status: 'failed' })
    return reply(req, { error: 'WhatsApp doğrulaması şu anda kullanılamıyor.' }, 503)
  }
  const payload = { from: config.sender, to: `+${customerPhone}`, type: 'template', externalId: id,
    template: { name: OTP_TEMPLATE, language: { code: 'tr' }, components: [
      { type: 'body', parameters: [{ type: 'text', text: code }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
    ] } }
  let delivery: 'sent' | 'failed' | 'unknown' = 'unknown', messageId: string | null = null
  let providerStatus: number | null = null, providerCode: string | null = null
  try {
    const response = await fetch('https://api.ycloud.com/v2/whatsapp/messages/sendDirectly', {
      method: 'POST', headers: { 'X-API-Key': config.key, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
    })
    providerStatus = response.status
    if (!response.ok) {
      delivery = 'failed'
      const result = await response.json().catch(() => null)
      const codeValue = result?.code ?? result?.error?.code ?? result?.error?.whatsappApiError?.code
      if (typeof codeValue === 'string' || typeof codeValue === 'number')
        providerCode = String(codeValue).slice(0, 40).replace(/[^a-zA-Z0-9_.-]/g, '')
    }
    else {
      const result = await response.json()
      if (result?.status === 'failed') delivery = 'failed'
      else if (result?.id && result?.externalId === id) { delivery = 'sent'; messageId = String(result.id) }
    }
  } catch { /* A timeout may happen after acceptance; never resend automatically. */ }
  const marked = await db.rpc('mark_customer_phone_verification_delivery', { p_id: id, p_status: delivery, p_message_id: messageId })
  if (marked.error) throw marked.error
  if (delivery === 'failed') return reply(req, { error: 'WhatsApp kodu gönderilemedi. Lütfen daha sonra tekrar deneyin.', providerStatus, providerCode }, 503)
  return reply(req, { challenge: id, message: 'WhatsApp kodunu bekleyin. Kod 5 dakika geçerlidir.' })
}

async function verifyPhoneCode(req: Request) {
  const body = await req.json().catch(() => ({}))
  if (!validUuid(String(body.challenge || '')) || !/^\d{6}$/.test(String(body.code || '')))
    return reply(req, { error: 'Kod geçersiz veya süresi dolmuş.' }, 400)
  const session = randomSession()
  const [codeHash, sessionHash] = await Promise.all([
    otpHash(`code:${body.challenge}:${body.code}`), sha256(session),
  ])
  const result = await db.rpc('finish_customer_phone_verification', {
    p_id: body.challenge, p_code_hash: codeHash, p_session_hash: sessionHash,
  })
  if (result.error) throw result.error
  if (result.data !== true) return reply(req, { error: 'Kod geçersiz veya süresi dolmuş.' }, 401)
  return reply(req, { session, expiresInSeconds: 1800 })
}

async function bookingIdentity(req: Request) {
  const body = await req.json().catch(() => ({}))
  const identity = await verifiedPhoneSession(body)
  if (!identity) return reply(req, { error: 'Telefon doğrulaması geçersiz veya süresi dolmuş.' }, 401)
  return reply(req, { employees: await bookingEmployees(identity.customerPhone, String(body.name || '')) })
}

async function verificationReady(req: Request) {
  const config = ycloudOtpConfig()
  if (!config) return reply(req, { available: false })
  try { return reply(req, { available: await approvedOtpTemplate(config) }) }
  catch { return reply(req, { available: false }) }
}

async function bookingSchedule(date: string) {
  const [settings, override] = await Promise.all([
    db.from('booking_settings').select('online_booking_enabled,default_open_time,default_close_time').eq('id', true).maybeSingle(),
    db.from('booking_schedule_overrides').select('open_time,close_time,is_closed').eq('schedule_date', date).maybeSingle(),
  ])
  if (settings.error || override.error) throw settings.error || override.error
  const defaultOpen = timeMinutes(settings.data?.default_open_time, 8 * 60 + 30)
  const defaultClose = timeMinutes(settings.data?.default_close_time, 20 * 60)
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
  const result = await db.from('services').select('id,name,price,duration_minutes,online_duration_minutes').eq('active', true)
  if (result.error) throw result.error
  return (result.data || [])
    .sort((a, b) => Number(b.price || 0) - Number(a.price || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'tr') || String(a.id).localeCompare(String(b.id)))
    .map((item) => ({ ...item, online_duration_minutes: Math.max(Number(item.duration_minutes), Number(item.online_duration_minutes)) }))
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
  const hasRemainingWindow = !todaySchedule.closed && timeMinutes(currentTime, 0) + 30 <= todaySchedule.close
  return reply(req, { services, employees: profiles.data, onlineBookingEnabled: todaySchedule.onlineBookingEnabled, today, todaySchedule: { ...todaySchedule, hasRemainingWindow } })
}

async function availability(req: Request, url: URL, own?: { id: string, service_id: string, employee_id: string, duration_minutes: number, online_protection_minutes: number | null }) {
  const date = url.searchParams.get('date') || ''
  const serviceId = own?.service_id || url.searchParams.get('service') || ''
  const requestedEmployeeId = own?.employee_id || url.searchParams.get('employee') || ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !serviceId) return reply(req, { error: 'Tarih ve hizmet gerekli.' }, 400)
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date())
  if (date < today) return reply(req, { error: 'Geçmiş tarih seçilemez.' }, 400)

  const service = (await onlineServices()).find((item) => item.id === serviceId)
  if (!service && !own) return reply(req, { error: 'Hizmet bulunamadı.' }, 404)
  const duration = own
    ? Math.max(own.duration_minutes, own.online_protection_minutes || service?.online_duration_minutes || own.duration_minutes)
    : service!.online_duration_minutes
  if (!Number.isSafeInteger(duration) || duration <= 0) return reply(req, { error: 'Bu hizmetin online süresi tanımlı değil. Lütfen salonla iletişime geçin.' }, 400)
  const schedule = await bookingSchedule(date)
  if (schedule.closed) {
    // Keep the operating-hour grid visible, but prevent selection on fully closed days.
    const allSlots: { time: string, available: boolean, status: string }[] = []
    for (let minute = Math.ceil(schedule.open / 60) * 60; minute < schedule.close; minute += 60) {
      allSlots.push({ time: minuteLabel(minute), available: false, status: 'closed' })
    }
    return reply(req, { date, durationMinutes: duration, slots: [], allSlots, schedule })
  }
  const available = await db.rpc('online_booking_slots', {
    p_service: serviceId, p_day: date, p_employee: requestedEmployeeId || null,
    p_exclude: own?.id || null, p_duration_override: own ? duration : null,
  })
  if (available.error) throw available.error
  return reply(req, { date, durationMinutes: available.data.durationMinutes, slots: available.data.slots, allSlots: available.data.allSlots || [], schedule })
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
  const verificationSetting = await db.from('booking_settings').select('online_booking_verification_enabled').eq('id', true).maybeSingle()
  if (verificationSetting.error) throw verificationSetting.error
  if (verificationSetting.data?.online_booking_verification_enabled === true) {
    const identity = await verifiedPhoneSession({ phone: customerPhone, name: customerName, session: body.verificationSession })
    if (!identity) return reply(req, { error: 'Telefon doğrulaması geçersiz veya süresi dolmuş. Sayfayı yenileyin.' }, 401)
    const allowedEmployees = await bookingEmployees(customerPhone, customerName)
    if (!employeeId || !allowedEmployees.some((item) => item.id === employeeId))
      return reply(req, { error: 'Bu müşteri için uygun çalışan seçin.' }, 403)
  }
  const startAt = slotIso(requestedDate, time)
  if (submissionToken) {
    const existing = await db.from('online_booking_requests').select('id,public_token,status,client_name,phone_normalized,service_id,employee_id,scheduled_at').eq('public_token', submissionToken).maybeSingle()
    if (existing.error) throw existing.error
    if (existing.data) {
      const row = existing.data
      if (row.client_name.trim().toLocaleLowerCase('tr-TR') !== customerName.toLocaleLowerCase('tr-TR') || row.phone_normalized !== customerPhone || row.service_id !== serviceId || (employeeId && row.employee_id !== employeeId) || new Date(row.scheduled_at).getTime() !== new Date(startAt).getTime()) return reply(req, { error: 'Kayıt bilgileri değişti. Sayfayı yenileyin.' }, 409)
      return reply(req, { requestNumber: row.id.slice(0, 8).toUpperCase(), statusToken: row.public_token, status: row.status }, 200)
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
    db.from('services').select('id,name,price,duration_minutes,online_duration_minutes').eq('id', serviceId).eq('active', true).maybeSingle(),
  ])
  if (phoneCount.error || ipCount.error || service.error) throw phoneCount.error || ipCount.error || service.error
  if ((phoneCount.count || 0) >= 3 || (ipCount.count || 0) >= 10) return reply(req, { error: 'Çok fazla talep gönderildi. Lütfen daha sonra deneyin.' }, 429)
  if (!service.data) return reply(req, { error: 'Hizmet bulunamadı.' }, 404)
  const availabilityUrl = new URL(req.url)
  availabilityUrl.searchParams.set('date', requestedDate)
  availabilityUrl.searchParams.set('service', serviceId)
  if (employeeId) availabilityUrl.searchParams.set('employee', employeeId)
  const availabilityResponse = await availability(new Request(availabilityUrl, { headers: req.headers }), availabilityUrl)
  const availabilityBody = await availabilityResponse.json()
  if (!availabilityResponse.ok) return reply(req, { error: availabilityBody.error || 'Müsait saatler yüklenemedi.' }, availabilityResponse.status)
  const chosen = (availabilityBody.slots || []).find((item: { time: string, employeeIds: string[] }) => item.time === time)
  if (!chosen || (employeeId && !chosen.employeeIds.includes(employeeId))) return reply(req, { error: 'Seçilen saat artık müsait değil.' }, 409)

  const inserted = await db.rpc('create_pending_online_booking', { p_booking: {
    client_name: customerName, phone: customerPhone, phone_normalized: customerPhone,
    service_id: serviceId, service_name: service.data.name, amount: service.data.price,
    employee_id: employeeId, scheduled_at: startAt,
    duration_minutes: availabilityBody.durationMinutes, note, request_ip_hash: ipHash,
    public_token: submissionToken || crypto.randomUUID(),
  } })
  if (inserted.error) {
    console.error('[customer-booking-request] pending request failed', inserted.error)
    return reply(req, { error: 'Randevu kaydedilemedi. Seçtiğiniz saat dolmuş veya kapanmış olabilir. Müsait saatleri yenileyin.' }, 409)
  }
  return reply(req, { requestNumber: inserted.data.id.slice(0, 8).toUpperCase(), statusToken: inserted.data.public_token, status: inserted.data.status }, 201)
}

async function publicStatus(req: Request, token: string) {
  if (!validUuid(token)) return reply(req, { error: 'Geçersiz takip kodu.' }, 400)
  const row = await customerBooking(token)
  if (!row.data) return reply(req, { error: 'Talep bulunamadı.' }, 404)
  const item = row.data.appointment
  const starts = item?.scheduled_at || row.data.scheduled_at
  const outsideCutoff = new Date(starts).getTime() >= Date.now() + 2 * 60 * 60 * 1000
  return reply(req, { status: item && ['completed', 'cancelled', 'no_show'].includes(item.status) ? item.status : row.data.status,
    requested_date: starts, requested_start_at: starts, revision: row.data.customer_revision,
    request: { customer: row.data.client_name, service: row.data.service_name,
      employee: row.data.requested_profile?.full_name || '', scheduledAt: row.data.scheduled_at },
    appointment: item ? { customer: item.client_name, service: item.service_name, employee: item.employee?.full_name,
      scheduledAt: starts, durationMinutes: item.duration_minutes, amount: item.amount,
      canManage: item.status === 'confirmed' && row.data.status === 'approved' && outsideCutoff } : null,
    managementMessage: item?.status === 'confirmed' && row.data.status === 'approved' && !outsideCutoff ? CUSTOMER_CHANGE_CUTOFF_MESSAGE : null })
}

function validUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) }
type CustomerBookingRow = { status: string, scheduled_at: string, customer_revision: number,
  client_name: string, service_name: string, requested_profile: null | { full_name: string },
  appointment: null | { id: string, client_name: string, service_name: string, service_id: string, employee_id: string,
    scheduled_at: string, duration_minutes: number, online_protection_minutes: number | null, amount: number, status: string, employee: null | { full_name: string } } }
async function customerBooking(token: string) {
  const result = await db.from('online_booking_requests')
    .select('status,scheduled_at,customer_revision,client_name,service_name,requested_profile:profiles!online_booking_requests_employee_id_fkey(full_name),appointment:appointments!online_booking_requests_appointment_id_fkey(id,client_name,service_name,service_id,employee_id,scheduled_at,duration_minutes,online_protection_minutes,amount,status,employee:profiles!appointments_employee_id_fkey(full_name))')
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
  if (!validUuid(requestId)) return reply(req, { error: 'Geçerli talep kimliği gerekli.' }, 400)
  const userDb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get('authorization') || '' } } })
  if (action === 'update') {
    const startAt = clean(body.startAt, 40)
    const employeeId = clean(body.employeeId, 80)
    const serviceId = clean(body.serviceId, 80)
    if (!validUuid(employeeId) || !validUuid(serviceId) || !Number.isFinite(Date.parse(startAt))) {
      return reply(req, { error: 'Hizmet, çalışan ve tarih/saat gerekli.' }, 400)
    }
    const result = await userDb.rpc('update_pending_online_booking_request', {
      p_request_id: requestId, p_start: startAt, p_employee_id: employeeId, p_service_id: serviceId,
    })
    if (result.error) return reply(req, { error: result.error.message }, 409)
    return reply(req, { updated: true })
  }
  if (action === 'approve') {
    const result = await userDb.rpc('approve_online_booking_request', { p_request_id: requestId })
    if (result.error) return reply(req, { error: result.error.message }, 409)
    return reply(req, { approved: true, result: result.data || null })
  }
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
    if (req.method === 'GET' && action === 'verification-ready') return await verificationReady(req)
    if (req.method === 'GET' && action === 'availability') return await availability(req, url)
    if (req.method === 'GET' && action === 'status') return await publicStatus(req, url.searchParams.get('token') || '')
    if (req.method === 'GET' && action === 'customer-availability') return await customerAvailability(req, url)
    if (req.method === 'GET' && action === 'admin-list') return await adminList(req)
    if (req.method === 'POST' && action === 'create') return await createRequest(req)
    if (req.method === 'POST' && action === 'phone-request-code') return await requestPhoneCode(req)
    if (req.method === 'POST' && action === 'phone-verify-code') return await verifyPhoneCode(req)
    if (req.method === 'POST' && action === 'booking-identity') return await bookingIdentity(req)
    if (req.method === 'POST' && (action === 'customer-update' || action === 'customer-cancel')) return await customerAction(req, action === 'customer-update' ? 'update' : 'cancel')
    if (req.method === 'POST' && (action === 'approve' || action === 'reject' || action === 'update')) return await adminAction(req, action)
    return reply(req, { error: 'İşlem bulunamadı.' }, 404)
  } catch (error) {
    console.error('[customer-booking-request]', error)
    return reply(req, { error: 'İşlem tamamlanamadı. Lütfen tekrar deneyin.' }, 500)
  }
})
