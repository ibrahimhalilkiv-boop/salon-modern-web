const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const handlers={},calls=[],errors=[];let fail=0;
const self={registration:{showNotification:async(title,options)=>{calls.push({title,options});if(fail-->0)throw new Error('fixture rejection')}},addEventListener:(name,fn)=>handlers[name]=fn};
vm.runInNewContext(fs.readFileSync('sw.js','utf8'),{self,Date,console:{error:(...args)=>errors.push(args)}});
async function push(data){let pending;handlers.push({data,waitUntil:p=>pending=p});assert(pending,'Push lifetime is extended');await pending}
(async()=>{
const payload={title:'Randevu Hatırlatması',body:'1 saat kaldı',notificationId:'fixture',appointmentId:'a1',kind:'appointment_reminder',tag:'salon-fixture'};
await push({json:()=>payload});assert.equal(calls[0].title,payload.title);assert.equal(calls[0].options.data.appointmentId,'a1');assert.equal(calls[0].options.tag,'salon-fixture');
for(const value of [null,[],42,'string'])await push({json:()=>value});
// Actual routing/timing from the Şefik Alkurt case; no customer record is written.
const sefik={...payload,notificationId:'c835191c-65f6-44e5-be45-3740d6e24834',appointmentId:'64694ad5-1f6d-4795-b7dc-be82f658f024',appointmentDate:'2026-10-03',reminderFor:'2026-10-03T12:00:00+00:00',tag:'salon-c835191c-65f6-44e5-be45-3740d6e24834'};
assert.equal(Date.parse(sefik.reminderFor)-Date.parse('2026-10-03T11:00:00Z'),60*60*1000);
await push({json:()=>sefik});assert.equal(calls.at(-1).options.data.notificationId,sefik.notificationId);assert.equal(calls.at(-1).options.data.kind,'appointment_reminder');
await push(null);await push({json:()=>{throw new Error('bad JSON')},text:()=> 'plain body'});assert.equal(calls.at(-1).options.body,'plain body');
await push({json:()=>{throw new Error('bad JSON')},text:()=>{throw new Error('unreadable')}});assert.equal(calls.at(-1).title,'Salon Modern');
fail=1;await push({json:()=>payload});assert.equal(calls.at(-1).options.icon,undefined);assert.equal(calls.at(-1).options.data.appointmentId,'a1');assert.equal(errors.length,1);
fail=2;await assert.rejects(()=>push({json:()=>payload}),/fixture rejection/);assert.equal(errors.length,3,'Both failures observable, not falsely reported as shown');
console.log('PASS push worker: production payload, no page/session dependency, null/empty/malformed data, fallback, click metadata and failure logging');
})().catch(error=>{console.error(error);process.exitCode=1});
