import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { assistantEnabled, extractMetaEvents, receiptUpdate, templateRevocation } from '../supabase/functions/_shared/meta-webhook.mjs';

let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS', name); }
test('bot defaults off independently of outbound SAFE_MODE', () => {
  assert.equal(assistantEnabled({get: () => undefined}), false);
  assert.equal(assistantEnabled({get: key => key === 'SAFE_MODE' ? 'false' : undefined}), false);
  assert.equal(assistantEnabled({get: () => 'true'}), true);
});
const body = {object:'whatsapp_business_account',entry:[{changes:[
  {field:'messages',value:{messages:[{id:'inbound'}],statuses:[{id:'receipt'}]}},
  {field:'smb_message_echoes',value:{messages:[{id:'echo'}]}},
  {field:'history',value:{messages:[{id:'history'}]}},
  {field:'message_template_status_update',value:{event:'PAUSED'}},
]}]};
test('only messages events feed inbound processing; echoes and history ignored', () => {
  assert.deepEqual(extractMetaEvents(body).messages,[{id:'inbound'}]);
  assert.equal(extractMetaEvents(body).statuses.length,1);
  assert.equal(extractMetaEvents(body).templateChanges.length,1);
  assert.deepEqual(extractMetaEvents({object:'user'}).messages,[]);
});
test('receipt rejects invalid IDs/status/timestamps', () => {
  for (const r of [{},{id:'a',status:'read'},{id:'a',status:'bad',timestamp:'1'}, {id:'a',status:'read',timestamp:'x'}]) assert.equal(receiptUpdate(r),null);
});
test('delivery progression cannot regress read or delivered and does not retry', () => {
  assert.deepEqual(receiptUpdate({id:'a',status:'sent',timestamp:'1'}).predecessors,['sending','delivery_unknown']);
  assert.equal(receiptUpdate({id:'a',status:'failed',timestamp:'1'}).predecessors.includes('delivered'),false);
  assert.equal(receiptUpdate({id:'a',status:'delivered',timestamp:'1'}).predecessors.includes('read'),false);
  assert.equal(receiptUpdate({id:'a',status:'read',timestamp:'1'}).patch.status_at,'1970-01-01T00:00:01.000Z');
});
test('revocation clears approved hash; APPROVED cannot auto-enable stale content', () => {
  assert.equal(templateRevocation({event:'APPROVED',message_template_name:'x',message_template_language:'tr'}),null);
  for (const event of ['REJECTED','PAUSED','DISABLED','PENDING_DELETION','DELETED']) assert.equal(templateRevocation({event,message_template_name:'x',message_template_language:'tr'}).patch.approved_content_hash,null);
});

// Exercise the actual deployed handler with a fake DB and cryptographically
// signed requests. No production rows, customer messages or external AI calls.
const source = await readFile(new URL('../supabase/functions/whatsapp-assistant-v31/index.ts', import.meta.url),'utf8');
const js = stripTypeScriptTypes(source).replace(/^import[\s\S]*?;\s*/gm,'');
let handler, calls=[];
const env = new Map([['META_APP_SECRET','test-only-secret'],['SUPABASE_URL','https://test.invalid'],['SUPABASE_SERVICE_ROLE_KEY','mock'],['SAFE_MODE','false']]);
const db = {from(table) { return {update(patch) { const call={table,patch,filters:[]}; calls.push(call); return {eq(key,value) { call.filters.push([key,value]); return this; },in(key,value) { call.filters.push([key,value]); return Promise.resolve({error:null}); },then(resolve) { resolve({error:null}); }}; }}; }};
const context = vm.createContext({Deno:{env:{get:key=>env.get(key)},serve:fn=>handler=fn},createClient:()=>db,assistantEnabled,extractMetaEvents,receiptUpdate,templateRevocation,crypto,TextEncoder,Response,URL,console, setTimeout,clearTimeout, fetch:()=>{throw new Error('external_send_not_allowed');}});
vm.runInContext(js,context);
async function signed(payload) {
  const text = JSON.stringify(payload);
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode('test-only-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig = Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text))).toString('hex');
  return new Request('https://test.invalid',{method:'POST',headers:{'x-hub-signature-256':'sha256='+sig},body:text});
}
assert.equal((await handler(new Request('https://test.invalid',{method:'POST',body:'{}'}))).status,401); checks++; console.log('PASS invalid signature rejected before DB');
const payload = {object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{messages:[{id:'private',from:'905000000000',text:{body:'randevu'}}],statuses:[{id:'wamid.test',status:'read',timestamp:'1'}]}}]}]};
const result = await handler(await signed(payload));
assert.equal(result.status,200);
assert.equal((await result.json()).assistant_enabled,false);
assert.equal(calls.length,1);
assert.equal(calls[0].table,'whatsapp_message_logs');
assert.deepEqual(calls[0].filters[0],['provider_message_id','wamid.test']);
checks++; console.log('PASS signed receipt handled; inbound bot/AI/booking disabled');
console.log(`${checks} checks passed`);
calls=[];
assert.equal((await handler(await signed(body))).status,200);
assert.equal(calls.length,0); checks++; console.log('PASS malformed receipt and echoes/history produce no database writes');
calls=[];
await handler(await signed({object:'whatsapp_business_account',entry:[{changes:[{field:'message_template_status_update',value:{event:'PAUSED',message_template_name:'onay',message_template_language:'tr'}}]}]}));
assert.equal(calls.length,1);
assert.equal(calls[0].table,'whatsapp_meta_template_mappings');
assert.equal(calls[0].patch.approved_content_hash,null);
assert.deepEqual(calls[0].filters,[['meta_template_name','onay'],['language_code','tr']]); checks++; console.log('PASS signed template revocation targets matching name and language only');
env.set('WHATSAPP_META_VERIFY_TOKEN','test-verify');
assert.equal((await handler(new Request('https://test.invalid/?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123'))).status,403);
assert.equal(await (await handler(new Request('https://test.invalid/?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=123'))).text(),'123'); checks++; console.log('PASS existing webhook verification challenge retained');
console.log(`TOTAL ${checks} checks passed`);
