
export const ISTANBUL_TIME_ZONE = "Europe/Istanbul";

export function digits(value = "") {
  return String(value).replace(/\D/g, "");
}

export function normalizeTrPhone(value = "") {
  let valueDigits = digits(value);
  if (valueDigits.startsWith("0090")) valueDigits = valueDigits.slice(2);
  if (/^90[5][0-9]{9}$/.test(valueDigits)) return valueDigits;
  if (/^0[5][0-9]{9}$/.test(valueDigits)) return `90${valueDigits.slice(1)}`;
  if (/^[5][0-9]{9}$/.test(valueDigits)) return `90${valueDigits}`;
  return null;
}

export function normalizeText(value = "") {
  return String(value)
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9:+.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isYes(value = "") {
  const text = normalizeText(value);
  return /^(evet|onayliyorum|onayla|olur|tamam|ayir|yap|dogru)$/.test(text);
}

export function isNo(value = "") {
  const text = normalizeText(value);
  return /^(hayir|vazgec|iptal|istemiyorum|olmaz|yanlis)$/.test(text);
}

export function classifyIntent(value = "") {
  const text = normalizeText(value);
  if (/insan|personel|birisiyle|biriyle|usta.*bagla|yetkili|canli destek/.test(text)) return { intent: "handoff", confidence: 1 };
  if (/randevu/.test(text) && /iptal|sil|vazgec/.test(text)) return { intent: "cancel_appointment", confidence: 0.98 };
  if (/randevu/.test(text) && /degistir|tasi|ertele|baska saat|baska gun/.test(text)) return { intent: "reschedule_appointment", confidence: 0.98 };
  if (/randevu/.test(text) && /al|yap|olustur|ayir|istiyorum/.test(text)) return { intent: "create_appointment", confidence: 0.95 };
  if (/musait|bos saat|bosluk|hangi saat/.test(text)) return { intent: "availability", confidence: 0.94 };
  if (/fiyat|ucret|ne kadar|kac tl|tarife/.test(text)) return { intent: "price", confidence: 0.93 };
  if (/hizmet|islem|neler var|ne yapiyorsunuz/.test(text)) return { intent: "service", confidence: 0.9 };
  if (/merhaba|selam|gunaydin|iyi gunler|tesekkur/.test(text)) return { intent: "general", confidence: 0.85 };
  return { intent: "general", confidence: 0.25 };
}

function istanbulDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ISTANBUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

function isoDateFromUtcDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addDateDays(dateText, days) {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return isoDateFromUtcDate(date);
}

export function todayInIstanbul(now = new Date()) {
  const value = istanbulDateParts(now);
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

export function parseTurkishDate(value = "", now = new Date()) {
  const text = normalizeText(value);
  const today = todayInIstanbul(now);
  if (/\bobur gun\b/.test(text)) return addDateDays(today, 2);
  if (/\byarin\b/.test(text)) return addDateDays(today, 1);
  if (/\bbugun\b/.test(text)) return today;

  const explicit = text.match(/\b([0-3]?\d)[./-]([01]?\d)(?:[./-](\d{4}))?\b/);
  if (explicit) {
    const current = istanbulDateParts(now);
    const year = Number(explicit[3] || current.year);
    const month = Number(explicit[2]);
    const day = Number(explicit[1]);
    const candidate = new Date(Date.UTC(year, month - 1, day, 12));
    if (candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day) {
      return isoDateFromUtcDate(candidate);
    }
  }

  const monthNames = { ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6, temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12 };
  const monthMatch = text.match(/\b([0-3]?\d)\s+(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)(?:\s+(\d{4}))?\b/);
  if (monthMatch) {
    const current = istanbulDateParts(now);
    return `${Number(monthMatch[3] || current.year)}-${String(monthNames[monthMatch[2]]).padStart(2, "0")}-${String(Number(monthMatch[1])).padStart(2, "0")}`;
  }

  const weekdays = { pazar: 0, pazartesi: 1, sali: 2, carsamba: 3, persembe: 4, cuma: 5, cumartesi: 6 };
  for (const [name, target] of Object.entries(weekdays)) {
    if (!new RegExp(`\\b${name}\\b`).test(text)) continue;
    const [year, month, day] = today.split("-").map(Number);
    const current = new Date(Date.UTC(year, month - 1, day, 12));
    let delta = (target - current.getUTCDay() + 7) % 7;
    if (/gelecek/.test(text) || delta === 0) delta += 7;
    return addDateDays(today, delta);
  }
  return null;
}

export function parseTime(value = "") {
  const text = normalizeText(value);
  const match = text.match(/(?:saat\s*)?\b([01]?\d|2[0-3])\s*[.:]\s*([0-5]\d)\b/);
  if (match) return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
  const hourOnly = text.match(/\bsaat\s+([01]?\d|2[0-3])\b/);
  if (hourOnly) return `${String(Number(hourOnly[1])).padStart(2, "0")}:00`;
  return null;
}

export function istanbulDateTimeIso(dateText, timeText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText || "") || !/^\d{2}:\d{2}$/.test(timeText || "")) return null;
  const date = new Date(`${dateText}T${timeText}:00+03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function nextDate(dateText) {
  return addDateDays(dateText, 1);
}

export function formatTurkishDate(dateText) {
  const date = new Date(`${dateText}T12:00:00+03:00`);
  return new Intl.DateTimeFormat("tr-TR", { timeZone: ISTANBUL_TIME_ZONE, day: "numeric", month: "long", weekday: "long" }).format(date);
}

export function formatIstanbulDateTime(iso) {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: ISTANBUL_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function resolveNamedEntity(value, rows, labelKey = "name") {
  const text = normalizeText(value);
  const matches = rows
    .map((row) => ({ row, normalized: normalizeText(row[labelKey] || "") }))
    .filter(({ normalized }) => normalized && (text.includes(normalized) || normalized.split(" ").some((part) => part.length >= 4 && text.includes(part))));
  return matches.length === 1 ? matches[0].row : null;
}

export function rangesOverlap(startA, endA, startB, endB) {
  return new Date(startA).getTime() < new Date(endB).getTime() && new Date(endA).getTime() > new Date(startB).getTime();
}

export function maskPhone(value = "") {
  const normalized = normalizeTrPhone(value);
  if (!normalized) return "Telefon yok";
  return `+90 5** *** ** ${normalized.slice(-2)}`;
}
