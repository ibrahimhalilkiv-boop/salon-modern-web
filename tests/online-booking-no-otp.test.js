const assert = require('node:assert/strict');
const fs = require('node:fs');

const backend = fs.readFileSync('supabase/functions/customer-booking-request/index.ts', 'utf8');
const html = fs.readFileSync('randevu/index.html', 'utf8');
const browser = fs.readFileSync('randevu/booking.js', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

assert.match(backend, /action === 'booking-identity'/);
assert.match(backend, /BOOKING_RATE_LIMIT_SALT/);
assert.match(backend, /can_create_online_booking/);
assert.match(backend, /create_pending_online_booking/);
assert.match(html, /id="continueCustomerButton"/);
assert.match(browser, /action=booking-identity/);
assert.match(sw, /booking\.js\?v=183/);
assert.ok(!backend.includes('phone-request-code'));
assert.ok(!backend.includes('phone-verify-code'));
assert.ok(!browser.includes('requestCodeButton'));
assert.ok(!html.includes('otpCode'));
console.log('PASS customer booking without verification code');
