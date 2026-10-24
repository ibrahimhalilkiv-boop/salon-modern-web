const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync('supabase/functions/bootstrap-salon/index.ts', 'utf8');
assert.doesNotMatch(source, /const setupKey\s*=\s*["'][^"']+["']/);
async function check(secret, count, method, payload, expected) {
  let handler, writes = 0;
  const admin = {
    from: () => ({ select: async () => ({ count, error: null }) }),
    auth: { admin: { createUser() { writes++; throw new Error('Unexpected write'); } } }
  };
  const ctx = { Request, Response, console, createClient: () => admin,
    Deno: { env: { get: name => name === 'SALON_BOOTSTRAP_SETUP_KEY' ? secret : '{}' }, serve: fn => { handler = fn; } } };
  vm.runInNewContext(stripTypeScriptTypes(source.replace(/^import[^\n]+\n/, ''), { mode: 'transform' }), ctx);
  const response = await handler(new Request('https://fixture.test/', { method,
    ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}) }));
  assert.equal(response.status, expected);
  assert.equal(writes, 0);
  if (method === 'GET') assert.equal((await response.json()).initialized, count > 0);
}
(async () => {
  await check(undefined, 7, 'GET', null, 200);
  await check(undefined, 0, 'GET', null, 200);
  await check(undefined, 0, 'POST', {}, 401);
  await check(undefined, 0, 'POST', { setup_key: '' }, 401);
  await check('fixture-only', 0, 'POST', { setup_key: 'wrong' }, 401);
  await check('fixture-only', 7, 'POST', { setup_key: 'fixture-only' }, 409);
  console.log('PASS bootstrap: no hardcoded key, unset/wrong key denied, initialized salon protected, login status unchanged');
})().catch(error => { console.error(error); process.exitCode = 1; });
