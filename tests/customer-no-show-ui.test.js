const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('salon-phase2-1.8.0.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20261004223000_online_booking_no_show_and_two_hour_cutoff.sql', 'utf8');

function functionSource(name, nextName) {
  const start = source.indexOf('function ' + name + '(');
  const next = source.slice(start).match(new RegExp('\\n(?:async )?function ' + nextName + '\\('));
  const end = next ? start + next.index : -1;
  assert.ok(start >= 0 && end > start, name + ' kaynakta bulunmalı');
  return source.slice(start, end);
}

const context = {
  appts: [],
  remoteSchedule: (date, time) => date + 'T' + time + ':00+03:00',
  appointmentDate: item => item.date,
};
vm.createContext(context);
vm.runInContext([
  functionSource('phase2NormalizeTrPhone', 'phase2NoShowCount'),
  functionSource('phase2NoShowCount', 'phase2NoShowDetailText'),
  functionSource('phase2NoShowDetailText', 'phase2NoShowAppointmentText'),
  functionSource('phase2NoShowAppointmentText', 'phase2RenderCustomerDetail'),
].join('\n'), context);

const now = '2026-10-07T12:00:00.000Z';
const client = { id: 'client-1', phone: '0532 555 44 33' };
context.appts = [
  { status: 'no_show', clientId: 'client-1', clientPhone: '', scheduledAt: '2026-10-01T10:00:00.000Z' },
  { status: 'no_show', clientId: 'other', clientPhone: '0090 532 555 44 33', scheduledAt: '2026-09-01T10:00:00.000Z' },
  { status: 'cancelled', clientId: 'client-1', clientPhone: '05325554433', scheduledAt: '2026-08-01T10:00:00.000Z' },
  { status: 'cancelled', clientId: 'client-1', clientPhone: '05325554433', scheduledAt: '2026-07-01T10:00:00.000Z' },
  { status: 'no_show', clientId: 'client-1', clientPhone: '05325554433', scheduledAt: '2026-04-07T11:59:59.000Z' },
  { status: 'no_show', clientId: 'client-1', clientPhone: '05325554433', scheduledAt: '2026-10-07T12:00:01.000Z' },
];

assert.equal(context.phase2NoShowCount(client, now), 2, 'Yalnız son altı aydaki gerçek no_show kayıtları sayılmalı');
context.appts = [{ status: 'no_show', clientId: 'client-2', clientPhone: '', scheduledAt: '2026-10-01T10:00:00.000Z' }];
assert.equal(context.phase2NoShowCount({ id: 'client-2', phone: '' }, now), 1, 'Müşteri kimliği telefon eksik olsa da kendi Gelmedi kaydını göstermeli');
assert.equal(context.phase2NormalizeTrPhone('+90 532 555 44 33'), '905325554433');
assert.equal(context.phase2NormalizeTrPhone('5325554433'), '905325554433');
assert.equal(context.phase2NormalizeTrPhone('0090 532 555 44 33'), '905325554433');
assert.equal(context.phase2NoShowDetailText(0), 'Gelmedi: 0');
assert.equal(context.phase2NoShowDetailText(1), 'Gelmedi: 1');
assert.equal(context.phase2NoShowDetailText(2), '⚠️ Gelmedi: 2 — Online randevu engelli');
assert.equal(context.phase2NoShowAppointmentText(1), 'Son 6 ayda 1 kez randevusuna gelmedi.');
assert.equal(context.phase2NoShowAppointmentText(2), '⚠️ Son 6 ayda 2 kez randevusuna gelmedi. Online randevu engelli.');

const infoFunction = functionSource('phase2ShowAppointmentNoShow', 'phase2ActivateHome');
assert.doesNotMatch(infoFunction, /disabled|throw|return false/, 'Bilgi paneli manuel randevuyu engellememeli');
assert.match(migration, /where a\.status='no_show'/, 'Mevcut backend yalnız no_show saymalı');
assert.match(migration, /a\.scheduled_at>=now\(\)-interval '6 months'/, 'Mevcut backend hareketli altı ayı korumalı');
assert.match(migration, /select count\(\*\)<2/, 'Mevcut online engel eşiği değişmemeli');

console.log('PASS customer no-show UI: 0/1/2+ labels, rolling six months, phone identity, cancelled exclusion and informational-only manual flow');
