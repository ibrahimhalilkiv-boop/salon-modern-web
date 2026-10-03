const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const handlers={},calls=[],errors=[];let fail=0;
const self={registration:{showNotification:async(title,options)=>{calls.push({title,options});if(fail-->0)throw new Error('fixture rejection')}},addEventListener:(name,fn)=>handlers[name]=fn};
vm.runInNewContext(fs.readFileSync('sw.js','utf8'),{self,Date,console:{error:(...args)=>errors.push(args)}});
async function push(data){let pending;handlers.push({data,waitUntil:p=>pending=p});assert(pending,'Push lifetime is extended');await pending}
(async()=>{
const payload={title:'Randevu Hatırlatması',body:'1 saat kaldı',notificationId:'fixture',appointmentId:'a1',kind:'appointment_reminder',tag:'salon-fixture'};
await push({json:()=>payload});assert.equal(calls[0].title,payload.title);assert.equal(calls[0].options.data.appointmentId,'a1');assert.equal(calls[0].options.tag,'salon-fixture');
for(const value of [null,[],42,'string'])await push({json:()=>value});
await push(null);await push({json:()=>{throw new Error('bad JSON')},text:()=> 'plain body'});assert.equal(calls.at(-1).options.body,'plain body');
await push({json:()=>{throw new Error('bad JSON')},text:()=>{throw new Error('unreadable')}});assert.equal(calls.at(-1).title,'Salon Modern');
fail=1;await push({json:()=>payload});assert.equal(calls.at(-1).options.icon,undefined);assert.equal(calls.at(-1).options.data.appointmentId,'a1');assert.equal(errors.length,1);
fail=2;await assert.rejects(()=>push({json:()=>payload}),/fixture rejection/);assert.equal(errors.length,3,'Both failures observable, not falsely reported as shown');
console.log('PASS push worker: production payload, no page/session dependency, null/empty/malformed data, fallback, click metadata and failure logging');
})().catch(error=>{console.error(error);process.exitCode=1});
