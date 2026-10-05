const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('sw.js','utf8'),stores=new Map(),shown=[],warnings=[];
let fail=0,lookupFails=false;
const caches={
  async open(name){if(!stores.has(name))stores.set(name,new Map());const rows=stores.get(name);return {match:async k=>rows.has(k)?new Response(rows.get(k)):undefined,put:async(k,v)=>rows.set(k,await v.text())}},
  keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name)
};
function boot(){
  const handlers={},self={registration:{scope:'https://fixture.test/',getNotifications:async()=>{if(lookupFails)throw new Error('fixture lookup failure');return []},showNotification:async(title,options)=>{if(fail-->0)throw new Error('fixture display failure');shown.push({title,options})}},clients:{claim:async()=>{},matchAll:async()=>[]},addEventListener:(n,f)=>handlers[n]=f};
  vm.runInNewContext(source,{self,caches,Response,URL,Date,Set,console:{error(){},warn:(...x)=>warnings.push(x)}});
  const emit=async(kind,data,origin='https://fixture.test/salon-modern.html')=>{let task;handlers[kind]({data:kind==='push'?{json:()=>data}:data,source:{url:origin},waitUntil:p=>task=p});if(task)await task};
  return {emit,activate:async()=>{let task;handlers.activate({waitUntil:p=>task=p});await task}};
}
const payload={notificationId:'583f62c4-dfc7-4813-974f-b2f0414d16d9',appointmentId:'866fa03b-c2e6-41f7-b4be-f86cbe219cf7',appointmentDate:'2026-10-05',reminderFor:'2026-10-05T07:00:00Z',createdAt:new Date(Date.now()+60000).toISOString(),kind:'appointment_reminder',title:'Randevu Hatırlatması',body:'Fixture reminder'};
const fallback=data=>({type:'SALON_REMINDER_FALLBACK',data});
async function record(id){const r=await(await caches.open('salon-modern-push-receipts-v1')).match('https://fixture.test/__salon_push_receipts__/'+id);return r?await r.json():null}
(async()=>{
  let worker=boot();await worker.activate();
  await worker.emit('message',fallback({...payload,notificationId:'before-upgrade',createdAt:'2026-01-01T00:00:00Z'}));assert.equal(shown.length,0,'First deployment must not replay previously dismissed reminders');
  await Promise.all([worker.emit('message',fallback(payload)),worker.emit('push',payload),worker.emit('push',payload)]);
  assert.equal(shown.length,1,'Concurrent realtime catch-up and push must display once');
  assert.equal(shown[0].options.data.kind,'appointment_reminder');assert.equal(shown[0].options.tag,'salon-'+payload.notificationId);
  let receipt=await record(payload.notificationId);assert(receipt.shownAt&&receipt.pushReceivedAt);assert(!JSON.stringify(receipt).includes(payload.body),'Device receipt must not retain customer text');
  await caches.open('salon-modern-shell-pwa-v108');await caches.open('other-application-cache');
  worker=boot();await worker.activate();assert(stores.has('salon-modern-push-receipts-v1'));assert(stores.has('other-application-cache'));assert(!stores.has('salon-modern-shell-pwa-v108'));
  await worker.emit('push',payload);await worker.emit('message',fallback(payload));assert.equal(shown.length,1,'Worker restart and update must retain dedup, even after notification dismissal');
  const failed={...payload,notificationId:'retry-after-display-failure'};fail=2;
  await assert.rejects(()=>worker.emit('push',failed),/fixture display failure/);
  receipt=await record(failed.notificationId);assert(receipt.failedAt&&receipt.lastError);assert(!receipt.shownAt,'Failed display must not become a success');
  await worker.emit('message',fallback(failed));assert.equal(shown.length,2);assert((await record(failed.notificationId)).shownAt);
  await worker.emit('push',{...payload,notificationId:'moved-appointment-reminder'});assert.equal(shown.length,3,'A distinct notification after appointment reschedule is not suppressed');
  await worker.emit('message',fallback({...payload,notificationId:'foreign-origin'}),'https://foreign.test/salon-modern.html');
  await worker.emit('message',fallback({...payload,notificationId:'customer-page'}),'https://fixture.test/randevu/');assert.equal(shown.length,3,'Customer pages and foreign origins cannot request staff reminder display');
  lookupFails=true;await worker.emit('push',{...payload,notificationId:'lookup-failure'});assert.equal(shown.length,4,'Notification lookup failure must never block primary push display');
  console.log('PASS reminder display: concurrent fallback/push once, durable dedup across update/restart, failure trace/retry, no customer data and source isolation');
})().catch(e=>{console.error(e);process.exitCode=1});
