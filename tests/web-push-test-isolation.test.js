const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('supabase/functions/web-push-dispatch/index.ts', 'utf8');
const testRoute = source.slice(source.indexOf('async function createTestNotification'), source.indexOf('async function prepareDeliveries'));
assert.match(testRoute, /eq\("user_id", user\.id\)\.eq\("active", true\)/,
  'Test target must be an active subscription owned by the signed-in user');
assert.match(testRoute, /webpush\.sendNotification\(\{ endpoint: target\.endpoint/,
  'Only the selected browser subscription receives the test');
assert.doesNotMatch(testRoute, /from\("notifications"\)|from\("web_push_deliveries"\)|dispatch\(/,
  'Test must not create a notification that triggers FCM or other devices');
assert.match(testRoute, /status: "sent"/,
  'Provider acceptance is reported separately from browser display');
console.log('PASS Web Push test is isolated to the current owned subscription');
