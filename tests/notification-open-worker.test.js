const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const handlers={},posted=[],focused=[],opened=[];let clients=[];
const self={registration:{scope:'https://app.salonmodern.com.tr/'},addEventListener:(n,f)=>handlers[n]=f,clients:{matchAll:async()=>clients,openWindow:async u=>opened.push(u)}};
vm.runInNewContext(fs.readFileSync('sw.js','utf8'),{self,URL});
const client=url=>({url,postMessage:d=>posted.push(d),focus:async()=>focused.push(url)});
async function click(){let pending;handlers.notificationclick({notification:{close(){},data:{url:'https://evil.example/',appointmentDate:'2026-10-05',appointmentId:'a1',kind:'appointment_reminder',notificationId:'n1'}},waitUntil:p=>pending=p});await pending}
(async()=>{
clients=[client('https://app.salonmodern.com.tr/randevu/'),client('https://app.salonmodern.com.tr/salon-modern.html')];await click();assert.equal(focused.length,1);assert(focused[0].endsWith('/salon-modern.html'));assert.equal(opened.length,0);assert.equal(posted[0].data.notificationId,'n1');
clients=[client('https://app.salonmodern.com.tr/randevu/')];await click();assert.equal(opened.length,1);const url=new URL(opened[0]);assert.equal(url.pathname,'/salon-modern.html');assert.equal(url.searchParams.get('appointment'),'a1');assert.equal(url.searchParams.get('notification'),'n1');assert.equal(url.origin,'https://app.salonmodern.com.tr');
console.log('PASS SW notification routing: personnel window only, cold URL metadata, no customer-tab focus or foreign URL');
})().catch(e=>{console.error(e);process.exitCode=1});
